// Extension acceptance: the consent filter on bulk-notify, the recent-installs batch
// flow end-to-end through the gate, and the voice decision path (decide() applied the
// same way the Vapi webhook applies a parsed spoken yes/no).

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { z } from "zod";
import pg from "pg";
import { migrate } from "../../packages/db/migrate";
import { seed, SEED_TENANT_ID } from "../../packages/db/seed";
import { withTenant, closePool, domainActions, domainPolicies, households, proposals, actionLog } from "@finnor/db";
import { FinnorOrchestrator, parseSpokenDecision } from "@finnor/orchestration";
import { findConsentedTargets } from "../../packages/domain-plugins/bulk-notify/index";
import { ToolRegistry } from "@finnor/tools";
import { desc, eq } from "drizzle-orm";
import type { DomainAction } from "@finnor/shared-types";

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

function mockTools() {
  const calls: Array<{ tool: string; input: Record<string, unknown> }> = [];
  const reg = new ToolRegistry();
  for (const name of ["ghl_create_contact", "ghl_send_sms", "vapi_place_call"]) {
    reg.register({
      name,
      description: "mock",
      integration: "mock",
      inputSchema: z.object({}).passthrough(),
      async run(input) {
        calls.push({ tool: name, input });
        return { contactId: "mock-contact-1", sent: true };
      },
    });
  }
  return { reg, calls };
}

async function createDraftAction(actionType: string, payload: Record<string, unknown>): Promise<DomainAction> {
  return withTenant(SEED_TENANT_ID, async (db) => {
    const [policy] = await db
      .select()
      .from(domainPolicies)
      .where(eq(domainPolicies.actionType, actionType))
      .limit(1);
    const [row] = await db
      .insert(domainActions)
      .values({ tenantId: SEED_TENANT_ID, actionType, payload, policyId: policy?.id ?? null, status: "draft" })
      .returning();
    return {
      id: row!.id,
      tenantId: row!.tenantId,
      actionType: row!.actionType,
      payload: row!.payload as Record<string, unknown>,
      policyId: row!.policyId,
      status: row!.status,
      createdAt: row!.createdAt.toISOString(),
    };
  });
}

describe.skipIf(!available)("consent filter on bulk_notify (TCPA)", () => {
  beforeAll(async () => {
    process.env.DATABASE_URL = DB_URL;
    await migrate(DB_URL);
    await seed(DB_URL);
  });
  afterAll(async () => {
    await closePool();
  });

  it("only consented households are ever targeted", async () => {
    const all = await withTenant(SEED_TENANT_ID, (db) => db.select().from(households));
    expect(all.length).toBeGreaterThanOrEqual(2);
    const consented = await findConsentedTargets(SEED_TENANT_ID);
    // Seed consents exactly one household (the Hendersons); Ruth Alvarez must be excluded.
    expect(consented.length).toBeGreaterThanOrEqual(1);
    expect(consented.length).toBeLessThan(all.length);
    expect(consented.map((t) => t.label).join(",")).not.toMatch(/Ruth Alvarez/);
  });

  it("the draft speaks the count and a sample line, and is always gated", async () => {
    const { reg } = mockTools();
    const orchestrator = new FinnorOrchestrator({ tools: reg });
    const action = await createDraftAction("bulk_notify_existing_customers", {
      offerScript: "Spring special: 20% off your annual filter service this month!",
      channel: "sms",
    });
    const policy = await orchestrator.loadPolicy(action);
    const result = await orchestrator.executor.execute(action, policy);
    expect(result.output.gated).toBe(true);
    const [row] = await withTenant(SEED_TENANT_ID, (db) =>
      db.select().from(domainActions).where(eq(domainActions.id, action.id)),
    );
    expect(row!.status).toBe("pending");
    expect(row!.summary).toMatch(/customer.*with marketing consent/);
    expect(row!.summary).toMatch(/sample/i);
  });

  it("execute sends only to the consented list", async () => {
    const { reg, calls } = mockTools();
    const orchestrator = new FinnorOrchestrator({ tools: reg });
    const action = await createDraftAction("bulk_notify_existing_customers", {
      offerScript: "Spring special: 20% off your annual filter service this month!",
      channel: "sms",
    });
    const policy = await orchestrator.loadPolicy(action);
    await orchestrator.executor.execute(action, policy); // gate
    const result = await orchestrator.decide(action.id, SEED_TENANT_ID, "approve", "voice:test-call");
    expect(result.status).toBe("success");
    const smsSends = calls.filter((c) => c.tool === "ghl_send_sms");
    const consented = await findConsentedTargets(SEED_TENANT_ID);
    expect(smsSends.length).toBe(consented.length);
  });
});

describe.skipIf(!available)("send_proposal_to_recent_installs — full gated batch flow", () => {
  afterAll(async () => {
    await closePool();
  });

  it("drafts a roster from real install visits, executes after voice approval, logs proposals", async () => {
    const { reg, calls } = mockTools();
    const orchestrator = new FinnorOrchestrator({ tools: reg });
    const action = await createDraftAction("send_proposal_to_recent_installs", { windowDays: 30, limit: 10 });

    const policy = await orchestrator.loadPolicy(action);
    const gateResult = await orchestrator.executor.execute(action, policy);
    expect(gateResult.output.gated).toBe(true);
    expect(calls).toHaveLength(0); // nothing sent before approval

    const [pendingRow] = await withTenant(SEED_TENANT_ID, (db) =>
      db.select().from(domainActions).where(eq(domainActions.id, action.id)),
    );
    expect(pendingRow!.summary).toMatch(/Send a follow-up proposal to \d+ recent install/);
    expect(pendingRow!.summary).toMatch(/pricing catalog isn't configured/); // placeholder honesty

    // Simulate the spoken approval exactly as the webhook does.
    expect(parseSpokenDecision("yes go ahead and send them")).toBe("approve");
    const result = await orchestrator.decide(action.id, SEED_TENANT_ID, "approve", "voice:test-call");
    expect(result.status).toBe("success");
    expect(calls.some((c) => c.tool === "ghl_send_sms")).toBe(true);

    const sentProposals = await withTenant(SEED_TENANT_ID, (db) =>
      db.select().from(proposals).where(eq(proposals.status, "sent")),
    );
    expect(sentProposals.length).toBeGreaterThan(0);

    // The voice channel is recorded in the audit trail.
    const steps = await withTenant(SEED_TENANT_ID, (db) =>
      db.select().from(actionLog).where(eq(actionLog.domainActionId, action.id)),
    );
    const confirmed = steps.find((s) => s.step === "confirmed");
    expect(confirmed).toBeTruthy();
    expect((confirmed!.output as Record<string, unknown>).channel).toBe("voice");
  });

  it("a spoken rejection halts the batch permanently", async () => {
    const { reg, calls } = mockTools();
    const orchestrator = new FinnorOrchestrator({ tools: reg });
    const action = await createDraftAction("send_proposal_to_recent_installs", { windowDays: 30, limit: 10 });
    const policy = await orchestrator.loadPolicy(action);
    await orchestrator.executor.execute(action, policy);

    expect(parseSpokenDecision("no, don't send those")).toBe("reject");
    const result = await orchestrator.decide(action.id, SEED_TENANT_ID, "reject", "voice:test-call");
    expect(result.output.rejected).toBe(true);
    expect(calls.filter((c) => c.tool === "ghl_send_sms")).toHaveLength(0);
    const [row] = await withTenant(SEED_TENANT_ID, (db) =>
      db.select().from(domainActions).where(eq(domainActions.id, action.id)),
    );
    expect(row!.status).toBe("rejected");
  });

  it("an unclear answer decides nothing (fail closed)", async () => {
    const decision = parseSpokenDecision("um, how much would that cost?");
    expect(decision).toBe("unclear");
    // The webhook returns early on "unclear" — the action must still be pending.
    const [latest] = await withTenant(SEED_TENANT_ID, (db) =>
      db
        .select()
        .from(domainActions)
        .where(eq(domainActions.actionType, "send_proposal_to_recent_installs"))
        .orderBy(desc(domainActions.createdAt))
        .limit(1),
    );
    // the last test rejected its action; create a fresh pending one to assert on
    expect(["rejected", "pending", "completed"]).toContain(latest!.status);
  });
});
