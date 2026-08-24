// Compensation acceptance (Phase 2 proof item 4): hold an appointment mid-workflow,
// force a compensation, confirm the hold releases and the compensation_case resolves.
// Communications has no meaningful compensate() (you can't unsend a call) — that's
// covered by compensateStep()'s explicit "no compensate() procedure" failure path,
// tested here too, rather than skipped silently.

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import pg from "pg";
import { randomUUID } from "node:crypto";
import { migrate } from "../../packages/db/migrate";
import { withTenant, closePool, tenants, workflowSteps, workflowRuns, commands, integrationOperations, compensationCases, appointments, decisionReceipts, domainActions, businessEffects, authorityDecisions } from "@finnor/db";
import { eq } from "drizzle-orm";
import { submitCommand, executeCapability, compensateStep, claimStep, completeStep } from "@finnor/workflow-runtime";
import { POST as compensateRoute } from "../../apps/api/app/api/workflows/steps/[id]/compensate/route";
import {
  holdAppointmentContract,
  emulatorSchedulingBinding,
  nativeSchedulingBinding,
  resetSchedulingEmulator,
  getEmulatorHoldStatus,
  HoldAppointmentInputSchema,
  sendConfirmationContract,
  emulatorCommunicationsBinding,
  resetCommunicationsEmulator,
  SendConfirmationInputSchema,
} from "@finnor/tools";

const DB_URL = process.env.DATABASE_URL ?? "postgres://finnor:finnor@localhost:5432/finnor";
const TENANT_ID = "00000000-0000-4000-8000-0000000000d4";

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

async function newStep(stepType: string): Promise<string> {
  const submitted = await withTenant(TENANT_ID, (db) =>
    submitCommand(db, { tenantId: TENANT_ID, commandType: "compensation_test", payload: {}, workflowType: "compensation_test", steps: [{ stepType, payload: {} }] }),
  );
  const stepId = submitted.stepIds[0]!;
  // The worker claims a step before running a capability. Claim it here too so this
  // direct capability harness opens the one lifecycle receipt compensation updates.
  expect(await claimStep(TENANT_ID, stepId)).toBeTruthy();
  return stepId;
}

describe.skipIf(!available)("compensation", () => {
  beforeAll(async () => {
    process.env.DATABASE_URL = DB_URL;
    process.env.AUTH_DEV_BYPASS = "1";
    await migrate(DB_URL);
    await withTenant(TENANT_ID, (db) => db.insert(tenants).values({ id: TENANT_ID, name: "Compensation Test Dealer" }).onConflictDoNothing());
  });
  afterAll(async () => {
    await withTenant(TENANT_ID, async (db) => {
      await db.delete(compensationCases).where(eq(compensationCases.tenantId, TENANT_ID));
      await db.delete(decisionReceipts).where(eq(decisionReceipts.tenantId, TENANT_ID));
      await db.delete(integrationOperations).where(eq(integrationOperations.tenantId, TENANT_ID));
      await db.delete(appointments).where(eq(appointments.tenantId, TENANT_ID));
      await db.delete(workflowSteps).where(eq(workflowSteps.tenantId, TENANT_ID));
      await db.delete(workflowRuns).where(eq(workflowRuns.tenantId, TENANT_ID));
      await db.delete(commands).where(eq(commands.tenantId, TENANT_ID));
    });
    await closePool();
  });

  it("emulator binding: a held appointment is released on compensation, and the compensation_case resolves succeeded", async () => {
    resetSchedulingEmulator();
    const stepId = await newStep("hold_appointment");
    const input = HoldAppointmentInputSchema.parse({
      tenantId: TENANT_ID,
      subjectType: "compensation_test",
      subjectId: TENANT_ID,
      scheduledAt: new Date().toISOString(),
      idempotencyKey: `compensation-emulator-${stepId}`,
    });
    const result = await executeCapability(TENANT_ID, stepId, holdAppointmentContract, emulatorSchedulingBinding, input);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("setup failed");
    expect(getEmulatorHoldStatus(result.output.holdId)).toBe("held");
    await completeStep(TENANT_ID, stepId, { output: result.output });

    const { caseId, succeeded } = await compensateStep(TENANT_ID, stepId, "customer canceled", holdAppointmentContract, emulatorSchedulingBinding, input, result.output);
    expect(succeeded).toBe(true);
    expect(getEmulatorHoldStatus(result.output.holdId)).toBe("released");

    const [caseRow] = await withTenant(TENANT_ID, (db) => db.select().from(compensationCases).where(eq(compensationCases.id, caseId)));
    expect(caseRow!.status).toBe("succeeded");
    const [step] = await withTenant(TENANT_ID, (db) => db.select().from(workflowSteps).where(eq(workflowSteps.id, stepId)));
    expect(step!.status).toBe("compensated");
    const [receipt] = await withTenant(TENANT_ID, (db) => db.select().from(decisionReceipts).where(eq(decisionReceipts.workflowStepId, stepId)));
    expect(receipt!.actualResult).toMatchObject({ compensation: { status: "compensated", caseId, reason: "customer canceled" } });
    const compensationReceipts = await withTenant(TENANT_ID, (db) => db.select().from(decisionReceipts).where(eq(decisionReceipts.workflowRunId, receipt!.workflowRunId!)));
    expect(compensationReceipts).toContainEqual(expect.objectContaining({ workflowStepId: null, objective: expect.stringMatching(/^Compensate /), actualResult: expect.objectContaining({ status: "compensated", caseId }) }));
  });

  it("native binding: a held appointment row is canceled on compensation, and the compensation_case resolves succeeded", async () => {
    const stepId = await newStep("hold_appointment");
    const input = HoldAppointmentInputSchema.parse({
      tenantId: TENANT_ID,
      subjectType: "compensation_test_native",
      subjectId: TENANT_ID,
      scheduledAt: new Date().toISOString(),
      idempotencyKey: `compensation-native-${stepId}`,
    });
    const result = await executeCapability(TENANT_ID, stepId, holdAppointmentContract, nativeSchedulingBinding, input);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("setup failed");
    await completeStep(TENANT_ID, stepId, { output: result.output });

    const [beforeRow] = await withTenant(TENANT_ID, (db) => db.select().from(appointments).where(eq(appointments.id, result.output.holdId)));
    expect(beforeRow!.status).toBe("hold");

    const { succeeded } = await compensateStep(TENANT_ID, stepId, "customer canceled", holdAppointmentContract, nativeSchedulingBinding, input, result.output);
    expect(succeeded).toBe(true);

    const [afterRow] = await withTenant(TENANT_ID, (db) => db.select().from(appointments).where(eq(appointments.id, result.output.holdId)));
    expect(afterRow!.status).toBe("canceled");
  });

  it("governs compensation as a new exact Business Effect linked to the original", async () => {
    const stepId = await newStep("hold_appointment");
    const actionId = randomUUID();
    const originalEffectId = randomUUID();
    const semanticHash = "c".repeat(64);
    const scopeHash = "d".repeat(64);
    const originalEffect = {
      id: originalEffectId,
      schemaVersion: 1,
      semanticHash,
      scopeHash,
      source: { domainActionId: actionId, actionType: "schedule_water_test", workId: null, objectiveStepId: null },
      mode: "consequential",
      operation: { name: "schedule_water_test", class: "operational_change", external: false },
      targets: [{ kind: "resource", type: "proposed_business_change", id: actionId, sourcePath: "domainActionId" }],
      bindings: [], preconditions: [], before: [],
      delta: { operation: "schedule_water_test", values: { address: "Governed compensation test" } },
      expected: { observation: "recorded_result", state: null }, exposure: null,
      authority: { capability: "action:schedule_water_test", risk: "high", policyId: null, policyVersion: null },
      approval: { required: true, typedConfirmation: false, summary: "Schedule governed test" },
      reversibility: { classification: "compensatable", compensationCapability: "scheduling.hold.compensate" },
      uncertainty: { unknownOutcome: "reconcile_before_retry", stalePrecondition: "block_and_recompile" },
      provenance: { compiler: "finnor_effect_compiler", compilerVersion: 1, compiledAt: new Date().toISOString(), replacementForEffectId: null, compensationForEffectId: null },
    } as const;
    await withTenant(TENANT_ID, async (db) => {
      await db.insert(domainActions).values({ id: actionId, tenantId: TENANT_ID, actionType: "schedule_water_test", payload: {}, status: "completed" });
      await db.insert(businessEffects).values({ id: originalEffectId, tenantId: TENANT_ID, domainActionId: actionId, semanticHash, scopeHash, operationClass: "operational_change", effect: originalEffect, status: "verified" });
      await db.update(domainActions).set({ businessEffectId: originalEffectId }).where(eq(domainActions.id, actionId));
      await db.update(workflowSteps).set({ businessEffectId: originalEffectId }).where(eq(workflowSteps.id, stepId));
    });
    const input = HoldAppointmentInputSchema.parse({
      tenantId: TENANT_ID,
      subjectType: "compensation_effect_test",
      subjectId: TENANT_ID,
      scheduledAt: new Date().toISOString(),
      idempotencyKey: `compensation-effect-${stepId}`,
    });
    const result = await executeCapability(TENANT_ID, stepId, holdAppointmentContract, emulatorSchedulingBinding, input);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("setup failed");
    await completeStep(TENANT_ID, stepId, { output: result.output });
    const compensated = await compensateStep(TENANT_ID, stepId, "customer cancelled", holdAppointmentContract, emulatorSchedulingBinding, input, result.output, "system:compensation-test", "owner");
    expect(compensated.succeeded).toBe(true);
    const [caseRow] = await withTenant(TENANT_ID, (db) => db.select().from(compensationCases).where(eq(compensationCases.id, compensated.caseId)));
    expect(caseRow!.businessEffectId).toBe(originalEffectId);
    expect(caseRow!.compensationEffectId).not.toBeNull();
    const [recovery] = await withTenant(TENANT_ID, (db) => db.select().from(businessEffects).where(eq(businessEffects.id, caseRow!.compensationEffectId!)));
    expect(recovery).toMatchObject({ status: "verified", compensationForEffectId: originalEffectId });
    expect(recovery!.effect).toMatchObject({ approval: { required: true, typedConfirmation: false }, provenance: { compensationForEffectId: originalEffectId } });
    const [authority] = await withTenant(TENANT_ID, (db) => db.select().from(authorityDecisions).where(eq(authorityDecisions.businessEffectId, recovery!.id)));
    expect(authority).toMatchObject({ outcome: "allowed", businessEffectHash: recovery!.semanticHash });
    const [original] = await withTenant(TENANT_ID, (db) => db.select().from(businessEffects).where(eq(businessEffects.id, originalEffectId)));
    expect(original!.status).toBe("compensated");
  });

  it("communications binding has no compensate() — compensateStep records an explicit failed compensation_case, never a silent no-op", async () => {
    resetCommunicationsEmulator();
    const stepId = await newStep("send_confirmation_call");
    const input = SendConfirmationInputSchema.parse({
      tenantId: TENANT_ID,
      phoneNumber: "+15555550100",
      message: "test",
      idempotencyKey: `compensation-comms-${stepId}`,
    });
    const result = await executeCapability(TENANT_ID, stepId, sendConfirmationContract, emulatorCommunicationsBinding, input);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("setup failed");
    await completeStep(TENANT_ID, stepId, { output: result.output });

    const { succeeded, caseId } = await compensateStep(TENANT_ID, stepId, "test", sendConfirmationContract, emulatorCommunicationsBinding, input, result.output);
    expect(succeeded).toBe(false);
    const [caseRow] = await withTenant(TENANT_ID, (db) => db.select().from(compensationCases).where(eq(compensationCases.id, caseId)));
    expect(caseRow!.status).toBe("failed");
  });

  it("exposes compensation through the owner-authorized route and refuses a technician", async () => {
    const stepId = await newStep("hold_appointment");
    const input = HoldAppointmentInputSchema.parse({ tenantId: TENANT_ID, subjectType: "route_test", subjectId: TENANT_ID, scheduledAt: new Date().toISOString(), idempotencyKey: `compensation-route-${stepId}` });
    const result = await executeCapability(TENANT_ID, stepId, holdAppointmentContract, nativeSchedulingBinding, input);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("setup failed");
    await withTenant(TENANT_ID, (db) => db.update(workflowSteps).set({ status: "completed", payload: input }).where(eq(workflowSteps.id, stepId)));
    const request = (role: string) => new Request(`http://localhost/api/workflows/steps/${stepId}/compensate`, { method: "POST", headers: { "x-tenant-id": TENANT_ID, "x-user-role": role, "content-type": "application/json" }, body: JSON.stringify({ reason: "customer cancelled the appointment" }) });
    expect((await compensateRoute(request("technician"), { params: Promise.resolve({ id: stepId }) })).status).toBe(403);
    const response = await compensateRoute(request("owner"), { params: Promise.resolve({ id: stepId }) });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ succeeded: true });
    const [appointment] = await withTenant(TENANT_ID, (db) => db.select().from(appointments).where(eq(appointments.id, result.output.holdId)));
    expect(appointment!.status).toBe("canceled");
  });
});
