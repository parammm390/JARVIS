// marketing domain plugin.
// summarize_ad_performance is REAL: pulls from Meta/Google Ads automatically once
// either is configured (packages/tools/src/ads.ts), demo data otherwise — clearly
// labeled, never presented as live.
// create_review_request is REAL: it's a comms send (SMS/email a review link), not an
// ads-API write, so it doesn't need the write-scope app review launch_ad_campaign does.
// launch_ad_campaign runs for real too, but in a clearly-labeled dry-run mode until
// Meta/Google ads_management write-scope credentials + app review exist
// (packages/tools/src/ads-write.ts) — it never silently no-ops and never fabricates a
// "campaign created" result.

import type { DomainEnginePlugin } from "../shared/plugin-interface";
import { containsPlaceholder, renderTemplate } from "../shared/plugin-interface";
import type { DraftAction, ExecutionResult, ValidationResult, DomainPolicy } from "@finnor/shared-types";
import type { ToolRegistry } from "@finnor/tools";
import { z } from "zod";
import {
  LaunchCampaignPayloadSchema,
  ReviewRequestPayloadSchema,
  ReviewRequestPolicySchema,
} from "./policy.schema";

const opt = <T extends z.ZodTypeAny>(t: T) => t.nullish().transform((v: unknown) => v ?? undefined);

const SUMMARIZE = "summarize_ad_performance";
const LAUNCH_CAMPAIGN = "launch_ad_campaign";
const REVIEW_REQUEST = "create_review_request";

export const SummarizeAdPerformanceSchema = z.object({
  windowDays: opt(z.number().int().min(1).max(90)),
});

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
  actionTypes: [SUMMARIZE, LAUNCH_CAMPAIGN, REVIEW_REQUEST],
  payloadSchemas: {
    [SUMMARIZE]: SummarizeAdPerformanceSchema,
    [LAUNCH_CAMPAIGN]: LaunchCampaignPayloadSchema,
    [REVIEW_REQUEST]: ReviewRequestPayloadSchema,
  },

  canHandle(t) {
    return this.actionTypes.includes(t);
  },

  validate(actionType, payload): ValidationResult {
    if (actionType === SUMMARIZE) {
      const p = SummarizeAdPerformanceSchema.safeParse(payload);
      return p.success ? { valid: true, errors: [] } : { valid: false, errors: p.error.issues.map((i) => i.message) };
    }
    if (actionType === LAUNCH_CAMPAIGN) {
      const p = LaunchCampaignPayloadSchema.safeParse(payload);
      return p.success
        ? { valid: true, errors: [] }
        : { valid: false, errors: p.error.issues.map((i) => `payload.${i.path.join(".")}: ${i.message}`) };
    }
    if (actionType === REVIEW_REQUEST) {
      const p = ReviewRequestPayloadSchema.safeParse(payload);
      return p.success
        ? { valid: true, errors: [] }
        : { valid: false, errors: p.error.issues.map((i) => `payload.${i.path.join(".")}: ${i.message}`) };
    }
    return { valid: false, errors: [`unhandled action ${actionType}`] };
  },

  draft(actionType, payload, policy: DomainPolicy): DraftAction {
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
    if (actionType === LAUNCH_CAMPAIGN) {
      const p = LaunchCampaignPayloadSchema.parse(payload);
      return {
        actionType,
        summary: `Launch a "${p.objective ?? "leads"}" ad campaign named "${p.name}" at $${p.dailyBudgetUsd}/day${p.targetZip ? ` targeting ${p.targetZip}` : ""}. Approve?`,
        payload: { ...p },
        requiresConfirmation: policy.requiresConfirmation,
      };
    }
    // REVIEW_REQUEST
    const p = ReviewRequestPayloadSchema.parse(payload);
    const pol = ReviewRequestPolicySchema.safeParse(policy.policy);
    const unconfigured = !pol.success || containsPlaceholder(pol.data.review_link_url);
    const channel = pol.success ? pol.data.channel : "sms";
    const target = channel === "email" ? p.email : p.phone;
    return {
      actionType,
      summary: unconfigured
        ? "create review request — not yet configured for this dealer. Set your review_link_url in the marketing policy before this can run."
        : `Send a review request to ${p.contactName ?? "this customer"} via ${channel}${target ? ` (${target})` : ""}. Approve?`,
      payload: {
        ...p,
        tenantId: policy.tenantId,
        channel,
        reviewLinkUrl: pol.success ? pol.data.review_link_url : undefined,
        messageTemplate: pol.success ? pol.data.message_template : undefined,
      },
      requiresConfirmation: unconfigured ? true : policy.requiresConfirmation,
    };
  },

  async execute(draft: DraftAction, tools: ToolRegistry): Promise<ExecutionResult> {
    if (draft.actionType === SUMMARIZE) {
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
    }

    if (draft.actionType === LAUNCH_CAMPAIGN) {
      const r = await tools.call("launch_ad_campaign", {
        name: draft.payload.name,
        dailyBudgetUsd: draft.payload.dailyBudgetUsd,
        objective: draft.payload.objective,
        targetZip: draft.payload.targetZip,
      });
      if (!r.ok) {
        return { status: r.integrationUnavailable ? "integration_unavailable" : "failure", output: {}, error: r.error };
      }
      return { status: "success", output: { ...r.output }, expected: { launched: true } };
    }

    // REVIEW_REQUEST
    const linkUrl = draft.payload.reviewLinkUrl ? String(draft.payload.reviewLinkUrl) : undefined;
    if (!linkUrl || containsPlaceholder(linkUrl)) {
      return { status: "failure", output: {}, error: "No review link configured yet — set review_link_url in the marketing policy first.", errorKind: "config" };
    }
    const template = draft.payload.messageTemplate
      ? String(draft.payload.messageTemplate)
      : "Hi {{name}}, thanks for choosing us! We'd really appreciate a quick review: {{link}}";
    const message = renderTemplate(template, { name: draft.payload.contactName ?? "there", link: linkUrl });

    if (draft.payload.channel === "email") {
      const to = draft.payload.email ? String(draft.payload.email) : undefined;
      if (!to) return { status: "failure", output: {}, error: "No email address on file to send the review request to.", errorKind: "validation" };
      const r = await tools.call("send_email", { to, subject: "Would you leave us a review?", body: message });
      if (!r.ok) return { status: r.integrationUnavailable ? "integration_unavailable" : "failure", output: {}, error: r.error };
      return { status: "success", output: { sent: true, channel: "email" }, expected: { sent: true } };
    }
    const phone = draft.payload.phone ? String(draft.payload.phone) : undefined;
    if (!phone) return { status: "failure", output: {}, error: "No phone number on file to text the review request to.", errorKind: "validation" };
    const contact = await tools.call("ghl_create_contact", { phone, tenantId: draft.payload.tenantId });
    if (!contact.ok) return { status: contact.integrationUnavailable ? "integration_unavailable" : "failure", output: {}, error: contact.error };
    const sms = await tools.call("ghl_send_sms", {
      contactId: String((contact.output as Record<string, unknown>).contactId ?? "unknown"),
      message,
      tenantId: draft.payload.tenantId,
    });
    if (!sms.ok) return { status: sms.integrationUnavailable ? "integration_unavailable" : "failure", output: {}, error: sms.error };
    return { status: "success", output: { sent: true, channel: "sms" }, expected: { sent: true } };
  },
};

export default marketingPlugin;
