// Stateful local communications emulator — models a voice/SMS provider with the same
// fault-injection profile as the scheduling emulator, plus provider-side idempotency-key
// dedup (so a retried "send" after an unknown-delivery crash is provably safe rather
// than risking a double-send).

import { makeFaultInjector, tenantFaultInjector, type FaultInjectionConfig } from "./fault-injection";

export interface SendConfirmationInput {
  tenantId: string;
  phoneNumber: string;
  message: string;
  idempotencyKey: string;
}

export interface SendConfirmationOutput {
  callId: string;
  status: "placed";
}

interface EmulatorCall {
  callId: string;
  phoneNumber: string;
  message: string;
}

const sentCalls = new Map<string, EmulatorCall>();
let injectFaults = makeFaultInjector();

export function configureCommunicationsEmulator(config: FaultInjectionConfig): void {
  injectFaults = makeFaultInjector(config);
}

export function getEmulatorCallCount(): number {
  return sentCalls.size;
}

export function wasEmulatorCallSent(idempotencyKey: string): boolean {
  return sentCalls.has(idempotencyKey);
}

export function resetCommunicationsEmulator(): void {
  sentCalls.clear();
  injectFaults = makeFaultInjector();
}

export async function emulatorSendConfirmation(input: SendConfirmationInput): Promise<SendConfirmationOutput> {
  await (tenantFaultInjector("communications", input.tenantId) ?? injectFaults)();
  // Provider-side idempotency: the same idempotency key never results in a second call.
  const existing = sentCalls.get(input.idempotencyKey);
  if (existing) return { callId: existing.callId, status: "placed" };
  const call: EmulatorCall = { callId: input.idempotencyKey, phoneNumber: input.phoneNumber, message: input.message };
  sentCalls.set(input.idempotencyKey, call);
  return { callId: call.callId, status: "placed" };
}

export async function emulatorReconcileCall(operationKey: string): Promise<"delivered" | "not_delivered" | "unknown"> {
  return sentCalls.has(operationKey) ? "delivered" : "not_delivered";
}
