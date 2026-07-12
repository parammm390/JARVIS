// marketing domain plugin.
// summarize_ad_performance is REAL: pulls from Meta/Google Ads automatically once
// either is configured (packages/tools/src/ads.ts), demo data otherwise — clearly
// labeled, never presented as live. launch_ad_campaign and create_review_request stay
// interface-only stubs: those need write-access app review from Meta/Google, a much
// higher bar than a read-only insights key, and nobody has gone through it yet.

import type { DomainEnginePlugin } from "../shared/plugin-interface";
import type { DraftAction, ExecutionResult, ValidationResult, DomainPolicy } from "@finnor/shared-types";
import type { ToolRegistry } from "@finnor/tools";
import { createStubPlugin } from "../shared/plugin-interface";
import { z } from "zod";

const opt = <T extends z.ZodTypeAny>(t: T) => t.nullish().transform((v: unknown) => v ?? undefined);

const SUMMARIZE = "summarize_ad_performance";
export const SummarizeAdPerformanceSchema = z.object({
  windowDays: opt(z.number().int().min(1).max(90)),
});

// Named launch_ad_campaign (not "send_campaign") to stay unambiguous from
// bulk_notify_existing_customers (real, customer-outreach calls/texts) — the planner
// was routing "run a discount campaign to customers" here by name-similarity alone.
const stub = createStubPlugin("marketing", ["launch_ad_campaign", "create_review_request"]);

function speak(report: {
  provider: string;
  windowDays: number;
  totalSpendUsd: number;
  totalConversions: number;
  campaigns: Array<{ campaign: string; spendUsd: number; clicks: number; ctrPct: number; conversions?: number }>;
}): string {
  const prefix =
    report.provider === "demo"
      ? "No real ad account connected yet, so this is demo data to show the shape — "
      : `Live from ${report.provider === "meta" ? "Meta" : "Google Ads"}: `;
  if (report.campaigns.length === 0) {
    return `${prefix}no campaigns found in the last ${report.windowDays} days.`;
  }
  const best = [...report.campaigns].sort((a, b) => (b.conversions ?? 0) - (a.conversions ?? 0))[0]!;
  return (
    `${prefix}$${report.totalSpendUsd.toFixed(2)} spent across ${report.campaigns.length} campaign${report.campaigns.length === 1 ? "" : "s"} ` +
    `over the last ${report.windowDays} days, ${report.totalConversions} conversion${report.totalConversions === 1 ? "" : "s"} total. ` +
    `Best performer: ${best.campaign}, ${best.clicks} clicks at ${best.ctrPct.toFixed(2)}% CTR${best.conversions !== undefined ? `, ${best.conversions} conversions` : ""}.`
  );
}

export const marketingPlugin: DomainEnginePlugin = {
  name: "marketing",
  actionTypes: [SUMMARIZE, ...stub.actionTypes],
  payloadSchemas: { [SUMMARIZE]: SummarizeAdPerformanceSchema },

  canHandle(t) {
    return t === SUMMARIZE || stub.canHandle(t);
  },

  validate(actionType, payload, policy: DomainPolicy): ValidationResult {
    if (actionType === SUMMARIZE) {
      const p = SummarizeAdPerformanceSchema.safeParse(payload);
      return p.success ? { valid: true, errors: [] } : { valid: false, errors: p.error.issues.map((i) => i.message) };
    }
    return stub.validate(actionType, payload, policy);
  },

  draft(actionType, payload, policy: DomainPolicy): DraftAction | Promise<DraftAction> {
    if (actionType === SUMMARIZE) {
      const p = SummarizeAdPerformanceSchema.parse(payload);
      const days = p.windowDays ?? 7;
      return {
        actionType,
        summary: `Pull ad performance for the last ${days} days.`,
        payload: { windowDays: days },
        requiresConfirmation: false, // read-only
      };
    }
    return stub.draft(actionType, payload, policy);
  },

  async execute(draft: DraftAction, tools: ToolRegistry): Promise<ExecutionResult> {
    if (draft.actionType !== SUMMARIZE) return stub.execute(draft, tools);
    const r = await tools.call("get_ad_performance", { windowDays: draft.payload.windowDays ?? 7 });
    if (!r.ok) {
      return { status: r.integrationUnavailable ? "integration_unavailable" : "failure", output: {}, error: r.error };
    }
    const report = r.output as unknown as Parameters<typeof speak>[0];
    return {
      status: "success",
      output: { ...report, spokenSummary: speak(report) },
      expected: { answered: true },
    };
  },
};

export default marketingPlugin;
