// Upgrade 9: the smallest governed objective loop that sits inside Durable Work.
//
// This is deliberately a controller over proven primitives, not another agent
// framework. Every iteration performs one canonical inspection, asks for exactly one
// bounded decision, routes reads through the Operational Query Plane, routes writes
// through the existing typed action/executor boundary, observes the durable result,
// and ends in one explicit state before another job may be scheduled.

import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import type { DomainAction, ExecutionResult, OperationalQueryRequest, Role, TenantContext } from "@finnor/shared-types";
import {
  domainActions,
  actionLog,
  enqueueJobAt,
  receiveWork,
  transitionWork,
  users,
  withTenant,
  workAggregate,
  workObjectiveLoops,
  workObjectivePlannerAttempts,
  workObjectiveSteps,
  works,
} from "@finnor/db";
import { executeOperationalQuery } from "@finnor/read-models";
import { employeeAuthoritySnapshot, evaluateAuthority } from "@finnor/authority";
import type { LLMChannel, LLMProvider } from "./llm";
import { resolveProviderForPurpose } from "./llm";
import type { PluginRegistry } from "./plugin-registry";
import { queryAuthorityRequest } from "./authority-runtime";
import { validateOperationalQueryRequest } from "./fast-read-lane";

export const OBJECTIVE_ITERATION_OUTCOMES = ["continue", "awaiting_approval", "waiting", "blocked", "completed", "failed"] as const;
export type ObjectiveIterationOutcome = (typeof OBJECTIVE_ITERATION_OUTCOMES)[number];

const OptionalDecisionText = z.preprocess((value) => value === null ? undefined : value, z.string().min(1).max(2000).optional());
const OptionalDecisionRecord = z.preprocess((value) => value === null ? undefined : value, z.record(z.unknown()).optional());

const DecisionSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("query"), request: z.record(z.unknown()), reason: z.string().min(1).max(4000), nextStep: OptionalDecisionText }),
  z.object({ kind: z.literal("action"), actionType: z.string().min(1).max(200), payload: z.record(z.unknown()), reason: z.string().min(1).max(4000), nextStep: OptionalDecisionText }),
  z.object({ kind: z.literal("wait"), resumeAt: z.string().datetime(), condition: z.string().min(1).max(2000), reason: z.string().min(1).max(4000) }),
  z.object({ kind: z.literal("complete"), outcome: z.record(z.unknown()), reason: z.string().min(1).max(4000) }),
  z.object({ kind: z.literal("block"), reason: z.string().min(1).max(4000), recovery: OptionalDecisionText }),
  z.object({ kind: z.literal("fail"), reason: z.string().min(1).max(4000), failure: OptionalDecisionRecord }),
]);

export type ObjectiveDecision = z.infer<typeof DecisionSchema>;

export interface ObjectiveInspection extends Record<string, unknown> {
  inspectedAt: string;
  work: Record<string, unknown>;
  objective: Record<string, unknown>;
  companyGraph: Record<string, unknown>;
  businessState: unknown;
  companyContext?: unknown;
  actions: unknown[];
  operations: unknown[];
  receipts: unknown[];
  priorIterations: unknown[];
}

export interface ObjectiveDecisionPlanner {
  decide(input: {
    objective: string;
    inspection: ObjectiveInspection;
    allowedActionTypes: string[];
    actionPayloadSpec: string;
    remaining: { steps: number; actions: number; queries: number };
    tenantId: string;
    workId: string;
    channel: LLMChannel;
    signal?: AbortSignal;
    deadlineAt?: number;
  }): Promise<ObjectiveDecision>;
  providerName?: string;
}

export interface ObjectiveActionExecutor {
  draftObjectiveAction(params: {
    tenantId: string;
    actionType: string;
    payload: Record<string, unknown>;
    workId: string;
    instructionId: string | null;
    initiatedBy: string | null;
    authorityContext: Record<string, unknown>;
    objectiveStepId: string;
    actionId: string;
  }): Promise<{ action: DomainAction; result: ExecutionResult }>;
}

export interface ObjectiveBudgets {
  maxSteps?: number;
  maxActions?: number;
  maxQueries?: number;
  maxPlannerFailures?: number;
  maxConsecutiveNoProgress?: number;
  deadlineAt?: Date;
}

export interface StartObjectiveOptions extends ObjectiveBudgets {
  channel?: "voice" | "text" | "console";
  sessionId?: string;
  instructionId?: string;
  workId?: string;
  idempotencyKey?: string;
  activeContext?: Record<string, unknown>;
}

export interface StartObjectiveResult {
  workId: string;
  workInputId: string;
  instructionId: string;
  objectiveLoopId: string;
  state: ObjectiveIterationOutcome;
  duplicate: boolean;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function canonicalJson(value: unknown): string {
  if (value === undefined) return "null";
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const row = value as Record<string, unknown>;
  return `{${Object.keys(row).filter((key) => row[key] !== undefined).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(row[key])}`).join(",")}}`;
}

function hash(value: unknown): string {
  return createHash("sha256").update(canonicalJson(value)).digest("hex");
}

function bounded(value: unknown, maxBytes = 48_000): unknown {
  try {
    const serialized = JSON.stringify(value);
    if (serialized && Buffer.byteLength(serialized, "utf8") <= maxBytes) return value;
    return { bounded: true, bytes: serialized ? Buffer.byteLength(serialized, "utf8") : null, hash: hash(value) };
  } catch {
    return { bounded: true, unserializable: true };
  }
}

function semanticQueryResult(result: unknown): unknown {
  if (!isRecord(result)) return result;
  const value = isRecord(result.data) ? result.data : result;
  // Query receipts contain a fresh asOf timestamp and execution id on every read.
  // Those prove that a read happened, but they are not business progress. Keep them
  // in the persisted observation while comparing only the canonical result payload.
  const { asOf: _asOf, execution: _execution, meta: _meta, page: _page, source: _source, version: _version, ...businessValue } = value;
  return businessValue;
}

function failureShape(error: unknown): Record<string, unknown> {
  const message = error instanceof Error ? error.message : String(error);
  const name = error instanceof Error ? error.name : "Error";
  return {
    message,
    name,
    timeout: name === "AbortError" || /\b(?:timeout|timed out|deadline|aborted?)\b/i.test(message),
    at: new Date().toISOString(),
  };
}

function role(value: unknown): Role {
  return value === "dispatcher" || value === "technician" ? value : "owner";
}

function channel(value: string): LLMChannel {
  return value === "voice" || value === "text" || value === "console" ? value : "background";
}

/** Providers occasionally wrap JSON mode output in a sentence even when asked for
 * a bare object. Extract one balanced object, then let the strict decision schema
 * remain the authority. A second JSON value is rejected so commentary can never
 * smuggle an additional autonomous step into the iteration. */
export function parseObjectiveModelJson(raw: string): unknown {
  const cleaned = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  try {
    return JSON.parse(cleaned);
  } catch (originalError) {
    const start = cleaned.indexOf("{");
    if (start < 0) throw originalError;
    let depth = 0;
    let inString = false;
    let escaped = false;
    let end = -1;
    for (let index = start; index < cleaned.length; index += 1) {
      const character = cleaned[index]!;
      if (inString) {
        if (escaped) escaped = false;
        else if (character === "\\") escaped = true;
        else if (character === '"') inString = false;
        continue;
      }
      if (character === '"') inString = true;
      else if (character === "{") depth += 1;
      else if (character === "}") {
        depth -= 1;
        if (depth === 0) { end = index; break; }
      }
    }
    if (end < 0) throw originalError;
    const suffix = cleaned.slice(end + 1).replace(/^\s*```/, "").trim();
    if (/^[{[]/.test(suffix)) throw new Error("Objective decision provider returned more than one JSON value");
    return JSON.parse(cleaned.slice(start, end + 1));
  }
}

export class LLMObjectiveDecisionPlanner implements ObjectiveDecisionPlanner {
  private provider: LLMProvider | undefined;

  constructor(provider?: LLMProvider) {
    this.provider = provider;
  }

  get providerName(): string | undefined {
    return this.provider?.selectedProviderName ?? this.provider?.name;
  }

  async decide(input: Parameters<ObjectiveDecisionPlanner["decide"]>[0]): Promise<ObjectiveDecision> {
    this.provider ??= resolveProviderForPurpose("planning", input.channel);
    const raw = await this.provider.complete({
      system: [
        "You are JARVIS's governed objective-step decision maker.",
        "Choose exactly ONE bounded next step from the current canonical business inspection.",
        "Never emit a multi-step plan. Never assume an action worked; durable results will be inspected on the next iteration.",
        "Prefer a deterministic query when a missing canonical fact is needed. Use a typed action only for a real mutation.",
        "Complete when the objective is already satisfied by observed state, including when a previously expected action is no longer necessary.",
        "Wait only for a future business condition and provide an ISO resumeAt. Block when safe progress requires a human fact/integration. Fail only for a terminal objective failure.",
        `Allowed action types: ${input.allowedActionTypes.join(", ")}`,
        `Typed operational query intents: customer_lookup, customer_cohort, schedule_range, money_summary, work_list, inventory_status, agent_activity, business_state, company_context.`,
        "Action payload schemas follow. Field names and required fields are strict:",
        input.actionPayloadSpec,
        'Return one JSON object. Shapes: {"kind":"query","request":{"intent":"..."},"reason":"...","nextStep":"..."}; {"kind":"action","actionType":"...","payload":{},"reason":"...","nextStep":"..."}; {"kind":"wait","resumeAt":"ISO","condition":"...","reason":"..."}; {"kind":"complete","outcome":{},"reason":"..."}; {"kind":"block","reason":"...","recovery":"..."}; {"kind":"fail","reason":"...","failure":{}}.',
      ].join("\n"),
      user: JSON.stringify({ objective: input.objective, remainingBudget: input.remaining, canonicalInspection: input.inspection }),
      json: true,
      tenantId: input.tenantId,
      traceId: input.workId,
      purpose: "planning",
      channel: input.channel,
      signal: input.signal,
      deadlineAt: input.deadlineAt,
    });
    const parsed = DecisionSchema.safeParse(parseObjectiveModelJson(raw));
    if (!parsed.success) throw new Error(`Objective decision failed schema validation: ${parsed.error.issues.map((issue) => issue.message).join("; ")}`);
    return parsed.data;
  }
}

async function scheduleIteration(loop: { id: string; tenantId: string; workId: string; stepCount: number; revision: number }, runAt: Date, correlationId?: string): Promise<void> {
  const nextStep = loop.stepCount + 1;
  await enqueueJobAt(
    "run_objective_iteration",
    { tenantId: loop.tenantId, workId: loop.workId, objectiveLoopId: loop.id, expectedRevision: loop.revision, expectedStepNumber: nextStep },
    runAt,
    `objective:${loop.id}:revision:${loop.revision}:step:${nextStep}`,
    correlationId,
    "interactive",
    100,
  );
}

export async function startWorkObjective(objective: string, ctx: TenantContext, options: StartObjectiveOptions = {}): Promise<StartObjectiveResult> {
  const employeeId = ctx.employeeId ?? (/^[0-9a-f-]{36}$/i.test(ctx.userId) ? ctx.userId : undefined);
  const authority = employeeId
    ? await employeeAuthoritySnapshot({ ...ctx, employeeId }).catch(() => null)
    : null;
  const input = await receiveWork({
    tenantId: ctx.tenantId,
    instruction: objective,
    channel: options.channel ?? "text",
    sessionId: options.sessionId,
    instructionId: options.instructionId,
    workId: options.workId,
    userId: ctx.userId,
    idempotencyKey: options.idempotencyKey,
    activeContext: options.activeContext,
    authorityContext: {
      employeeId: employeeId ?? null,
      revision: authority?.revision ?? ctx.authorityRevision ?? null,
      roles: authority?.roles ?? ctx.authorityRoles ?? [],
      principal: ctx.userId,
    },
  });
  const loop = await withTenant(ctx.tenantId, async (db) => {
    const [existing] = await db.select().from(workObjectiveLoops).where(and(eq(workObjectiveLoops.tenantId, ctx.tenantId), eq(workObjectiveLoops.workId, input.workId))).limit(1);
    if (existing) {
      if (existing.objective !== objective && !input.duplicate) throw new Error("Work already owns a different objective; use redirect explicitly");
      return existing;
    }
    const [created] = await db.insert(workObjectiveLoops).values({
      tenantId: ctx.tenantId,
      workId: input.workId,
      objective,
      state: "continue",
      createdBy: ctx.employeeId ?? (/^[0-9a-f-]{36}$/i.test(ctx.userId) ? ctx.userId : null),
      initialChannel: options.channel ?? "text",
      maxSteps: options.maxSteps ?? 12,
      maxActions: options.maxActions ?? 5,
      maxQueries: options.maxQueries ?? 12,
      maxPlannerFailures: options.maxPlannerFailures ?? 3,
      maxConsecutiveNoProgress: options.maxConsecutiveNoProgress ?? 3,
      deadlineAt: options.deadlineAt ?? new Date(Date.now() + 7 * 86_400_000),
      reason: "Objective accepted; canonical inspection is next.",
      nextStep: "Inspect current canonical business state.",
    }).returning();
    if (!created) throw new Error("Unable to persist Work objective loop");
    return created;
  });
  await transitionWork(ctx.tenantId, input.workId, "executing", "objective_accepted", {
    objectiveLoopId: loop.id,
    objective,
    budgets: { maxSteps: loop.maxSteps, maxActions: loop.maxActions, maxQueries: loop.maxQueries },
  });
  await scheduleIteration(loop, new Date(), ctx.correlationId);
  return { workId: input.workId, workInputId: input.workInputId, instructionId: input.instructionId, objectiveLoopId: loop.id, state: loop.state, duplicate: input.duplicate };
}

async function workerContext(tenantId: string, workId: string): Promise<{ ctx: TenantContext; work: typeof works.$inferSelect }> {
  return withTenant(tenantId, async (db) => {
    const [work] = await db.select().from(works).where(and(eq(works.tenantId, tenantId), eq(works.id, workId))).limit(1);
    if (!work) throw new Error("Objective Work not found");
    const [employee] = work.createdBy ? await db.select({ id: users.id, role: users.role }).from(users).where(and(eq(users.tenantId, tenantId), eq(users.id, work.createdBy))).limit(1) : [];
    return {
      work,
      ctx: employee
        ? { tenantId, userId: employee.id, employeeId: employee.id, role: role(employee.role), correlationId: workId }
        : { tenantId, userId: "system:objective-loop", role: "owner", correlationId: workId },
    };
  });
}

async function claimStep(tenantId: string, loopId: string, leaseOwner: string, expectedRevision?: number, expectedStepNumber?: number) {
  return withTenant(tenantId, async (db) => {
    await db.execute(sql`SELECT id FROM ${workObjectiveLoops} WHERE ${workObjectiveLoops.id}=${loopId} AND ${workObjectiveLoops.tenantId}=${tenantId} FOR UPDATE`);
    const [loop] = await db.select().from(workObjectiveLoops).where(and(eq(workObjectiveLoops.tenantId, tenantId), eq(workObjectiveLoops.id, loopId))).limit(1);
    if (!loop) throw new Error("Objective loop not found");
    if (["blocked", "completed", "failed"].includes(loop.state)) return { loop, step: null, terminal: true } as const;
    if (expectedRevision !== undefined && expectedRevision !== loop.revision) return { loop, step: null, terminal: true } as const;
    if (loop.leaseUntil && loop.leaseUntil > new Date() && loop.leaseOwner !== leaseOwner) return { loop, step: null, terminal: true } as const;
    const [unfinished] = await db.select().from(workObjectiveSteps).where(and(eq(workObjectiveSteps.tenantId, tenantId), eq(workObjectiveSteps.objectiveLoopId, loop.id), sql`${workObjectiveSteps.completedAt} IS NULL`)).orderBy(desc(workObjectiveSteps.stepNumber)).limit(1);
    if (expectedStepNumber !== undefined && ((unfinished && unfinished.stepNumber !== expectedStepNumber) || (!unfinished && loop.stepCount >= expectedStepNumber))) {
      return { loop, step: null, terminal: true } as const;
    }
    const leaseUntil = new Date(Date.now() + 30_000);
    if (unfinished) {
      const [leased] = await db.update(workObjectiveLoops).set({ leaseOwner, leaseUntil, updatedAt: new Date() }).where(eq(workObjectiveLoops.id, loop.id)).returning();
      return { loop: leased!, step: unfinished, terminal: false } as const;
    }
    const stepNumber = loop.stepCount + 1;
    if (expectedStepNumber !== undefined && stepNumber !== expectedStepNumber) return { loop, step: null, terminal: true } as const;
    const [step] = await db.insert(workObjectiveSteps).values({
      tenantId,
      objectiveLoopId: loop.id,
      workId: loop.workId,
      stepNumber,
      idempotencyKey: `revision:${loop.revision}:step:${stepNumber}`,
      phase: "inspecting",
    }).returning();
    if (!step) throw new Error("Unable to persist objective iteration");
    const [updated] = await db.update(workObjectiveLoops).set({ stepCount: stepNumber, state: "continue", nextRunAt: null, leaseOwner, leaseUntil, updatedAt: new Date() }).where(eq(workObjectiveLoops.id, loop.id)).returning();
    return { loop: updated!, step, terminal: false } as const;
  });
}

async function releaseLease(tenantId: string, loopId: string, leaseOwner: string): Promise<void> {
  await withTenant(tenantId, (db) => db.update(workObjectiveLoops).set({ leaseOwner: null, leaseUntil: null, updatedAt: new Date() }).where(and(eq(workObjectiveLoops.tenantId, tenantId), eq(workObjectiveLoops.id, loopId), eq(workObjectiveLoops.leaseOwner, leaseOwner))));
}

async function currentIterationState(tenantId: string, loopId: string, stepId: string, revision: number, leaseOwner: string): Promise<{ current: boolean; state: ObjectiveIterationOutcome }> {
  return withTenant(tenantId, async (db) => {
    const [loop] = await db.select({ state: workObjectiveLoops.state, revision: workObjectiveLoops.revision, leaseOwner: workObjectiveLoops.leaseOwner }).from(workObjectiveLoops).where(and(eq(workObjectiveLoops.tenantId, tenantId), eq(workObjectiveLoops.id, loopId))).limit(1);
    const [step] = await db.select({ completedAt: workObjectiveSteps.completedAt }).from(workObjectiveSteps).where(and(eq(workObjectiveSteps.tenantId, tenantId), eq(workObjectiveSteps.id, stepId))).limit(1);
    if (!loop) throw new Error("Objective loop disappeared while checking its iteration lease");
    return { current: loop.revision === revision && loop.leaseOwner === leaseOwner && !step?.completedAt, state: loop.state };
  });
}

function latestHouseholdId(aggregate: Awaited<ReturnType<typeof workAggregate>>): string | null {
  if (!aggregate) return null;
  const links = aggregate.entityLinks as Array<{ entityType: string; entityId: string }>;
  const linked = links.find((link) => link.entityType === "household")?.entityId;
  if (linked) return linked;
  const activeContext = isRecord((aggregate.work as { activeContext?: unknown }).activeContext) ? (aggregate.work as { activeContext: Record<string, unknown> }).activeContext : {};
  return typeof activeContext.householdId === "string" ? activeContext.householdId : null;
}

async function inspectCanonicalState(tenantId: string, workId: string, loop: typeof workObjectiveLoops.$inferSelect, step: typeof workObjectiveSteps.$inferSelect, ctx: TenantContext): Promise<{ inspection: ObjectiveInspection; inspectionHash: string }> {
  const aggregate = await workAggregate(tenantId, workId);
  if (!aggregate) throw new Error("Objective Work aggregate not found");
  const businessRequest: OperationalQueryRequest = { intent: "business_state" };
  const businessAuthority = await evaluateAuthority(ctx, queryAuthorityRequest(businessRequest, workId));
  if (businessAuthority.outcome !== "allowed") throw new Error(`Authority denied canonical objective inspection: ${businessAuthority.reasonCode}`);
  const businessState = await executeOperationalQuery(tenantId, businessRequest, {
    workId,
    executionKey: `objective:${loop.id}:revision:${loop.revision}:step:${step.stepNumber}:inspect:business-state`,
  });
  const householdId = latestHouseholdId(aggregate);
  let companyContext: unknown;
  let companyAuthorityId: string | null = null;
  if (householdId) {
    const companyRequest: OperationalQueryRequest = { intent: "company_context", householdId };
    const authority = await evaluateAuthority(ctx, queryAuthorityRequest(companyRequest, workId));
    companyAuthorityId = authority.id;
    if (authority.outcome === "allowed") {
      companyContext = await executeOperationalQuery(tenantId, companyRequest, {
        workId,
        executionKey: `objective:${loop.id}:revision:${loop.revision}:step:${step.stepNumber}:inspect:company-context`,
      });
    }
  }
  const objectiveSteps = aggregate.objectiveSteps as Array<typeof workObjectiveSteps.$inferSelect>;
  const actions = (aggregate.actions as Array<typeof domainActions.$inferSelect>).slice(-20).map((action) => ({
    id: action.id, actionType: action.actionType, status: action.status, summary: action.summary, payload: bounded(action.payload, 8_000), objectiveStepId: action.objectiveStepId,
  }));
  const operations = (aggregate.operations as Array<Record<string, unknown>>).slice(-10).map((operation) => ({
    id: operation.id, domainActionId: operation.domainActionId, operationType: operation.operationType, status: operation.status,
    targetCount: operation.targetCount, pendingCount: operation.pendingCount, runningCount: operation.runningCount,
    succeededCount: operation.succeededCount, failedCount: operation.failedCount, retryCount: operation.retryCount,
    finalOutcome: bounded(operation.finalOutcome, 8_000), failure: bounded(operation.failure, 8_000),
  }));
  const receipts = (aggregate.receipts as Array<Record<string, unknown>>).slice(-12).map((receipt) => ({
    id: receipt.id, domainActionId: receipt.domainActionId, operationId: receipt.operationId, objective: receipt.objective,
    actualResult: bounded(receipt.actualResult, 8_000), failure: bounded(receipt.failure, 8_000), finalizedAt: receipt.finalizedAt,
  }));
  const inspection: ObjectiveInspection = {
    inspectedAt: new Date().toISOString(),
    work: { id: workId, status: (aggregate.work as { status: string }).status, activeContext: (aggregate.work as { activeContext: unknown }).activeContext },
    objective: {
      id: loop.id, text: loop.objective, state: loop.state, revision: loop.revision,
      budget: { stepCount: loop.stepCount, maxSteps: loop.maxSteps, actionCount: loop.actionCount, maxActions: loop.maxActions, queryCount: loop.queryCount, maxQueries: loop.maxQueries },
    },
    companyGraph: { householdId, entityLinks: aggregate.entityLinks },
    businessState: bounded(businessState, 40_000),
    ...(companyContext === undefined ? {} : { companyContext: bounded(companyContext, 40_000) }),
    actions,
    operations,
    receipts,
    priorIterations: objectiveSteps.filter((item) => item.id !== step.id).slice(-8).map((item) => ({
      stepNumber: item.stepNumber, decisionKind: item.decisionKind, decisionReason: item.decisionReason,
      outcome: item.iterationOutcome, observation: bounded(item.observation, 8_000), progressMade: item.progressMade,
    })),
    inspectionAuthority: { businessState: businessAuthority.id, companyContext: companyAuthorityId },
  };
  return { inspection, inspectionHash: hash(inspection) };
}

function unresolvedEffect(inspection: ObjectiveInspection): { outcome: "awaiting_approval" | "waiting"; reason: string; runAt?: Date } | null {
  const actions = inspection.actions as Array<{ id: string; status: string }>;
  const operations = inspection.operations as Array<{ status: string }>;
  if (actions.some((action) => action.status === "pending" || action.status === "needs_human_review")) {
    return { outcome: "awaiting_approval", reason: "A consequential action is durably paused at the approval boundary." };
  }
  if (actions.some((action) => action.status === "approved" || action.status === "executing") || operations.some((operation) => ["queued", "running", "awaiting_approval"].includes(operation.status))) {
    return { outcome: "waiting", reason: "A prior typed action or durable operation is still producing its real result.", runAt: new Date(Date.now() + 60_000) };
  }
  return null;
}

async function beginPlannerAttempt(tenantId: string, loopId: string, stepId: string, inspectionHash: string) {
  return withTenant(tenantId, async (db) => {
    const [latest] = await db.select({ count: sql<number>`count(*)::int` }).from(workObjectivePlannerAttempts).where(and(eq(workObjectivePlannerAttempts.tenantId, tenantId), eq(workObjectivePlannerAttempts.objectiveStepId, stepId)));
    const [attempt] = await db.insert(workObjectivePlannerAttempts).values({
      tenantId, objectiveLoopId: loopId, objectiveStepId: stepId, attempt: (latest?.count ?? 0) + 1, status: "planning", inspectionHash,
    }).returning();
    if (!attempt) throw new Error("Unable to persist objective planner attempt");
    await db.update(workObjectiveSteps).set({ phase: "deciding", inspectionHash, failure: null }).where(eq(workObjectiveSteps.id, stepId));
    return attempt;
  });
}

async function finishPlannerAttempt(tenantId: string, attemptId: string, status: "succeeded" | "failed" | "timed_out", provider: string | undefined, decision?: ObjectiveDecision, failure?: Record<string, unknown>): Promise<void> {
  await withTenant(tenantId, (db) => db.update(workObjectivePlannerAttempts).set({
    status, provider: provider ?? null, decision: decision ?? null, failure: failure ?? null, completedAt: new Date(),
  }).where(and(eq(workObjectivePlannerAttempts.tenantId, tenantId), eq(workObjectivePlannerAttempts.id, attemptId))));
}

async function finishIteration(params: {
  tenantId: string;
  loop: typeof workObjectiveLoops.$inferSelect;
  step: typeof workObjectiveSteps.$inferSelect;
  outcome: ObjectiveIterationOutcome;
  reason: string;
  nextStep?: string | null;
  observation?: unknown;
  progressMade: boolean;
  decision?: ObjectiveDecision;
  authorityDecisionId?: string | null;
  queryExecutionId?: string | null;
  domainActionId?: string | null;
  scheduledFor?: Date | null;
  failure?: unknown;
  actionIncrement?: number;
  queryIncrement?: number;
}): Promise<{ outcome: ObjectiveIterationOutcome; loop: typeof workObjectiveLoops.$inferSelect }> {
  const result = await withTenant(params.tenantId, async (db) => {
    await db.execute(sql`SELECT id FROM ${workObjectiveLoops} WHERE ${workObjectiveLoops.id}=${params.loop.id} FOR UPDATE`);
    const [current] = await db.select().from(workObjectiveLoops).where(eq(workObjectiveLoops.id, params.loop.id)).limit(1);
    if (!current) throw new Error("Objective loop disappeared while finishing an iteration");
    const [currentStep] = await db.select({ completedAt: workObjectiveSteps.completedAt }).from(workObjectiveSteps).where(and(eq(workObjectiveSteps.tenantId, params.tenantId), eq(workObjectiveSteps.id, params.step.id))).limit(1);
    if (current.revision !== params.loop.revision || current.leaseOwner !== params.loop.leaseOwner || currentStep?.completedAt) {
      return { outcome: current.state, loop: current, superseded: true as const };
    }
    const nextNoProgress = params.outcome === "continue"
      ? (params.progressMade ? 0 : current.consecutiveNoProgress + 1)
      : current.consecutiveNoProgress;
    let outcome = params.outcome;
    let reason = params.reason;
    if (outcome === "continue" && current.stepCount >= current.maxSteps) {
      outcome = "blocked";
      reason = `Objective stopped at the configured ${current.maxSteps}-step limit.`;
    } else if (outcome === "continue" && nextNoProgress >= current.maxConsecutiveNoProgress) {
      outcome = "blocked";
      reason = `Objective stopped after ${nextNoProgress} consecutive iterations without observed progress.`;
    }
    await db.update(workObjectiveSteps).set({
      phase: "finished",
      decisionKind: params.decision?.kind ?? (outcome === "waiting" ? "wait" : outcome === "completed" ? "complete" : outcome === "blocked" ? "block" : outcome === "failed" ? "fail" : null),
      decision: params.decision ?? null,
      decisionReason: reason,
      authorityDecisionId: params.authorityDecisionId ?? null,
      queryExecutionId: params.queryExecutionId ?? null,
      domainActionId: params.domainActionId ?? null,
      observation: bounded(params.observation),
      progressMade: params.progressMade,
      iterationOutcome: outcome,
      scheduledFor: params.scheduledFor ?? null,
      failure: params.failure ? bounded(params.failure, 16_000) : null,
      completedAt: new Date(),
    }).where(and(eq(workObjectiveSteps.tenantId, params.tenantId), eq(workObjectiveSteps.id, params.step.id)));
    const [updated] = await db.update(workObjectiveLoops).set({
      state: outcome,
      actionCount: current.actionCount + (params.actionIncrement ?? 0),
      queryCount: current.queryCount + (params.queryIncrement ?? 0),
      consecutiveNoProgress: nextNoProgress,
      nextRunAt: params.scheduledFor ?? null,
      reason,
      nextStep: params.nextStep ?? null,
      lastObservation: bounded(params.observation),
      completedAt: outcome === "completed" || outcome === "failed" ? new Date() : null,
      leaseOwner: null,
      leaseUntil: null,
      updatedAt: new Date(),
    }).where(eq(workObjectiveLoops.id, current.id)).returning();
    return { outcome, loop: updated!, superseded: false as const };
  });
  if (result.superseded) return result;
  const workStatus = result.outcome === "continue" ? "executing" : result.outcome;
  await transitionWork(params.tenantId, params.loop.workId, workStatus, "objective_iteration_finished", {
    objectiveLoopId: params.loop.id,
    objectiveStepId: params.step.id,
    stepNumber: params.step.stepNumber,
    outcome: result.outcome,
    reason: result.loop.reason,
  }, result.outcome === "completed"
    ? { finalOutcome: { kind: "objective", objectiveLoopId: params.loop.id, observation: bounded(params.observation), reason: result.loop.reason } }
    : result.outcome === "failed" ? { failure: { kind: "objective", objectiveLoopId: params.loop.id, reason: result.loop.reason, detail: bounded(params.failure) } } : {});
  if (result.outcome === "continue") await scheduleIteration(result.loop, new Date(), params.loop.workId);
  else if (result.outcome === "waiting" && params.scheduledFor) await scheduleIteration(result.loop, params.scheduledFor, params.loop.workId);
  return result;
}

async function latestActionObservation(tenantId: string, workId: string, actionId: string): Promise<Record<string, unknown>> {
  const aggregate = await workAggregate(tenantId, workId);
  if (!aggregate) return { actionId, missing: true };
  const action = (aggregate.actions as Array<Record<string, unknown>>).find((item) => item.id === actionId);
  const operations = (aggregate.operations as Array<Record<string, unknown>>).filter((item) => item.domainActionId === actionId);
  const receipts = (aggregate.receipts as Array<Record<string, unknown>>).filter((item) => item.domainActionId === actionId);
  return { action: bounded(action, 12_000), operations: bounded(operations, 16_000), receipts: bounded(receipts, 20_000) };
}

function operationStillRunning(observation: Record<string, unknown>): boolean {
  const operations = Array.isArray(observation.operations) ? observation.operations as Array<Record<string, unknown>> : [];
  return operations.some((operation) => ["awaiting_approval", "queued", "running"].includes(String(operation.status)));
}

export class ObjectiveLoopRuntime {
  constructor(
    private plugins: PluginRegistry,
    private actionExecutor: ObjectiveActionExecutor,
    private planner: ObjectiveDecisionPlanner = new LLMObjectiveDecisionPlanner(),
  ) {}

  async runIteration(params: { tenantId: string; workId: string; objectiveLoopId: string; expectedRevision?: number; expectedStepNumber?: number; signal?: AbortSignal }): Promise<ObjectiveIterationOutcome> {
    const leaseOwner = randomUUID();
    const claimed = await claimStep(params.tenantId, params.objectiveLoopId, leaseOwner, params.expectedRevision, params.expectedStepNumber);
    if (claimed.terminal || !claimed.step) return claimed.loop.state;
    const loop = claimed.loop;
    const step = claimed.step;
    if (loop.workId !== params.workId) throw new Error("Objective job Work does not match its loop");
    if (step.stepNumber > loop.maxSteps) {
      return (await finishIteration({ tenantId: params.tenantId, loop, step, outcome: "blocked", reason: `Objective stopped at the configured ${loop.maxSteps}-step limit.`, progressMade: false })).outcome;
    }
    if (new Date() >= loop.deadlineAt) {
      return (await finishIteration({ tenantId: params.tenantId, loop, step, outcome: "failed", reason: "Objective deadline expired before another safe step could begin.", progressMade: false, failure: { deadlineAt: loop.deadlineAt.toISOString() } })).outcome;
    }
    const { ctx, work } = await workerContext(params.tenantId, params.workId);
    let inspection: ObjectiveInspection;
    let inspectionHash: string;
    try {
      const inspected = await inspectCanonicalState(params.tenantId, params.workId, loop, step, ctx);
      inspection = inspected.inspection;
      inspectionHash = inspected.inspectionHash;
    } catch (error) {
      const failure = failureShape(error);
      if (/^Authority denied/i.test(String(failure.message))) {
        return (await finishIteration({ tenantId: params.tenantId, loop, step, outcome: "blocked", reason: String(failure.message), progressMade: false, failure })).outcome;
      }
      const [updated] = await withTenant(params.tenantId, async (db) => {
        await db.update(workObjectiveSteps).set({ phase: "inspecting", failure }).where(eq(workObjectiveSteps.id, step.id));
        return db.update(workObjectiveLoops).set({ plannerFailureCount: sql`${workObjectiveLoops.plannerFailureCount} + 1`, reason: `Canonical inspection failed: ${String(failure.message)}`, updatedAt: new Date() }).where(eq(workObjectiveLoops.id, loop.id)).returning();
      });
      const next = updated?.plannerFailureCount ?? loop.plannerFailureCount + 1;
      if (next >= loop.maxPlannerFailures) {
        return (await finishIteration({ tenantId: params.tenantId, loop: updated ?? loop, step, outcome: "failed", reason: "Canonical inspection exhausted its configured recovery attempts.", progressMade: false, failure })).outcome;
      }
      await transitionWork(params.tenantId, params.workId, "recovery", "objective_inspection_failed", { objectiveLoopId: loop.id, objectiveStepId: step.id, failure });
      await releaseLease(params.tenantId, loop.id, leaseOwner);
      throw error;
    }
    await withTenant(params.tenantId, (db) => db.update(workObjectiveSteps).set({ inspection: bounded(inspection, 128_000) as object, inspectionHash, phase: "deciding" }).where(eq(workObjectiveSteps.id, step.id)));

    const unresolved = unresolvedEffect(inspection);
    if (unresolved) {
      return (await finishIteration({
        tenantId: params.tenantId, loop, step, outcome: unresolved.outcome, reason: unresolved.reason,
        nextStep: unresolved.outcome === "awaiting_approval" ? "Resume this same objective after authorization." : "Observe the durable result when it is due.",
        observation: { canonicalInspectionHash: inspectionHash }, progressMade: false, scheduledFor: unresolved.runAt ?? null,
      })).outcome;
    }

    const attempt = await beginPlannerAttempt(params.tenantId, loop.id, step.id, inspectionHash);
    let decision: ObjectiveDecision;
    try {
      decision = await this.planner.decide({
        objective: loop.objective,
        inspection,
        allowedActionTypes: this.plugins.actionTypes(),
        actionPayloadSpec: this.plugins.payloadSpecJson(),
        remaining: { steps: Math.max(0, loop.maxSteps - loop.stepCount), actions: Math.max(0, loop.maxActions - loop.actionCount), queries: Math.max(0, loop.maxQueries - loop.queryCount) },
        tenantId: params.tenantId,
        workId: params.workId,
        channel: channel(loop.initialChannel),
        signal: params.signal,
        deadlineAt: Math.min(loop.deadlineAt.getTime(), Date.now() + 15_000),
      });
      if (decision.kind === "query") {
        const validated = validateOperationalQueryRequest(decision.request);
        if (!validated.success) throw new Error(`Objective decision failed semantic validation: ${validated.error}`);
      }
      if (decision.kind === "action") {
        const plugin = this.plugins.resolve(decision.actionType);
        if (!plugin) throw new Error(`Objective decision failed semantic validation: unregistered action type ${decision.actionType}`);
        const schema = plugin.payloadSchemas?.[decision.actionType];
        const payload = schema?.safeParse(decision.payload);
        if (payload && !payload.success) throw new Error(`Objective decision failed semantic validation: ${payload.error.issues.map((issue) => issue.message).join("; ")}`);
      }
      await finishPlannerAttempt(params.tenantId, attempt.id, "succeeded", this.planner.providerName, decision);
    } catch (error) {
      const failure = failureShape(error);
      await finishPlannerAttempt(params.tenantId, attempt.id, failure.timeout ? "timed_out" : "failed", this.planner.providerName, undefined, failure);
      const [updated] = await withTenant(params.tenantId, (db) => db.update(workObjectiveLoops).set({ plannerFailureCount: sql`${workObjectiveLoops.plannerFailureCount} + 1`, reason: String(failure.message), updatedAt: new Date() }).where(eq(workObjectiveLoops.id, loop.id)).returning());
      if ((updated?.plannerFailureCount ?? loop.plannerFailureCount + 1) >= loop.maxPlannerFailures) {
        return (await finishIteration({ tenantId: params.tenantId, loop: updated ?? loop, step, outcome: "failed", reason: "Objective decision provider exhausted its configured recovery attempts.", progressMade: false, failure })).outcome;
      }
      await withTenant(params.tenantId, (db) => db.update(workObjectiveSteps).set({ phase: "deciding", failure }).where(eq(workObjectiveSteps.id, step.id)));
      await transitionWork(params.tenantId, params.workId, "recovery", "objective_planner_attempt_failed", { objectiveLoopId: loop.id, objectiveStepId: step.id, attempt: attempt.attempt, failure });
      await releaseLease(params.tenantId, loop.id, leaseOwner);
      throw error;
    }

    const currency = await currentIterationState(params.tenantId, loop.id, step.id, loop.revision, leaseOwner);
    if (!currency.current) {
      await releaseLease(params.tenantId, loop.id, leaseOwner);
      return currency.state;
    }

    await withTenant(params.tenantId, (db) => db.update(workObjectiveSteps).set({ phase: decision.kind === "query" || decision.kind === "action" ? "acting" : "observing", decisionKind: decision.kind, decision, decisionReason: decision.reason }).where(eq(workObjectiveSteps.id, step.id)));

    if (decision.kind === "complete") {
      return (await finishIteration({ tenantId: params.tenantId, loop, step, outcome: "completed", reason: decision.reason, decision, observation: decision.outcome, progressMade: true })).outcome;
    }
    if (decision.kind === "block") {
      return (await finishIteration({ tenantId: params.tenantId, loop, step, outcome: "blocked", reason: decision.reason, nextStep: decision.recovery, decision, observation: { recovery: decision.recovery ?? null }, progressMade: false })).outcome;
    }
    if (decision.kind === "fail") {
      return (await finishIteration({ tenantId: params.tenantId, loop, step, outcome: "failed", reason: decision.reason, decision, observation: decision.failure, failure: decision.failure, progressMade: false })).outcome;
    }
    if (decision.kind === "wait") {
      const requested = new Date(decision.resumeAt);
      if (Number.isNaN(requested.getTime()) || requested <= new Date() || requested > loop.deadlineAt) {
        return (await finishIteration({ tenantId: params.tenantId, loop, step, outcome: "blocked", reason: "The proposed wait time was outside the objective's safe deadline.", decision, observation: { requestedResumeAt: decision.resumeAt, deadlineAt: loop.deadlineAt.toISOString() }, progressMade: false })).outcome;
      }
      return (await finishIteration({ tenantId: params.tenantId, loop, step, outcome: "waiting", reason: decision.reason, nextStep: decision.condition, decision, observation: { waitingFor: decision.condition }, progressMade: false, scheduledFor: requested })).outcome;
    }

    if (decision.kind === "query") {
      if (loop.queryCount >= loop.maxQueries) {
        return (await finishIteration({ tenantId: params.tenantId, loop, step, outcome: "blocked", reason: `Objective exhausted its ${loop.maxQueries}-query budget.`, decision, progressMade: false })).outcome;
      }
      const validated = validateOperationalQueryRequest(decision.request);
      if (!validated.success) {
        return (await finishIteration({ tenantId: params.tenantId, loop, step, outcome: "blocked", reason: `Model selected an invalid typed query: ${validated.error}`, decision, progressMade: false })).outcome;
      }
      const authority = await evaluateAuthority(ctx, queryAuthorityRequest(validated.request, params.workId));
      if (authority.outcome !== "allowed") {
        return (await finishIteration({ tenantId: params.tenantId, loop, step, outcome: "blocked", reason: `Authority denied the selected query: ${authority.reasonCode}`, decision, authorityDecisionId: authority.id, observation: { authority }, progressMade: false })).outcome;
      }
      try {
        const result = await executeOperationalQuery(params.tenantId, validated.request, {
          workId: params.workId,
          executionKey: `objective:${loop.id}:revision:${loop.revision}:step:${step.stepNumber}:decision-query`,
        });
        const executionId = result.execution?.id ?? null;
        const prior = isRecord(loop.lastObservation) ? loop.lastObservation : {};
        const semanticHash = hash(semanticQueryResult(result));
        const observation = { query: validated.request, result: bounded(result, 40_000), semanticHash };
        return (await finishIteration({
          tenantId: params.tenantId, loop, step, outcome: "continue", reason: decision.reason, nextStep: decision.nextStep,
          decision, authorityDecisionId: authority.id, queryExecutionId: executionId, observation,
          progressMade: prior.semanticHash !== semanticHash, queryIncrement: 1,
        })).outcome;
      } catch (error) {
        const failure = failureShape(error);
        return (await finishIteration({ tenantId: params.tenantId, loop, step, outcome: "continue", reason: `Typed query failed; the next iteration must choose a recovery step: ${String(failure.message)}`, nextStep: "Recover from the failed read or block truthfully.", decision, authorityDecisionId: authority.id, observation: { failure }, failure, progressMade: false, queryIncrement: 1 })).outcome;
      }
    }

    if (loop.actionCount >= loop.maxActions) {
      return (await finishIteration({ tenantId: params.tenantId, loop, step, outcome: "blocked", reason: `Objective exhausted its ${loop.maxActions}-action budget.`, decision, progressMade: false })).outcome;
    }
    if (!this.plugins.resolve(decision.actionType)) {
      return (await finishIteration({ tenantId: params.tenantId, loop, step, outcome: "blocked", reason: `Model selected unregistered action type ${decision.actionType}.`, decision, progressMade: false })).outcome;
    }
    const effectHash = hash({ actionType: decision.actionType, payload: decision.payload });
    const priorSteps = await withTenant(params.tenantId, (db) => db.select().from(workObjectiveSteps).where(and(eq(workObjectiveSteps.tenantId, params.tenantId), eq(workObjectiveSteps.objectiveLoopId, loop.id))).orderBy(asc(workObjectiveSteps.stepNumber)));
    const duplicate = priorSteps.find((item) => item.id !== step.id && item.domainActionId && isRecord(item.decision) && item.decision.kind === "action" && hash({ actionType: item.decision.actionType, payload: item.decision.payload }) === effectHash);
    if (duplicate?.domainActionId) {
      const observation = await latestActionObservation(params.tenantId, params.workId, duplicate.domainActionId);
      return (await finishIteration({ tenantId: params.tenantId, loop, step, outcome: "continue", reason: "The same typed action was already attempted; its durable result was observed instead of repeating the side effect.", nextStep: decision.nextStep, decision, domainActionId: duplicate.domainActionId, observation: { deduplicated: true, priorObjectiveStepId: duplicate.id, ...observation }, progressMade: false })).outcome;
    }

    const actionId = randomUUID();
    try {
      const { action, result } = await this.actionExecutor.draftObjectiveAction({
        tenantId: params.tenantId,
        actionType: decision.actionType,
        payload: decision.payload,
        workId: params.workId,
        instructionId: null,
        initiatedBy: work.createdBy,
        authorityContext: isRecord(work.authorityContext) ? work.authorityContext : {},
        objectiveStepId: step.id,
        actionId,
      });
      const observation = await latestActionObservation(params.tenantId, params.workId, action.id);
      const awaitingApproval = Boolean(result.output?.gated || result.output?.pendingConfirmation) || (isRecord(observation.action) && ["pending", "needs_human_review"].includes(String(observation.action.status)));
      const waiting = !awaitingApproval && (operationStillRunning(observation) || (isRecord(observation.action) && ["approved", "executing"].includes(String(observation.action.status))));
      const outcome: ObjectiveIterationOutcome = awaitingApproval ? "awaiting_approval" : waiting ? "waiting" : "continue";
      const scheduledFor = waiting ? new Date(Date.now() + 60_000) : null;
      return (await finishIteration({
        tenantId: params.tenantId, loop, step, outcome,
        reason: awaitingApproval ? "The selected consequential action is durably paused for approval." : waiting ? "The typed action is still producing its durable result." : result.status === "success" ? decision.reason : `The action failed; the next iteration will inspect the receipt and choose recovery: ${result.error ?? "unknown failure"}`,
        nextStep: awaitingApproval ? "Resume this objective after authorization." : waiting ? "Observe the actual operation result." : decision.nextStep,
        decision, domainActionId: action.id, observation: { executionResult: bounded(result, 12_000), durable: observation },
        progressMade: result.status === "success" && !awaitingApproval, scheduledFor, actionIncrement: 1,
      })).outcome;
    } catch (error) {
      const failure = failureShape(error);
      return (await finishIteration({ tenantId: params.tenantId, loop, step, outcome: "continue", reason: `The action/provider failed before a successful result; recovery will be decided from canonical state: ${String(failure.message)}`, nextStep: "Inspect the failed action/receipt and select one safe recovery step.", decision, observation: { failure }, failure, progressMade: false, actionIncrement: 1 })).outcome;
    }
  }
}

export async function controlWorkObjective(params: {
  tenantId: string;
  workId: string;
  command: "continue" | "interrupt" | "redirect";
  actorId: string;
  objective?: string;
  correlationId?: string;
}): Promise<typeof workObjectiveLoops.$inferSelect> {
  const loop = await withTenant(params.tenantId, async (db) => {
    await db.execute(sql`SELECT id FROM ${workObjectiveLoops} WHERE ${workObjectiveLoops.workId}=${params.workId} AND ${workObjectiveLoops.tenantId}=${params.tenantId} FOR UPDATE`);
    const [current] = await db.select().from(workObjectiveLoops).where(and(eq(workObjectiveLoops.tenantId, params.tenantId), eq(workObjectiveLoops.workId, params.workId))).limit(1);
    if (!current) throw new Error("Work has no objective loop");
    if (params.command === "interrupt" || params.command === "redirect") {
      const stepIds = (await db.select({ id: workObjectiveSteps.id }).from(workObjectiveSteps).where(and(eq(workObjectiveSteps.tenantId, params.tenantId), eq(workObjectiveSteps.objectiveLoopId, current.id)))).map((step) => step.id);
      if (stepIds.length > 0) {
        const cancelled = await db.update(domainActions).set({ status: "rejected", executionStartedAt: null }).where(and(
          eq(domainActions.tenantId, params.tenantId),
          inArray(domainActions.objectiveStepId, stepIds),
          inArray(domainActions.status, ["draft", "pending", "approved", "needs_human_review"]),
        )).returning({ id: domainActions.id });
        if (cancelled.length > 0) {
          await db.insert(actionLog).values(cancelled.map((action) => ({
            tenantId: params.tenantId,
            domainActionId: action.id,
            step: "rejected",
            input: { by: params.actorId, command: params.command },
            output: { reason: "Objective was interrupted or redirected before execution." },
          })));
        }
      }
    }
    await db.update(workObjectiveSteps).set({
      phase: "finished",
      iterationOutcome: "blocked",
      decisionReason: `Iteration superseded by ${params.command} from ${params.actorId}.`,
      progressMade: false,
      completedAt: new Date(),
    }).where(and(eq(workObjectiveSteps.tenantId, params.tenantId), eq(workObjectiveSteps.objectiveLoopId, current.id), sql`${workObjectiveSteps.completedAt} IS NULL`));
    if (params.command === "interrupt") {
      const [updated] = await db.update(workObjectiveLoops).set({ state: "blocked", reason: `Interrupted by ${params.actorId}.`, nextStep: "Explicitly continue or redirect this objective.", nextRunAt: null, leaseOwner: null, leaseUntil: null, updatedAt: new Date() }).where(eq(workObjectiveLoops.id, current.id)).returning();
      return updated!;
    }
    if (current.state === "completed") throw new Error("Completed objective cannot be continued or redirected");
    if (params.command === "redirect" && !params.objective?.trim()) throw new Error("Redirect requires a non-empty objective");
    const [updated] = await db.update(workObjectiveLoops).set({
      ...(params.command === "redirect" ? { objective: params.objective!.trim() } : {}),
      // A control transition starts a new scheduling generation even when the text
      // is unchanged. This makes any pre-interrupt job provably stale and gives the
      // resumed first step a fresh durable idempotency key.
      revision: current.revision + 1,
      state: "continue", reason: params.command === "redirect" ? `Objective redirected by ${params.actorId}.` : `Objective continued by ${params.actorId}.`,
      nextStep: "Inspect current canonical business state.", nextRunAt: new Date(), completedAt: null, leaseOwner: null, leaseUntil: null, updatedAt: new Date(),
    }).where(eq(workObjectiveLoops.id, current.id)).returning();
    return updated!;
  });
  const workStatus = loop.state === "continue" ? "executing" : loop.state;
  await transitionWork(params.tenantId, params.workId, workStatus, `objective_${params.command}`, { objectiveLoopId: loop.id, actorId: params.actorId, revision: loop.revision, objective: params.command === "redirect" ? loop.objective : undefined });
  if (loop.state === "continue") await scheduleIteration(loop, new Date(), params.correlationId);
  return loop;
}

/** Periodic restart/operation recovery. It only enqueues due work; the iteration job
 * performs the tenant-scoped inspection and all authority checks. */
export async function recoverRunnableObjectives(tenantId: string): Promise<number> {
  const loops = await withTenant(tenantId, (db) => db.select().from(workObjectiveLoops).where(and(
    eq(workObjectiveLoops.tenantId, tenantId),
    sql`${workObjectiveLoops.state} IN ('continue','waiting','awaiting_approval')`,
  )));
  let enqueued = 0;
  for (const loop of loops) {
    const due = loop.state === "continue" || (loop.state === "waiting" && (!loop.nextRunAt || loop.nextRunAt <= new Date()));
    if (due) {
      await scheduleIteration(loop, new Date(), loop.workId);
      enqueued += 1;
      continue;
    }
    if (loop.state === "awaiting_approval") {
      const aggregate = await workAggregate(tenantId, loop.workId);
      const actions = (aggregate?.actions ?? []) as Array<{ status: string }>;
      if (!actions.some((action) => action.status === "pending" || action.status === "needs_human_review")) {
        await scheduleIteration(loop, new Date(), loop.workId);
        enqueued += 1;
      }
    }
  }
  return enqueued;
}

/** Approval/action boundaries call this after the real action status changes. The
 * original awaiting-approval iteration remains immutable evidence; a new iteration
 * re-inspects the action, receipt, operation, and Company Graph before deciding. */
export async function resumeObjectiveForAction(tenantId: string, actionId: string): Promise<boolean> {
  const loop = await withTenant(tenantId, async (db) => {
    const [action] = await db.select({ objectiveStepId: domainActions.objectiveStepId }).from(domainActions).where(and(eq(domainActions.tenantId, tenantId), eq(domainActions.id, actionId))).limit(1);
    if (!action?.objectiveStepId) return null;
    const [step] = await db.select({ objectiveLoopId: workObjectiveSteps.objectiveLoopId }).from(workObjectiveSteps).where(and(eq(workObjectiveSteps.tenantId, tenantId), eq(workObjectiveSteps.id, action.objectiveStepId))).limit(1);
    if (!step) return null;
    const [current] = await db.select().from(workObjectiveLoops).where(and(eq(workObjectiveLoops.tenantId, tenantId), eq(workObjectiveLoops.id, step.objectiveLoopId))).limit(1);
    if (!current || ["blocked", "completed", "failed"].includes(current.state)) return null;
    const [updated] = await db.update(workObjectiveLoops).set({ state: "continue", nextRunAt: new Date(), reason: "The approved/action result changed; canonical observation is due.", nextStep: "Observe the real action, receipt, operation, and business state.", updatedAt: new Date() }).where(eq(workObjectiveLoops.id, current.id)).returning();
    return updated ?? null;
  });
  if (!loop) return false;
  await scheduleIteration(loop, new Date(), loop.workId);
  return true;
}
