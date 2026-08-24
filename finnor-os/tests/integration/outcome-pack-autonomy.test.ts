import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";
import { and, eq } from "drizzle-orm";
import { migrate } from "../../packages/db/migrate";
import {
  authorityStates,
  autonomyEvaluations,
  autonomyGrants,
  businessEffects,
  closePool,
  communicationsLog,
  domainActions,
  domainPolicies,
  households,
  outcomePackCertifications,
  outcomePackRuns,
  outcomeShadowProposals,
  tenantIntegrations,
  tenantOutcomePackSettings,
  tenants,
  users,
  withTenant,
  workflowSteps,
} from "@finnor/db";
import {
  controlWorkObjective,
  createAutonomyGrant,
  evaluateOutcomeAutonomyReadiness,
  FinnorOrchestrator,
  OUTCOME_PACK_DEFINITIONS,
  outcomePackFingerprint,
  revokeAutonomyGrant,
  startOutcomePack,
} from "@finnor/orchestration";
import { runWorkflowStep } from "../../apps/worker/src/handlers/run-workflow-step";

const DB_URL = process.env.DATABASE_URL ?? "postgres://finnor:finnor@localhost:5432/finnor";
process.env.DATABASE_URL = DB_URL;
const PACK_ID = "lead_to_verified_water_test_booking" as const;

async function dbUp(): Promise<boolean> {
  const client = new pg.Client({ connectionString: DB_URL, connectionTimeoutMillis: 2_000 });
  try { await client.connect(); await client.end(); return true; } catch { return false; }
}

const available = await dbUp();

describe.skipIf(!available).sequential("Phase 5 certified outcome packs and progressive autonomy", () => {
  const tenantId = randomUUID();
  const otherTenantId = randomUUID();
  const ownerId = randomUUID();
  const otherOwnerId = randomUUID();
  const householdId = randomUUID();
  const otherHouseholdId = randomUUID();
  const fingerprint = outcomePackFingerprint(PACK_ID);
  const orchestrator = new FinnorOrchestrator();

  beforeAll(async () => {
    process.env.DATABASE_URL = DB_URL;
    process.env.SECRETS_PROVIDER = "env";
    process.env.COMMS_MODE = "sandbox";
    process.env.FINNOR_ENVIRONMENT = "test";
    process.env.AUTH_DEV_BYPASS = "1";
    await migrate(DB_URL);
    await withTenant(tenantId, async (db) => {
      await db.insert(tenants).values({ id: tenantId, name: "Phase 5 Autonomy Dealer" });
      await db.insert(users).values({ id: ownerId, tenantId, email: `phase5-owner-${tenantId}@example.test`, role: "owner", displayName: "Phase 5 Owner" });
      await db.insert(households).values([
        { id: householdId, tenantId, address: "5 Certified Outcome Way", contactInfo: { name: "Primary Household", phone: "+15550105001" }, marketingConsent: true },
        { id: otherHouseholdId, tenantId, address: "6 Exact Scope Way", contactInfo: { name: "Outside Grant Household", phone: "+15550105002" }, marketingConsent: true },
      ]);
      for (const capability of ["crm", "scheduling", "communications"] as const) {
        await db.insert(tenantIntegrations).values({
          tenantId,
          capability,
          binding: `phase5-${capability}`,
          mode: "real",
          outcomePacks: [PACK_ID],
          health: "ok",
          syncStatus: "synced",
          freshnessState: "fresh",
          reconciliationStatus: "healthy",
          sourceLagMs: 0,
          unresolvedConflicts: 0,
          lastSuccessfulSyncAt: new Date(),
          lastObservedAt: new Date(),
        });
      }
      await db.insert(outcomePackCertifications).values({
        tenantId,
        packId: PACK_ID,
        packVersion: OUTCOME_PACK_DEFINITIONS[PACK_ID].version,
        level: "live_provider",
        status: "LIVE_TEST_PASS",
        fingerprint,
        dependencyVersions: OUTCOME_PACK_DEFINITIONS[PACK_ID].dependencyVersions,
        evidence: { suite: "phase5-integration", verified: true },
        sampleSize: 20,
        criticalViolations: 0,
        validUntil: new Date(Date.now() + 86_400_000),
      });
    });
    await withTenant(otherTenantId, async (db) => {
      await db.insert(tenants).values({ id: otherTenantId, name: "Phase 5 Other Dealer" });
      await db.insert(users).values({ id: otherOwnerId, tenantId: otherTenantId, email: `phase5-other-${otherTenantId}@example.test`, role: "owner" });
    });
  });

  afterAll(async () => {
    await closePool();
  });

  async function currentAuthorityRevision(): Promise<number> {
    const [row] = await withTenant(tenantId, (db) => db.select().from(authorityStates).where(eq(authorityStates.tenantId, tenantId)).limit(1));
    if (!row) throw new Error("authority state was not provisioned");
    return row.revision;
  }

  async function seedGrant(resources = [householdId], policyVersion: number | null = null): Promise<string> {
    const now = Date.now();
    const authorityRevision = await currentAuthorityRevision();
    const [grant] = await withTenant(tenantId, (db) => db.insert(autonomyGrants).values({
      tenantId,
      packId: PACK_ID,
      packVersion: 1,
      effectClasses: ["internal_write"],
      resourceScope: [{ type: "household", ids: resources }],
      principal: `employee:${ownerId}`,
      providerScope: [],
      maxRisk: "medium",
      policyVersion,
      authorityRevision,
      certificationFingerprint: fingerprint,
      validFrom: new Date(now - 1_000),
      reviewAfter: new Date(now + 3_600_000),
      expiresAt: new Date(now + 86_400_000),
      createdBy: ownerId,
      reason: "phase5 exact-scope integration proof",
    }).returning({ id: autonomyGrants.id }));
    if (!grant) throw new Error("grant was not inserted");
    return grant.id;
  }

  async function start(mode: "shadow" | "approval" | "autopilot") {
    return startOutcomePack(PACK_ID, { mode, householdId }, {
      tenantId,
      userId: ownerId,
      employeeId: ownerId,
      role: "owner",
    }, { idempotencyKey: `phase5:${mode}:${randomUUID()}` });
  }

  async function stepFor(actionId: string) {
    const [step] = await withTenant(tenantId, (db) => db.select().from(workflowSteps).where(and(
      eq(workflowSteps.tenantId, tenantId),
      eq(workflowSteps.domainActionId, actionId),
    )).limit(1));
    if (!step) throw new Error(`No workflow step for ${actionId}`);
    return step;
  }

  it("refuses to grant Autopilot before repeated verified effect evidence is earned", async () => {
    const now = Date.now();
    const authorityRevision = await currentAuthorityRevision();
    const readiness = await evaluateOutcomeAutonomyReadiness(tenantId, PACK_ID);
    expect(readiness.eligible).toBe(false);
    expect(readiness.gates).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "MIN_VERIFIED_SAMPLE", passed: false }),
      expect.objectContaining({ code: "FULL_VERIFIED_EFFECT_COVERAGE", passed: false }),
    ]));
    await expect(createAutonomyGrant({
      ctx: { tenantId, userId: ownerId, employeeId: ownerId, role: "owner" },
      packId: PACK_ID,
      packVersion: 1,
      scope: {
        effectClasses: ["internal_write"],
        resources: [{ type: "household", ids: [householdId] }],
        principal: `employee:${ownerId}`,
        providers: [],
        maxAmountUsd: null,
        maxRisk: "medium",
        validFrom: new Date(now - 1_000).toISOString(),
        reviewAfter: new Date(now + 3_600_000).toISOString(),
        expiresAt: new Date(now + 86_400_000).toISOString(),
        policyVersion: null,
        authorityRevision,
        certificationFingerprint: fingerprint,
      },
      reason: "must not bypass evidence threshold",
    })).rejects.toThrow(/Autonomy is not eligible/);
  });

  it("runs Shadow through the real compiler while persisting zero consequential mutation", async () => {
    const started = await start("shadow");
    const before = await withTenant(tenantId, (db) => db.select().from(communicationsLog).where(eq(communicationsLog.householdId, householdId)));
    const drafted = await orchestrator.draftKnownAction("log_interaction", {
      householdId,
      channel: "call",
      direction: "inbound",
      content: "shadow proposal must never be written to customer history",
    }, tenantId, { workId: started.workId, initiatedBy: ownerId, source: "phase5-shadow-test" });

    expect(drafted.result).toMatchObject({ status: "success", output: { shadow: true, consequentialMutation: false } });
    const state = await withTenant(tenantId, async (db) => ({
      communications: await db.select().from(communicationsLog).where(eq(communicationsLog.householdId, householdId)),
      proposals: await db.select().from(outcomeShadowProposals).where(eq(outcomeShadowProposals.domainActionId, drafted.action.id)),
      effects: await db.select().from(businessEffects).where(eq(businessEffects.domainActionId, drafted.action.id)),
      runs: await db.select().from(outcomePackRuns).where(eq(outcomePackRuns.workId, started.workId)),
      steps: await db.select().from(workflowSteps).where(eq(workflowSteps.domainActionId, drafted.action.id)),
    }));
    expect(state.communications).toHaveLength(before.length);
    expect(state.proposals).toEqual([expect.objectContaining({ comparisonStatus: "pending" })]);
    expect(state.effects).toEqual([expect.objectContaining({ status: "cancelled" })]);
    expect(state.runs).toEqual([expect.objectContaining({ status: "shadow_recorded" })]);
    expect(state.steps).toHaveLength(0);
  });

  it("uses the existing approval boundary and resumes the same durable effect after approval", async () => {
    const started = await start("approval");
    const drafted = await orchestrator.draftKnownAction("send_follow_up", { householdId, context: "the certified water-test booking" }, tenantId, {
      workId: started.workId,
      initiatedBy: ownerId,
      source: "phase5-approval-test",
    });
    expect(drafted.result).toMatchObject({ status: "success", output: { gated: true, pendingConfirmation: true } });
    const approved = await orchestrator.decide(drafted.action.id, tenantId, "approve", ownerId, { role: "owner" });
    expect(approved).toMatchObject({ status: "success", output: { durable: true, queued: true } });
    await runWorkflowStep({ tenantId, workflowStepId: (await stepFor(drafted.action.id)).id });
    const [action] = await withTenant(tenantId, (db) => db.select().from(domainActions).where(eq(domainActions.id, drafted.action.id)));
    expect(action?.status).toBe("completed");
  });

  it("does not invent a human gate for a safe effect whose configured floor is NONE", async () => {
    const started = await start("approval");
    const drafted = await orchestrator.draftKnownAction("log_interaction", {
      householdId,
      channel: "call",
      direction: "inbound",
      content: "approval mode preserves the existing NONE floor",
    }, tenantId, { workId: started.workId, initiatedBy: ownerId });
    expect(drafted.result).toMatchObject({ status: "success", output: { durable: true, queued: true } });
    expect(drafted.result.output).not.toHaveProperty("pendingConfirmation", true);
    await runWorkflowStep({ tenantId, workflowStepId: (await stepFor(drafted.action.id)).id });
  });

  it("allows only a current live-certified exact-scope internal effect in Autopilot", async () => {
    const grantId = await seedGrant();
    const started = await start("autopilot");
    const drafted = await orchestrator.draftKnownAction("log_interaction", {
      householdId,
      channel: "call",
      direction: "inbound",
      content: "exact certified autopilot effect",
    }, tenantId, { workId: started.workId, initiatedBy: ownerId, source: "phase5-autopilot-test" });
    expect(drafted.result).toMatchObject({ status: "success", output: { durable: true, queued: true, autonomy: { outcome: "autopilot_allowed", grantId } } });
    await runWorkflowStep({ tenantId, workflowStepId: (await stepFor(drafted.action.id)).id });
    const state = await withTenant(tenantId, async (db) => ({
      communications: await db.select().from(communicationsLog).where(and(eq(communicationsLog.householdId, householdId), eq(communicationsLog.content, "exact certified autopilot effect"))),
      evaluations: await db.select().from(autonomyEvaluations).where(eq(autonomyEvaluations.domainActionId, drafted.action.id)),
    }));
    expect(state.communications).toHaveLength(1);
    expect(state.evaluations).toEqual(expect.arrayContaining([expect.objectContaining({ outcome: "autopilot_allowed", eligible: true, grantId })]));
  });

  it("fails closed outside the exact resource scope and immediately after revocation", async () => {
    const inherited = await withTenant(tenantId, (db) => db.select({ id: autonomyGrants.id }).from(autonomyGrants).where(and(
      eq(autonomyGrants.tenantId, tenantId),
      eq(autonomyGrants.status, "active"),
    )));
    for (const grant of inherited) await revokeAutonomyGrant({ tenantId, grantId: grant.id, actorId: ownerId, reason: "isolate revocation proof" });
    const grantId = await seedGrant();
    const started = await start("autopilot");
    const outside = await orchestrator.draftKnownAction("log_interaction", {
      householdId: otherHouseholdId,
      channel: "call",
      direction: "inbound",
      content: "outside exact grant",
    }, tenantId, { workId: started.workId, initiatedBy: ownerId });
    expect(outside.result.status).toBe("failure");
    expect(JSON.stringify(outside.result.output)).toContain("EXACT_ACTIVE_GRANT_MISSING");
    expect(await revokeAutonomyGrant({ tenantId, grantId, actorId: ownerId, reason: "operator stop" })).toBe(true);

    const revoked = await orchestrator.draftKnownAction("log_interaction", {
      householdId,
      channel: "call",
      direction: "inbound",
      content: "must remain blocked after revoke",
    }, tenantId, { workId: started.workId, initiatedBy: ownerId });
    expect(revoked.result.status).toBe("failure");
    expect(JSON.stringify(revoked.result.output)).toContain("EXACT_ACTIVE_GRANT_MISSING");
  });

  it("invalidates an Autopilot run after a material implementation fingerprint change", async () => {
    await seedGrant();
    const started = await start("autopilot");
    await withTenant(tenantId, (db) => db.update(outcomePackRuns).set({ certificationFingerprint: "f".repeat(64) }).where(eq(outcomePackRuns.workId, started.workId)));
    const changed = await orchestrator.draftKnownAction("log_interaction", {
      householdId,
      channel: "call",
      direction: "inbound",
      content: "must be recertified after a material implementation change",
    }, tenantId, { workId: started.workId, initiatedBy: ownerId });
    expect(changed.result.status).toBe("failure");
    expect(JSON.stringify(changed.result.output)).toContain("IMPLEMENTATION_FINGERPRINT_CHANGED");
  });

  it("rejects an unresolved material target before any autonomous effect exists", async () => {
    await seedGrant();
    const started = await start("autopilot");
    const action = await orchestrator.draftKnownAction("log_interaction", {
      householdId: randomUUID(),
      channel: "call",
      direction: "inbound",
      content: "unknown target must never be guessed",
    }, tenantId, { workId: started.workId, initiatedBy: ownerId });
    expect(action.result).toMatchObject({ status: "failure", output: { effectBoundary: "effect_missing" } });
    const effects = await withTenant(tenantId, (db) => db.select().from(businessEffects).where(eq(businessEffects.domainActionId, action.action.id)));
    expect(effects).toHaveLength(0);
  });

  it("demotes grants on source, authority, and policy revisions", async () => {
    await seedGrant();
    await withTenant(tenantId, (db) => db.update(tenantIntegrations).set({ freshnessState: "stale" }).where(and(
      eq(tenantIntegrations.tenantId, tenantId),
      eq(tenantIntegrations.capability, "scheduling"),
    )));
    let active = await withTenant(tenantId, (db) => db.select().from(autonomyGrants).where(and(eq(autonomyGrants.tenantId, tenantId), eq(autonomyGrants.status, "active"))));
    expect(active).toHaveLength(0);
    await withTenant(tenantId, (db) => db.update(tenantIntegrations).set({ freshnessState: "fresh" }).where(and(eq(tenantIntegrations.tenantId, tenantId), eq(tenantIntegrations.capability, "scheduling"))));

    await seedGrant();
    await withTenant(tenantId, (db) => db.update(tenantIntegrations).set({ health: "degraded" }).where(and(eq(tenantIntegrations.tenantId, tenantId), eq(tenantIntegrations.capability, "communications"))));
    active = await withTenant(tenantId, (db) => db.select().from(autonomyGrants).where(and(eq(autonomyGrants.tenantId, tenantId), eq(autonomyGrants.status, "active"))));
    expect(active).toHaveLength(0);
    await withTenant(tenantId, (db) => db.update(tenantIntegrations).set({ health: "ok" }).where(and(eq(tenantIntegrations.tenantId, tenantId), eq(tenantIntegrations.capability, "communications"))));

    await seedGrant();
    const nextAuthorityRevision = (await currentAuthorityRevision()) + 1;
    await withTenant(tenantId, (db) => db.update(authorityStates).set({ revision: nextAuthorityRevision }).where(eq(authorityStates.tenantId, tenantId)));
    active = await withTenant(tenantId, (db) => db.select().from(autonomyGrants).where(and(eq(autonomyGrants.tenantId, tenantId), eq(autonomyGrants.status, "active"))));
    expect(active).toHaveLength(0);

    await seedGrant([householdId], 1);
    await withTenant(tenantId, (db) => db.insert(domainPolicies).values({ tenantId, actionType: "phase5_policy_revision_probe", policy: {}, requiresConfirmation: false, version: 1 }));
    await withTenant(tenantId, (db) => db.update(domainPolicies).set({ version: 2 }).where(and(eq(domainPolicies.tenantId, tenantId), eq(domainPolicies.actionType, "phase5_policy_revision_probe"))));
    active = await withTenant(tenantId, (db) => db.select().from(autonomyGrants).where(and(eq(autonomyGrants.tenantId, tenantId), eq(autonomyGrants.status, "active"))));
    expect(active).toHaveLength(0);
  });

  it("makes operator cancellation terminal and prevents cross-tenant Phase 5 ownership", async () => {
    const started = await start("approval");
    await controlWorkObjective({ tenantId, workId: started.workId, command: "cancel", actorId: ownerId });
    const [run] = await withTenant(tenantId, (db) => db.select().from(outcomePackRuns).where(eq(outcomePackRuns.workId, started.workId)));
    expect(run).toMatchObject({ status: "cancelled" });

    await expect(withTenant(tenantId, (db) => db.insert(tenantOutcomePackSettings).values({
      tenantId,
      packId: PACK_ID,
      enabled: false,
      updatedBy: otherOwnerId,
      reason: "cross-tenant user must be rejected",
    }))).rejects.toThrow();
    const authorityRevision = await currentAuthorityRevision();
    await expect(withTenant(tenantId, (db) => db.insert(autonomyGrants).values({
      tenantId,
      packId: PACK_ID,
      packVersion: 1,
      effectClasses: ["internal_write"],
      resourceScope: [{ type: "household", ids: [householdId] }],
      principal: "*",
      providerScope: [],
      maxRisk: "medium",
      authorityRevision,
      certificationFingerprint: fingerprint,
      validFrom: new Date(Date.now() - 1_000),
      reviewAfter: new Date(Date.now() + 3_600_000),
      expiresAt: new Date(Date.now() + 86_400_000),
      createdBy: otherOwnerId,
      reason: "cross-tenant creator must be rejected",
    }))).rejects.toThrow();
  });
});
