// Regression test for two real bugs found while building Phase 3's e2e proof (see
// packages/orchestration/src/index.ts, executor.ts, runtime-bridge.ts for the fixes):
//
// 1. draftKnownAction — the shared primitive every proactive scan and the Dealer Zero
//    simulator uses — never persisted policyId onto the domain_actions row, even when
//    loadPolicy() resolved a real, versioned policy. openReceiptForFirstClaim reads
//    policyId straight off that row, so every system-originated receipt's
//    policyApplied silently came back null.
// 2. requestedBy was never threaded from the confirm route's caller through
//    runAction/GatedExecutor/executePluginViaRuntime into submitCommand, so
//    DecisionReceipt.approval.approvedBy came back undefined for every single-action
//    execution routed through the legacy (non-LangGraph) executor.
//
// Deliberately NOT a full lead-to-booking e2e — that's already proven by
// tests/integration/dealer-zero-e2e.test.ts. This file exists only to pin these two
// specific fields so a future change can't silently regress them.

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import pg from "pg";
import { migrate } from "../../packages/db/migrate";
import { seed } from "../../packages/db/seed";
import { withTenant, closePool, domainActions, domainPolicies, decisionReceipts, leads } from "@finnor/db";
import { eq } from "drizzle-orm";
import { seedDealerZero, DEALER_ZERO_TENANT_ID } from "../../scripts/seed-dealer-zero";
import { seedTenantPolicies } from "../../scripts/seed-tenant-policies";
import { FinnorOrchestrator } from "@finnor/orchestration";
import { POST as confirmPOST } from "../../apps/api/app/api/actions/[id]/confirm/route";
import { randomUUID } from "node:crypto";

const DB_URL = process.env.DATABASE_URL ?? "postgres://finnor:finnor@localhost:5432/finnor";

async function dbUp(): Promise<boolean> {
  const c = new pg.Client({ connectionString: DB_URL, connectionTimeoutMillis: 2000 });
  try {
    await c.connect();
    await c.end();
    return true;
  } catch {
    return false;
  }
}
const available = await dbUp();

describe.skipIf(!available)("DecisionReceipt.policyApplied + approval.approvedBy — regression (§3.6 finding)", () => {
  beforeAll(async () => {
    process.env.DATABASE_URL = DB_URL;
    process.env.AUTH_DEV_BYPASS = "1";
    await migrate(DB_URL);
    await seed(DB_URL);
    await seedDealerZero();
    await seedTenantPolicies(DEALER_ZERO_TENANT_ID, { reviewLinkUrl: "https://g.page/r/dealer-zero-finnor-water-co/review" });
  }, 90_000);
  afterAll(async () => {
    await closePool();
  });

  it("a system-drafted (draftKnownAction), gated, API-approved action gets a receipt with a real policyApplied and a real approvedBy", async () => {
    const hexDigits = randomUUID()
      .replace(/-/g, "")
      .slice(0, 7)
      .split("")
      .map((c) => (c >= "a" && c <= "f" ? String(c.charCodeAt(0) % 10) : c))
      .join("");
    const testPhone = `+1319${hexDigits}`;

    const orchestrator = new FinnorOrchestrator();
    const leadDraft = await orchestrator.draftKnownAction(
      "create_lead",
      { name: "Regression Test Household", phone: testPhone, address: "1 Regression Test Ln, Cedar Falls, IA" },
      DEALER_ZERO_TENANT_ID,
      { source: "test:receipt-fields-regression" },
    );

    // Bug 1: policyId must be persisted at draft time, before approval.
    const [rowBeforeApproval] = await withTenant(DEALER_ZERO_TENANT_ID, (db) => db.select().from(domainActions).where(eq(domainActions.id, leadDraft.action.id)));
    expect(rowBeforeApproval!.status, "create_lead must be gated").toBe("pending");
    expect(rowBeforeApproval!.policyId, "policyId must be persisted at draft time, not left null").toBeTruthy();

    const [policyRow] = await withTenant(DEALER_ZERO_TENANT_ID, (db) => db.select().from(domainPolicies).where(eq(domainPolicies.id, rowBeforeApproval!.policyId!)));
    expect(policyRow, "the persisted policyId must reference a real domain_policies row").toBeTruthy();
    expect(policyRow!.actionType).toBe("create_lead");
    expect(policyRow!.version).toBeGreaterThanOrEqual(1);

    // Approve via the real HTTP route (not orchestrator.decide() directly) — this is
    // where approvedBy must originate from (ctx.userId, dev-bypass default under
    // AUTH_DEV_BYPASS=1).
    const res = await confirmPOST(
      new Request("http://localhost/api/test", {
        method: "POST",
        headers: { "x-tenant-id": DEALER_ZERO_TENANT_ID, "x-user-role": "owner", "content-type": "application/json" },
        body: JSON.stringify({}),
      }),
      { params: { id: leadDraft.action.id } },
    );
    expect(res.status).toBe(200);

    const [receipt] = await withTenant(DEALER_ZERO_TENANT_ID, (db) => db.select().from(decisionReceipts).where(eq(decisionReceipts.domainActionId, leadDraft.action.id)));
    expect(receipt, "a receipt must exist after approval + execution").toBeTruthy();

    // Bug 1, end to end: the receipt's policyApplied must cite the real policy, not null.
    const policyApplied = receipt!.policyApplied as { id?: string; version?: number } | null;
    expect(policyApplied?.id, "receipt.policyApplied.id must be the real policy id, not null").toBe(policyRow!.id);
    expect(policyApplied?.version).toBe(policyRow!.version);

    // Bug 2, end to end: the receipt's approval.approvedBy must be who actually approved
    // it (ctx.userId from the confirm route), not undefined.
    const approval = receipt!.approval as Record<string, unknown>;
    expect(approval.required).toBe(true);
    expect(approval.approvedBy, "receipt.approval.approvedBy must record who approved this — a core DecisionReceipt promise (§0's 'who approved it')").toBeTruthy();

    const [leadRow] = await withTenant(DEALER_ZERO_TENANT_ID, (db) => db.select().from(leads).where(eq(leads.phone, testPhone)));
    expect(leadRow, "the underlying lead must have actually been created (execution really ran, not just gated)").toBeTruthy();
  }, 30_000);
});
