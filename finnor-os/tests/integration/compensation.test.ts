// Compensation acceptance (Phase 2 proof item 4): hold an appointment mid-workflow,
// force a compensation, confirm the hold releases and the compensation_case resolves.
// Communications has no meaningful compensate() (you can't unsend a call) — that's
// covered by compensateStep()'s explicit "no compensate() procedure" failure path,
// tested here too, rather than skipped silently.

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import pg from "pg";
import { migrate } from "../../packages/db/migrate";
import { withTenant, closePool, tenants, workflowSteps, workflowRuns, commands, integrationOperations, compensationCases, appointments } from "@finnor/db";
import { eq } from "drizzle-orm";
import { submitCommand, executeCapability, compensateStep } from "@finnor/workflow-runtime";
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
  return submitted.stepIds[0]!;
}

describe.skipIf(!available)("compensation", () => {
  beforeAll(async () => {
    process.env.DATABASE_URL = DB_URL;
    await migrate(DB_URL);
    await withTenant(TENANT_ID, (db) => db.insert(tenants).values({ id: TENANT_ID, name: "Compensation Test Dealer" }).onConflictDoNothing());
  });
  afterAll(async () => {
    await withTenant(TENANT_ID, async (db) => {
      await db.delete(compensationCases).where(eq(compensationCases.tenantId, TENANT_ID));
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

    const { caseId, succeeded } = await compensateStep(TENANT_ID, stepId, "customer canceled", holdAppointmentContract, emulatorSchedulingBinding, input, result.output);
    expect(succeeded).toBe(true);
    expect(getEmulatorHoldStatus(result.output.holdId)).toBe("released");

    const [caseRow] = await withTenant(TENANT_ID, (db) => db.select().from(compensationCases).where(eq(compensationCases.id, caseId)));
    expect(caseRow!.status).toBe("succeeded");
    const [step] = await withTenant(TENANT_ID, (db) => db.select().from(workflowSteps).where(eq(workflowSteps.id, stepId)));
    expect(step!.status).toBe("compensated");
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

    const [beforeRow] = await withTenant(TENANT_ID, (db) => db.select().from(appointments).where(eq(appointments.id, result.output.holdId)));
    expect(beforeRow!.status).toBe("hold");

    const { succeeded } = await compensateStep(TENANT_ID, stepId, "customer canceled", holdAppointmentContract, nativeSchedulingBinding, input, result.output);
    expect(succeeded).toBe(true);

    const [afterRow] = await withTenant(TENANT_ID, (db) => db.select().from(appointments).where(eq(appointments.id, result.output.holdId)));
    expect(afterRow!.status).toBe("canceled");
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

    const { succeeded, caseId } = await compensateStep(TENANT_ID, stepId, "test", sendConfirmationContract, emulatorCommunicationsBinding, input, result.output);
    expect(succeeded).toBe(false);
    const [caseRow] = await withTenant(TENANT_ID, (db) => db.select().from(compensationCases).where(eq(compensationCases.id, caseId)));
    expect(caseRow!.status).toBe("failed");
  });
});
