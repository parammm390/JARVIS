// scan_cold_leads job: proactively finds consented customers inactive 3-6 months.
// If the tenant has configured a real win-back offer script in domain_policies, drafts
// a real gated bulk_notify_existing_customers action through the normal pipeline — the
// scan never invents a discount or a script itself (config over code, same rule as
// everywhere else in this system). If nothing is configured, the finding is still
// recorded for the owner digest, informationally, so it's never silently dropped.

import { withTenant, domainPolicies, scanFindings } from "@finnor/db";
import { and, eq } from "drizzle-orm";
import { FinnorOrchestrator } from "@finnor/orchestration";
import { findConsentedTargets } from "@finnor/plugin-bulk-notify";
import type { JobHandler } from "../queue";

let orchestrator: FinnorOrchestrator | null = null;

const MIN_MONTHS_INACTIVE = 3;
const MAX_MONTHS_INACTIVE = 6;

export const scanColdLeads: JobHandler = async (payload) => {
  const tenantId = String(payload.tenantId ?? "");
  if (!tenantId) throw new Error("scan_cold_leads requires tenantId");
  orchestrator ??= new FinnorOrchestrator();

  const targets = await findConsentedTargets(tenantId, {
    minMonthsInactive: MIN_MONTHS_INACTIVE,
    maxMonthsInactive: MAX_MONTHS_INACTIVE,
  });
  if (targets.length === 0) return;

  const [policy] = await withTenant(tenantId, (db) =>
    db
      .select()
      .from(domainPolicies)
      .where(and(eq(domainPolicies.tenantId, tenantId), eq(domainPolicies.actionType, "bulk_notify_existing_customers")))
      .limit(1),
  );
  const offerScript = (policy?.policy as Record<string, unknown> | undefined)?.winback_offer_script as
    | string
    | undefined;

  if (offerScript) {
    await orchestrator.draftKnownAction(
      "bulk_notify_existing_customers",
      {
        offerScript,
        channel: "call",
        voicePersona: "winback",
        minMonthsInactive: MIN_MONTHS_INACTIVE,
        maxMonthsInactive: MAX_MONTHS_INACTIVE,
      },
      tenantId,
      { source: "scan_cold_leads" },
    );
    return;
  }

  // No dealer-configured script — never fabricate one. Record the finding so the
  // owner still hears about it (via the digest) instead of it vanishing silently.
  await withTenant(tenantId, (db) =>
    db.insert(scanFindings).values({
      tenantId,
      scanType: "cold_leads",
      summary: `${targets.length} customer${targets.length === 1 ? "" : "s"} inactive ${MIN_MONTHS_INACTIVE}-${MAX_MONTHS_INACTIVE} months, but no win-back offer script is configured yet — set domain_policies.bulk_notify_existing_customers.policy.winback_offer_script to auto-draft outreach.`,
      details: { count: targets.length, sample: targets.slice(0, 3).map((t) => t.label) },
    }),
  );
};
