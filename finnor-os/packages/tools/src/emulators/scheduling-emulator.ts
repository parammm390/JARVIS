// Stateful local scheduling emulator — an in-memory double for a dispatch/scheduling
// provider, fault-injecting (not a happy-path stub). Real state (a Map of holds), real
// idempotent-dedup behavior (duplicate delivery of the same hold request is absorbed,
// not double-booked), configurable latency/failure/rate-limit/auth/timeout profile.

import { makeFaultInjector, tenantFaultInjector, type FaultInjectionConfig } from "./fault-injection";

export interface HoldAppointmentInput {
  tenantId: string;
  subjectType: string;
  subjectId: string;
  technicianId?: string;
  scheduledAt: string;
  idempotencyKey: string;
}

export interface HoldAppointmentOutput {
  holdId: string;
  status: "held";
  scheduledAt: string;
}

interface EmulatorHold {
  holdId: string;
  status: "held" | "released" | "confirmed";
  scheduledAt: string;
  technicianId?: string;
}

const holds = new Map<string, EmulatorHold>();
let injectFaults = makeFaultInjector();

/** Test-only: configure this emulator instance's fault profile. */
export function configureSchedulingEmulator(config: FaultInjectionConfig): void {
  injectFaults = makeFaultInjector(config);
}

/** Test-only: inspect emulator state directly (e.g. to confirm a compensation released a hold). */
export function getEmulatorHoldStatus(holdId: string): "held" | "released" | "confirmed" | "not_found" {
  return holds.get(holdId)?.status ?? "not_found";
}

export function resetSchedulingEmulator(): void {
  holds.clear();
  injectFaults = makeFaultInjector();
}

export async function emulatorHoldAppointment(input: HoldAppointmentInput): Promise<HoldAppointmentOutput> {
  await (tenantFaultInjector("scheduling", input.tenantId) ?? injectFaults)();
  // Idempotent by the caller's idempotency key — a duplicate delivery of the same hold
  // request (retry, at-least-once redelivery) returns the SAME hold, never a second one.
  const existing = holds.get(input.idempotencyKey);
  if (existing) return { holdId: existing.holdId, status: "held", scheduledAt: existing.scheduledAt };
  const hold: EmulatorHold = { holdId: input.idempotencyKey, status: "held", scheduledAt: input.scheduledAt, technicianId: input.technicianId };
  holds.set(hold.holdId, hold);
  return { holdId: hold.holdId, status: "held", scheduledAt: hold.scheduledAt };
}

export async function emulatorReleaseHold(input: HoldAppointmentInput, output: HoldAppointmentOutput): Promise<void> {
  await (tenantFaultInjector("scheduling", input.tenantId) ?? injectFaults)();
  const hold = holds.get(output.holdId);
  if (hold) hold.status = "released";
}

export async function emulatorReconcileHold(operationKey: string): Promise<"delivered" | "not_delivered" | "unknown"> {
  const hold = holds.get(operationKey);
  return hold ? "delivered" : "not_delivered";
}

// --- confirm_appointment (Phase 4, vertical workflow 1) -----------------------------

export interface ConfirmAppointmentInput {
  tenantId: string;
  holdId: string;
  idempotencyKey: string;
}
export interface ConfirmAppointmentOutput {
  holdId: string;
  status: "confirmed";
}

export async function emulatorConfirmAppointment(input: ConfirmAppointmentInput): Promise<ConfirmAppointmentOutput> {
  await (tenantFaultInjector("scheduling", input.tenantId) ?? injectFaults)();
  const hold = holds.get(input.holdId);
  if (hold) hold.status = "confirmed";
  return { holdId: input.holdId, status: "confirmed" };
}
