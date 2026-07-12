// compliance-documentation: generate_compliance_summary — the regulatory-reference part
// is REAL today (EPA published limits in the policy row); the dealer-specific paperwork
// format stays placeholder until a dealer supplies theirs.

import type { DomainEnginePlugin } from "../shared/plugin-interface";
import { containsPlaceholder } from "../shared/plugin-interface";
import type { DraftAction, ExecutionResult, ValidationResult, DomainPolicy } from "@finnor/shared-types";
import { z } from "zod";

const ACTION = "generate_compliance_summary";

export const CompliancePolicySchema = z.object({
  pfoa_mcl_ppt: z.number(),
  pfos_mcl_ppt: z.number(),
  fluoride_mcl_mg_l: z.number(),
  fluoride_secondary_standard_mg_l: z.number(),
  hardness_classification_gpg: z.record(z.string()),
  source: z.string(),
  paperwork_format: z.unknown().optional(), // dealer-specific — placeholder until supplied
});

export const CompliancePayloadSchema = z.object({
  waterProfile: z
    .object({
      hardness_gpg: z.number().nullish().transform((v) => v ?? undefined),
      pfoa_ppt: z.number().nullish().transform((v) => v ?? undefined),
      pfos_ppt: z.number().nullish().transform((v) => v ?? undefined),
      fluoride_mg_l: z.number().nullish().transform((v) => v ?? undefined),
    })
    .passthrough(),
  householdLabel: z.string().min(1).default("this household"),
});

export function classifyHardness(gpg: number, classes: Record<string, string>): string {
  // Ranges like {"soft":"<1","moderately_hard":"3.5-7","very_hard":">10.5"}
  for (const [name, range] of Object.entries(classes)) {
    if (range.startsWith("<") && gpg < Number(range.slice(1))) return name;
    if (range.startsWith(">") && gpg > Number(range.slice(1))) return name;
    const [lo, hi] = range.split("-").map(Number);
    if (lo !== undefined && hi !== undefined && !Number.isNaN(lo) && !Number.isNaN(hi) && gpg >= lo && gpg <= hi) return name;
  }
  return "unclassified";
}

export const complianceDocumentationPlugin: DomainEnginePlugin = {
  name: "compliance-documentation",
  actionTypes: [ACTION],
  payloadSchemas: { [ACTION]: CompliancePayloadSchema },
  canHandle: (t) => t === ACTION,

  validate(actionType, payload, policy: DomainPolicy): ValidationResult {
    if (actionType !== ACTION) return { valid: false, errors: [`unhandled action ${actionType}`] };
    const errors: string[] = [];
    const p = CompliancePayloadSchema.safeParse(payload);
    if (!p.success) errors.push(...p.error.issues.map((i) => `payload.${i.path.join(".")}: ${i.message}`));
    const pol = CompliancePolicySchema.safeParse(policy.policy);
    if (!pol.success) errors.push("compliance policy row is missing EPA reference data — reseed or edit the policy");
    return { valid: errors.length === 0, errors };
  },

  draft(actionType, payload, policy: DomainPolicy): DraftAction {
    const p = CompliancePayloadSchema.parse(payload);
    return {
      actionType,
      summary: `Generate a water-quality compliance summary for ${p.householdLabel} against EPA drinking water standards.`,
      payload: { ...p, policySnapshot: policy.policy },
      requiresConfirmation: policy.requiresConfirmation,
    };
  },

  async execute(draft: DraftAction): Promise<ExecutionResult> {
    const pol = CompliancePolicySchema.parse(draft.payload.policySnapshot);
    const profile = (draft.payload.waterProfile ?? {}) as Record<string, number | undefined>;
    const lines: string[] = [];
    const flags: string[] = [];

    if (profile.hardness_gpg !== undefined) {
      const cls = classifyHardness(profile.hardness_gpg, pol.hardness_classification_gpg);
      lines.push(`Hardness: ${profile.hardness_gpg} gpg — classified "${cls.replaceAll("_", " ")}" (aesthetic, not a federal MCL).`);
    }
    if (profile.pfoa_ppt !== undefined) {
      const over = profile.pfoa_ppt > pol.pfoa_mcl_ppt;
      lines.push(`PFOA: ${profile.pfoa_ppt} ppt vs EPA MCL ${pol.pfoa_mcl_ppt} ppt — ${over ? "EXCEEDS" : "within"} the limit.`);
      if (over) flags.push("PFOA exceeds the federal MCL");
    }
    if (profile.pfos_ppt !== undefined) {
      const over = profile.pfos_ppt > pol.pfos_mcl_ppt;
      lines.push(`PFOS: ${profile.pfos_ppt} ppt vs EPA MCL ${pol.pfos_mcl_ppt} ppt — ${over ? "EXCEEDS" : "within"} the limit.`);
      if (over) flags.push("PFOS exceeds the federal MCL");
    }
    if (profile.fluoride_mg_l !== undefined) {
      const overMcl = profile.fluoride_mg_l > pol.fluoride_mcl_mg_l;
      const overSecondary = profile.fluoride_mg_l > pol.fluoride_secondary_standard_mg_l;
      lines.push(
        `Fluoride: ${profile.fluoride_mg_l} mg/L vs MCL ${pol.fluoride_mcl_mg_l} mg/L (secondary standard ${pol.fluoride_secondary_standard_mg_l} mg/L) — ${
          overMcl ? "EXCEEDS the enforceable MCL" : overSecondary ? "above the secondary (aesthetic) standard" : "within limits"
        }.`,
      );
      if (overMcl) flags.push("Fluoride exceeds the enforceable MCL");
    }
    if (lines.length === 0) {
      return {
        status: "failure",
        output: {},
        error: "The household's water profile has no measurable values to check. Add test results first.",
      };
    }
    const paperworkNote =
      pol.paperwork_format === undefined || containsPlaceholder(pol.paperwork_format)
        ? "Dealer-specific paperwork format not configured — this is the regulatory reference summary only."
        : null;
    return {
      status: "success",
      output: { summaryLines: lines, flags, source: pol.source, ...(paperworkNote ? { note: paperworkNote } : {}) },
      expected: { generated: true },
    };
  },
};

export default complianceDocumentationPlugin;
