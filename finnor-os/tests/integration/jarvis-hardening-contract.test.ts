import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import pg from "pg";
import { and, asc, desc, eq } from "drizzle-orm";
import { migrate } from "../../packages/db/migrate";
import {
  appointments,
  closePool,
  decisionReceipts,
  domainActions,
  evidenceSourceVersions,
  households,
  instructionEvents,
  leads,
  memoryCorrections,
  receiveWork,
  rolePermissions,
  serviceVisits,
  technicians,
  tenantOperatingProfiles,
  tenants,
  userOperatingProfiles,
  users,
  withTenant,
  workAggregate,
  workOrders,
} from "@finnor/db";
import {
  appendEvidenceVersion,
  createEvidenceSource,
  hybridRetrieve,
  recordCorrection,
  searchEvidence,
} from "@finnor/memory";
import {
  createFastReadOnlyRouter,
  assembleOperatingContext,
  FinnorOrchestrator,
  INSTRUCTION_EVENT_PHASES,
  resolveCompetitorResearch,
  type ObjectiveDecision,
  type ObjectiveDecisionPlanner,
  type ObjectiveInspection,
} from "@finnor/orchestration";
import { executeOperationalQuery } from "@finnor/read-models";
import { POST as confirmPOST } from "../../apps/api/app/api/actions/[id]/confirm/route";

const DB_URL = process.env.DATABASE_URL ?? "postgres://finnor:finnor@localhost:5432/finnor";

// Exact prompts supplied for this regression track. These are intentionally used
// unchanged in the backend path, including the contextual pronouns.
const RESEARCH_PROMPT = "Find competitors in Florida around my age, doing better/worse than us, in the $5M–$15M bracket.";
const OPERATIONAL_PROMPT = "Tell me all details of our work/appointments for tomorrow.";

const TENANT_ID = randomUUID();
const EMPTY_TENANT_ID = randomUUID();
const OTHER_TENANT_ID = randomUUID();
const UNKNOWN_TENANT_ID = randomUUID();
const OWNER_ID = randomUUID();
const TECHNICIAN_ID = randomUUID();
const TECHNICIAN_RECORD_ID = randomUUID();
const HOUSEHOLD_ID = randomUUID();
const APPOINTMENT_ID = randomUUID();
const VISIT_ID = randomUUID();
const WORK_ORDER_ID = randomUUID();
const SOURCE_KEY = `hardening-evidence:${randomUUID()}`;
const AS_OF = new Date("2026-08-17T06:30:00.000Z"); // Aug 16, 23:30 in America/Los_Angeles.

async function dbUp(): Promise<boolean> {
  const client = new pg.Client({ connectionString: DB_URL, connectionTimeoutMillis: 2_000 });
  try {
    await client.connect();
    await client.end();
    return true;
  } catch {
    return false;
  }
}

const available = await dbUp();

async function seedFixture(): Promise<void> {
  process.env.DATABASE_URL = DB_URL;
  process.env.SECRETS_PROVIDER = "env";
  process.env.COMMS_MODE = "sandbox";
  process.env.FINNOR_ENVIRONMENT = "test";
  process.env.AUTH_DEV_BYPASS = "1";
  await migrate(DB_URL);

  await withTenant(TENANT_ID, (db) => db.insert(tenants).values({ id: TENANT_ID, name: "Hardening Contract Tenant", timezone: "America/Los_Angeles" }));
  await withTenant(EMPTY_TENANT_ID, (db) => db.insert(tenants).values({ id: EMPTY_TENANT_ID, name: "Hardening Empty Tenant", timezone: "America/Los_Angeles" }));
  await withTenant(OTHER_TENANT_ID, (db) => db.insert(tenants).values({ id: OTHER_TENANT_ID, name: "Hardening Other Tenant", timezone: "America/New_York" }));

  await withTenant(TENANT_ID, async (db) => {
    await db.insert(users).values([
      { id: OWNER_ID, tenantId: TENANT_ID, email: `hardening-owner-${TENANT_ID}@example.invalid`, role: "owner", displayName: "Hardening Owner" },
      { id: TECHNICIAN_ID, tenantId: TENANT_ID, email: `hardening-tech-${TENANT_ID}@example.invalid`, role: "technician", displayName: "Hardening Technician" },
    ]);
    await db.insert(tenantOperatingProfiles).values({
      tenantId: TENANT_ID,
      industry: "water treatment",
      niche: "residential water filtration",
      primaryGeographies: ["Florida"],
      idealCustomerProfile: { segment: "private-well homeowners" },
      businessFacts: { leadConversionRate: "31%" },
      comparisonDefaults: { scaleMetric: "annual revenue", performanceMetric: "lead conversion rate" },
    });
    await db.insert(technicians).values({ id: TECHNICIAN_RECORD_ID, tenantId: TENANT_ID, name: "Hardening Technician", contactInfo: {}, availability: {} });
    await db.insert(households).values({
      id: HOUSEHOLD_ID,
      tenantId: TENANT_ID,
      address: "1 Contract Lane",
      contactInfo: { name: "Hardening Household", phone: "+15550170001" },
      marketingConsent: true,
    });

    await db.insert(appointments).values([
      { id: APPOINTMENT_ID, tenantId: TENANT_ID, subjectType: "household", subjectId: HOUSEHOLD_ID, technicianId: TECHNICIAN_RECORD_ID, status: "confirmed", scheduledAt: new Date("2026-08-17T16:00:00.000Z"), durationMinutes: 60, notes: "In-scope appointment" },
      { id: randomUUID(), tenantId: TENANT_ID, subjectType: "household", subjectId: HOUSEHOLD_ID, technicianId: TECHNICIAN_RECORD_ID, status: "confirmed", scheduledAt: new Date("2026-08-17T06:59:59.999Z"), durationMinutes: 30, notes: "Before local-day boundary" },
      { id: randomUUID(), tenantId: TENANT_ID, subjectType: "household", subjectId: HOUSEHOLD_ID, technicianId: TECHNICIAN_RECORD_ID, status: "confirmed", scheduledAt: new Date("2026-08-18T07:00:00.000Z"), durationMinutes: 30, notes: "At exclusive local-day boundary" },
    ]);
    await db.insert(serviceVisits).values({ id: VISIT_ID, tenantId: TENANT_ID, householdId: HOUSEHOLD_ID, technicianId: TECHNICIAN_RECORD_ID, type: "water_test", scheduledAt: new Date("2026-08-17T18:00:00.000Z"), completedAt: null, notes: "In-scope visit" });
    await db.insert(workOrders).values({ id: WORK_ORDER_ID, tenantId: TENANT_ID, householdId: HOUSEHOLD_ID, type: "repair", status: "scheduled", technicianId: TECHNICIAN_RECORD_ID, scheduledAt: new Date("2026-08-17T19:00:00.000Z"), completedAt: null, stockReservation: {} });

    const scaleLeads = Array.from({ length: 1_000 }, (_, index) => {
      const id = randomUUID();
      return {
        id,
        tenantId: TENANT_ID,
        name: `Scale Lead ${index + 1}`,
        status: index % 2 === 0 ? "new" as const : "qualified" as const,
        source: "hardening-scale",
        sourceSystem: "hardening-scale",
        externalId: id,
      };
    });
    await db.insert(leads).values(scaleLeads);
  });
  await withTenant(TENANT_ID, (db) => db.insert(userOperatingProfiles).values({
    userId: OWNER_ID,
    tenantId: TENANT_ID,
    title: "Founder",
    profileFacts: { age: 39 },
  }), OWNER_ID);
}

function apiRequest(role: string): Request {
  return new Request("http://localhost/api/actions/test/confirm", {
    method: "POST",
    headers: { "x-tenant-id": TENANT_ID, "x-user-role": role },
  });
}

class ScriptedObjectivePlanner implements ObjectiveDecisionPlanner {
  providerName = "hardening-scripted-planner";
  calls = 0;

  async decide(input: { inspection: ObjectiveInspection }): Promise<ObjectiveDecision> {
    this.calls += 1;
    if (this.calls === 1) {
      return { kind: "query", request: { intent: "customer_lookup", householdId: HOUSEHOLD_ID }, reason: "Bind the request to the canonical household before contacting anyone.", nextStep: "Draft one follow-up only after the canonical read." };
    }
    if (this.calls === 2) {
      return { kind: "action", actionType: "send_follow_up", payload: { householdId: HOUSEHOLD_ID, context: "the requested service follow-up" }, reason: "The canonical customer record is the target for the follow-up.", nextStep: "Wait for approval and observe the real receipt." };
    }
    const completed = (input.inspection.actions as Array<{ actionType?: string; status?: string }>).some((action) => action.actionType === "send_follow_up" && action.status === "completed");
    if (!completed) throw new Error("The objective planner was asked to complete before observing the action receipt");
    return { kind: "complete", outcome: { observed: true }, reason: "The approved follow-up and its receipt are now canonical." };
  }
}

describe.skipIf(!available)("JARVIS hardening contract against migrated PostgreSQL", () => {
  beforeAll(async () => {
    await seedFixture();
  });

  afterAll(async () => {
    await closePool();
  });

  it("resolves tenant-local tomorrow as a DST-safe half-open canonical range", async () => {
    const result = await executeOperationalQuery(
      TENANT_ID,
      { intent: "schedule_range", localDateRange: { startDate: "tomorrow" }, page: { limit: 20 } },
      { now: () => AS_OF },
    );

    expect(result).toMatchObject({
      intent: "schedule_range",
      status: "ok",
      timeZone: "America/Los_Angeles",
      localDateRange: { startDate: "tomorrow" },
      range: { start: "2026-08-17T07:00:00.000Z", end: "2026-08-18T07:00:00.000Z" },
      source: { kind: "canonical_postgres" },
    });
    expect(result.rows.map((row) => row.id)).toEqual(expect.arrayContaining([APPOINTMENT_ID, VISIT_ID, WORK_ORDER_ID]));
    expect(result.rows.some((row) => row.scheduledAt === "2026-08-17T06:59:59.999Z")).toBe(false);
    expect(result.rows.some((row) => row.scheduledAt === "2026-08-18T07:00:00.000Z")).toBe(false);
    expect(result.page.totalCountExact).toBe(true);
  });

  it("distinguishes a canonical zero from an unavailable/unverifiable read", async () => {
    const empty = await executeOperationalQuery(
      EMPTY_TENANT_ID,
      { intent: "schedule_range", localDateRange: { startDate: "tomorrow" } },
      { now: () => AS_OF },
    );
    expect(empty).toMatchObject({ status: "ok", count: 0, page: { returned: 0, totalCount: 0, totalCountExact: true }, source: { kind: "canonical_postgres" } });

    const router = createFastReadOnlyRouter({ now: () => AS_OF });
    await expect(router.route(OPERATIONAL_PROMPT, { tenantId: UNKNOWN_TENANT_ID })).rejects.toThrow("Tenant not found");
  });

  it("keeps contextual pronouns on one continuing Work while a self-contained prompt creates New Work", async () => {
    const sessionId = `hardening-session-${randomUUID()}`;
    const first = await receiveWork({
      tenantId: TENANT_ID,
      instruction: "Tell me what our company knows about us and what you can do for me.",
      channel: "text",
      sessionId,
      userId: OWNER_ID,
      activeContext: { entityRefs: [{ entityType: "household", entityId: HOUSEHOLD_ID }] },
    });
    const continued = await receiveWork({
      tenantId: TENANT_ID,
      instruction: "Do the same for us.",
      channel: "voice",
      sessionId,
      workId: first.workId,
      userId: OWNER_ID,
      activeContext: { entityRefs: [{ entityType: "household", entityId: HOUSEHOLD_ID }] },
    });
    const fresh = await receiveWork({
      tenantId: TENANT_ID,
      instruction: "Start a new company-wide inventory review.",
      channel: "text",
      sessionId,
      userId: OWNER_ID,
    });

    expect(continued).toMatchObject({ workId: first.workId, created: false, duplicate: false });
    expect(continued.workInputId).not.toBe(first.workInputId);
    expect(fresh.workId).not.toBe(first.workId);
    const continuedAggregate = await workAggregate(TENANT_ID, first.workId);
    const continuedInputs = continuedAggregate?.inputs as Array<{ instructionText: string }> | undefined;
    expect(continuedInputs?.map((input) => input.instructionText)).toEqual([
      "Tell me what our company knows about us and what you can do for me.",
      "Do the same for us.",
    ]);
    expect(continuedAggregate?.entityLinks).toEqual(expect.arrayContaining([
      expect.objectContaining({ entityType: "household", entityId: HOUSEHOLD_ID }),
      expect.objectContaining({ entityType: "user", entityId: OWNER_ID }),
    ]));
    await expect(receiveWork({ tenantId: OTHER_TENANT_ID, instruction: "Foreign continuation", channel: "text", workId: first.workId })).rejects.toThrow("Work not found");
  });

  it("assembles authenticated PROFILE, WORK, CANONICAL, authority, and bounded memory before resolving competitor pronouns", async () => {
    const sessionId = `operating-context-${randomUUID()}`;
    const received = await receiveWork({
      tenantId: TENANT_ID,
      instruction: RESEARCH_PROMPT,
      channel: "text",
      sessionId,
      userId: OWNER_ID,
    });
    const assembled = await assembleOperatingContext(
      { tenantId: TENANT_ID, userId: OWNER_ID, role: "owner", authorityRoles: ["owner"], authorityRevision: 3 },
      { instruction: RESEARCH_PROMPT, workId: received.workId, sessionId, includeMemory: true, includeSemanticMemory: false, includeCanonicalBusinessState: true },
    );

    expect(assembled.context).toMatchObject({
      truthPrecedence: ["CANONICAL", "WORK", "PROFILE", "SESSION", "MEMORY", "WEB"],
      tenant: { id: TENANT_ID, companyName: "Hardening Contract Tenant", timezone: "America/Los_Angeles", profile: { niche: "residential water filtration" } },
      employee: { userId: OWNER_ID, role: "owner", profile: { title: "Founder", profileFacts: { age: 39 } } },
      activeWork: { id: received.workId },
      authority: { principal: OWNER_ID, revision: 3, roles: ["owner"] },
      health: { status: "complete" },
    });
    expect(assembled.context.canonicalSummaries).toEqual(expect.arrayContaining([expect.objectContaining({ name: "business_state" })]));
    expect(assembled.context.memory.semantic).toEqual([]);
    expect(assembled.context.sources.every((source) => source.role === "context_only")).toBe(true);

    const research = resolveCompetitorResearch(RESEARCH_PROMPT, assembled.context);
    expect(research.route).toBe("resolved");
    if (research.route !== "resolved") throw new Error("Expected authenticated competitor research");
    expect(research.action).toMatchObject({
      action_type: "search_web",
      payload: {
        researchContext: {
          companyName: "Hardening Contract Tenant",
          geographies: ["Florida"],
          comparison: { founderAge: 39, scaleMetric: "annual revenue", performanceMetric: "lead conversion rate", companyBaseline: "31%" },
          sourceKinds: ["PROFILE", "WEB"],
        },
      },
    });
  });

  it("exposes only real persisted instruction phases and monotonically ordered Work events", async () => {
    const orchestrator = new FinnorOrchestrator({
      fastReadOnlyRouter: createFastReadOnlyRouter({ now: () => AS_OF }),
      planner: { plan: async () => { throw new Error("planner must not run for the exact operational prompt"); } } as never,
      executor: { execute: async () => { throw new Error("executor must not run for a read-only query"); } } as never,
    });
    const result = await orchestrator.handleInstructionResult(OPERATIONAL_PROMPT, { tenantId: TENANT_ID, userId: OWNER_ID, role: "owner" }, {
      channel: "text",
      sessionId: `trace-session-${randomUUID()}`,
      idempotencyKey: `trace-work-${randomUUID()}`,
    });
    const trace = await withTenant(TENANT_ID, (db) => db.select().from(instructionEvents).where(eq(instructionEvents.instructionId, result.instructionId!)).orderBy(asc(instructionEvents.seq)));
    const aggregate = await workAggregate(TENANT_ID, result.workId!);

    expect(result.query?.request).toEqual({ intent: "schedule_range", localDateRange: { startDate: "tomorrow" } });
    expect(trace.length).toBeGreaterThanOrEqual(2);
    expect(trace.map((event) => event.seq)).toEqual([...trace].map((event) => event.seq).sort((a, b) => a - b));
    expect(trace.map((event) => event.phase)).toContain("received");
    expect(trace.map((event) => event.phase)).toContain("completed");
    expect(trace.every((event) => (INSTRUCTION_EVENT_PHASES as readonly string[]).includes(event.phase))).toBe(true);
    expect(trace.every((event) => event.payload && typeof event.payload === "object")).toBe(true);
    const workEvents = (aggregate?.events ?? []) as Array<{ seq: number; toStatus: string }>;
    expect(workEvents.map((event) => event.seq)).toEqual([...workEvents].map((event) => event.seq).sort((a, b) => a - b));
    expect(aggregate?.work).toMatchObject({ status: "completed" });
    expect(workEvents.some((event) => event.toStatus === "completed")).toBe(true);
    expect(aggregate?.queryExecutions).toEqual(expect.arrayContaining([expect.objectContaining({ status: "succeeded", intent: "schedule_range" })]));
  });

  it("keeps voice and text on the same canonical read/evidence contract", async () => {
    const router = createFastReadOnlyRouter({ now: () => AS_OF });
    const orchestrator = new FinnorOrchestrator({ fastReadOnlyRouter: router });
    const [textResult, voiceResult] = await Promise.all([
      orchestrator.handleInstructionResult(OPERATIONAL_PROMPT, { tenantId: TENANT_ID, userId: OWNER_ID, role: "owner" }, { channel: "text", idempotencyKey: `parity-text-${randomUUID()}` }),
      orchestrator.handleInstructionResult(OPERATIONAL_PROMPT, { tenantId: TENANT_ID, userId: OWNER_ID, role: "owner" }, { channel: "voice", idempotencyKey: `parity-voice-${randomUUID()}` }),
    ]);

    expect(textResult.query?.request).toEqual(voiceResult.query?.request);
    const comparableResult = (result: unknown) => {
      if (!result || typeof result !== "object" || Array.isArray(result)) return result;
      const { execution: _execution, ...stable } = result as Record<string, unknown>;
      return stable;
    };
    expect(comparableResult(textResult.query?.result)).toEqual(comparableResult(voiceResult.query?.result));
    expect(textResult.answer?.evidence[0]?.source).toBe(voiceResult.answer?.evidence[0]?.source);
    expect(textResult.answer?.readOnly).toBe(true);
    expect(voiceResult.answer?.readOnly).toBe(true);
  });

  it("keeps the 1,000-lead contract bounded while reporting the complete canonical aggregate", async () => {
    const result = await executeOperationalQuery(TENANT_ID, { intent: "business_state", page: { limit: 20 } }, { now: () => AS_OF });
    if (result.intent !== "business_state") throw new Error("Expected business_state result");
    const leadCount = result.pipeline.leads.reduce((sum, row) => sum + row.count, 0);

    expect(leadCount).toBe(1_000);
    expect(result.source.tables).toContain("leads");
    expect(result.page.truncated).toBe(false);
    expect(result.page.totalCountExact).toBe(true);
    expect(JSON.stringify(result).length).toBeLessThan(100_000);
    expect(JSON.stringify(result)).not.toContain("Scale Lead 1000");
  });

  it("records correction provenance, supersedes the old correction, and lets the correction outrank semantic context", async () => {
    const question = `what is our hardening service radius ${randomUUID()}`;
    const [receipt] = await withTenant(TENANT_ID, (db) => db.insert(decisionReceipts).values({
      tenantId: TENANT_ID,
      objective: "Answer the service-radius question",
      evidence: [{ source: "canonical_postgres", ref: "tenant_operating_profiles:radius", timestamp: AS_OF.toISOString() }],
      proposedAction: { actionType: "answer_business_question" },
      approval: { required: false },
    }).returning());
    const first = await recordCorrection({ tenantId: TENANT_ID, receiptId: receipt!.id, question, wrongAnswer: "10 miles", correctedFact: "25 miles", correctedBy: OWNER_ID });
    const second = await recordCorrection({ tenantId: TENANT_ID, receiptId: receipt!.id, question, wrongAnswer: "25 miles", correctedFact: "30 miles", correctedBy: OWNER_ID });
    const corrections = await withTenant(TENANT_ID, (db) => db.select().from(memoryCorrections).where(eq(memoryCorrections.tenantId, TENANT_ID)).orderBy(desc(memoryCorrections.createdAt)));
    const retrieval = await hybridRetrieve({ tenantId: TENANT_ID, query: question, structured: [{ source: "canonical_postgres", ref: "current", data: { radius: "30 miles" }, timestamp: AS_OF.toISOString() }], semanticLimit: 0 });

    expect(corrections).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: second.id, supersedesId: first.id, correctedFact: "30 miles", receiptId: receipt!.id, supersededAt: null }),
      expect.objectContaining({ id: first.id, correctedFact: "25 miles", supersededAt: expect.any(Date) }),
    ]));
    expect(retrieval.facts.correction).toMatchObject({ correctedFact: "30 miles", correctedBy: OWNER_ID });
    expect(retrieval.citations[0]).toMatchObject({ source: "correction", ref: second.id });
  });

  it("keeps evidence snapshots versioned and returns only the latest version as of the read time", async () => {
    const source = await createEvidenceSource(TENANT_ID, { sourceKey: SOURCE_KEY, sourceType: "manual", title: "Hardening source" });
    const oldVersion = await appendEvidenceVersion(TENANT_ID, source.id, {
      content: "The published service radius policy says the company serves customers within ten miles of the shop.",
      asOf: new Date("2026-08-01T00:00:00.000Z"),
      entityRefs: [{ type: "policy", key: "service-radius" }],
    });
    const newVersion = await appendEvidenceVersion(TENANT_ID, source.id, {
      content: "The published service radius policy was corrected: the company serves customers within thirty miles of the shop.",
      asOf: new Date("2026-08-10T00:00:00.000Z"),
      entityRefs: [{ type: "policy", key: "service-radius" }],
    });
    const versions = await withTenant(TENANT_ID, (db) => db.select().from(evidenceSourceVersions).where(eq(evidenceSourceVersions.sourceId, source.id)).orderBy(asc(evidenceSourceVersions.versionNumber)));
    const historical = await searchEvidence({ tenantId: TENANT_ID, query: "published service radius policy", scope: "tenant", asOf: new Date("2026-08-05T00:00:00.000Z") });
    const current = await searchEvidence({ tenantId: TENANT_ID, query: "published service radius policy", scope: "tenant", asOf: new Date("2026-08-11T00:00:00.000Z") });

    expect(oldVersion.versionNumber).toBe(1);
    expect(newVersion.versionNumber).toBe(2);
    expect(versions.map((version) => version.versionNumber)).toEqual([1, 2]);
    expect(historical.hits.filter((hit) => hit.sourceKey === SOURCE_KEY).every((hit) => hit.versionNumber === 1)).toBe(true);
    expect(current.hits.filter((hit) => hit.sourceKey === SOURCE_KEY)).toEqual(expect.arrayContaining([
      expect.objectContaining({ versionNumber: 2, content: expect.stringContaining("thirty miles") }),
    ]));
    expect(current.hits.filter((hit) => hit.sourceKey === SOURCE_KEY).some((hit) => hit.content.includes("ten miles"))).toBe(false);
  });

  it("keeps a consequential multistep objective behind approval and completes only after real observation", async () => {
    const planner = new ScriptedObjectivePlanner();
    const orchestrator = new FinnorOrchestrator({ objectiveDecisionPlanner: planner });
    const objective = await orchestrator.startObjective(
      "Follow up with the canonical household and finish only after the delivery is observed.",
      { tenantId: TENANT_ID, userId: OWNER_ID, employeeId: OWNER_ID, role: "owner" },
      { idempotencyKey: `hardening-objective-${randomUUID()}`, activeContext: { householdId: HOUSEHOLD_ID }, maxSteps: 5, maxActions: 1, maxQueries: 4 },
    );

    expect(await orchestrator.runObjectiveIteration({ tenantId: TENANT_ID, workId: objective.workId, objectiveLoopId: objective.objectiveLoopId })).toBe("continue");
    expect(await orchestrator.runObjectiveIteration({ tenantId: TENANT_ID, workId: objective.workId, objectiveLoopId: objective.objectiveLoopId })).toBe("awaiting_approval");
    const awaiting = await workAggregate(TENANT_ID, objective.workId);
    const awaitingActions = awaiting!.actions as Array<{ id: string; actionType: string; status: string; objectiveStepId?: string | null; initiatedBy?: string | null }>;
    const action = awaitingActions.find((candidate) => candidate.actionType === "send_follow_up")!;
    expect(action).toMatchObject({ status: "pending", objectiveStepId: expect.any(String), initiatedBy: OWNER_ID });

    const denied = await orchestrator.decide(action.id, TENANT_ID, "approve", TECHNICIAN_ID, { role: "technician" });
    expect(denied.status).toBe("failure");
    const afterDenied = await workAggregate(TENANT_ID, objective.workId);
    const afterDeniedActions = afterDenied!.actions as Array<{ id: string; status: string }>;
    expect(afterDeniedActions.find((candidate) => candidate.id === action.id)?.status).toBe("pending");

    const approved = await orchestrator.decide(action.id, TENANT_ID, "approve", OWNER_ID, { role: "owner" });
    expect(approved.status).toBe("success");
    expect(await orchestrator.runObjectiveIteration({ tenantId: TENANT_ID, workId: objective.workId, objectiveLoopId: objective.objectiveLoopId })).toBe("completed");
    const completed = await workAggregate(TENANT_ID, objective.workId);
    expect(completed!.objectiveSteps.map((step) => step.iterationOutcome)).toEqual(["continue", "awaiting_approval", "completed"]);
    expect(completed!.actions).toEqual([expect.objectContaining({ id: action.id, status: "completed" })]);
    expect(completed!.receipts).toEqual(expect.arrayContaining([
      expect.objectContaining({ domainActionId: action.id, evidence: expect.any(Array), finalizedAt: expect.any(Date) }),
    ]));
  });

  it("enforces approval authority at the real confirmation route before any action can proceed", async () => {
    await withTenant(TENANT_ID, (db) => db.insert(rolePermissions).values({ tenantId: TENANT_ID, role: "owner", actionType: "*", canApprove: true }));
    const [action] = await withTenant(TENANT_ID, (db) => db.insert(domainActions).values({ tenantId: TENANT_ID, actionType: "send_follow_up", payload: {}, status: "pending", summary: "Hardening authority probe" }).returning());
    const denied = await confirmPOST(apiRequest("technician"), { params: Promise.resolve({ id: action!.id }) });
    expect(denied.status).toBe(403);
    const [stillPending] = await withTenant(TENANT_ID, (db) => db.select({ status: domainActions.status }).from(domainActions).where(and(eq(domainActions.id, action!.id), eq(domainActions.tenantId, TENANT_ID))));
    expect(stillPending?.status).toBe("pending");
  });
});
