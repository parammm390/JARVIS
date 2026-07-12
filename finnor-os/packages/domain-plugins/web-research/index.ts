// Web research domain plugin — REAL via Exa: competitor scans, review lookups, and
// open web research. Read-only against the outside world, so it defaults ungated
// (seeded policy) — but still flows through the same audit pipeline as everything else.

import type { DomainEnginePlugin } from "../shared/plugin-interface";
import type { DraftAction, ExecutionResult, ValidationResult, DomainPolicy } from "@finnor/shared-types";
import type { ToolRegistry } from "@finnor/tools";
import { z } from "zod";

const opt = <T extends z.ZodTypeAny>(t: T) => t.nullish().transform((v: unknown) => v ?? undefined);

export const WebSearchSchema = z.object({
  query: z.string().min(2).max(400),
  numResults: opt(z.number().int().min(1).max(10)),
});
export const CompetitorScanSchema = z.object({
  area: z.string().min(2).max(200), // "Cedar Falls Iowa"
  focus: opt(z.string().max(200)), // e.g. "pricing", "PFAS treatment"
});
export const ReviewScanSchema = z.object({
  businessName: z.string().min(2).max(200),
  area: opt(z.string().max(200)),
});

const SCHEMAS: Record<string, z.ZodTypeAny> = {
  search_web: WebSearchSchema,
  scan_competitors: CompetitorScanSchema,
  check_business_reviews: ReviewScanSchema,
};

export const webResearchPlugin: DomainEnginePlugin = {
  name: "web-research",
  actionTypes: Object.keys(SCHEMAS),
  payloadSchemas: SCHEMAS,
  canHandle(t) {
    return t in SCHEMAS;
  },

  validate(actionType, payload): ValidationResult {
    const schema = SCHEMAS[actionType];
    if (!schema) return { valid: false, errors: [`unhandled action ${actionType}`] };
    const p = schema.safeParse(payload);
    return p.success
      ? { valid: true, errors: [] }
      : { valid: false, errors: p.error.issues.map((i) => `payload.${i.path.join(".")}: ${i.message}`) };
  },

  draft(actionType, payload, policy: DomainPolicy): DraftAction {
    const p = SCHEMAS[actionType]!.parse(payload) as Record<string, unknown>;
    const summaries: Record<string, string> = {
      search_web: `Search the web: "${p.query}"`,
      scan_competitors: `Scan water treatment competitors around ${p.area}${p.focus ? ` (focus: ${p.focus})` : ""}.`,
      check_business_reviews: `Look up recent reviews of ${p.businessName}${p.area ? ` in ${p.area}` : ""}.`,
    };
    return {
      actionType,
      summary: summaries[actionType]!,
      payload: { ...p },
      requiresConfirmation: policy.requiresConfirmation,
    };
  },

  async execute(draft: DraftAction, tools: ToolRegistry): Promise<ExecutionResult> {
    const p = draft.payload;
    const query =
      draft.actionType === "search_web"
        ? String(p.query)
        : draft.actionType === "scan_competitors"
          ? `water treatment softener filtration companies near ${p.area}${p.focus ? ` ${p.focus}` : ""}`
          : `${p.businessName}${p.area ? ` ${p.area}` : ""} customer reviews complaints ratings`;

    const r = await tools.call("web_search", { query, numResults: Number(p.numResults ?? 5) });
    if (!r.ok) {
      return {
        status: r.integrationUnavailable ? "integration_unavailable" : "failure",
        output: {},
        error: `Web search failed: ${r.error}`,
      };
    }
    const results = (r.output.results ?? []) as Array<{ title: string; url: string; snippet: string }>;
    return {
      status: "success",
      output: {
        query,
        results,
        spokenSummary:
          results.length === 0
            ? "The web search came back empty."
            : `Top result: ${results[0]!.title}. ${results[0]!.snippet.slice(0, 200)}`,
      },
      expected: { answered: true },
    };
  },
};

export default webResearchPlugin;
