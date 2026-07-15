// Stateful local CRM emulator — an in-memory double for GoHighLevel (or any external
// CRM), fault-injecting like the scheduling/communications emulators (Phase 2).

import { makeFaultInjector, type FaultInjectionConfig } from "./fault-injection";

export interface UpsertContactInput {
  tenantId: string;
  phone: string;
  firstName?: string;
  address?: string;
  idempotencyKey: string;
}
export interface UpsertContactOutput {
  contactId: string;
  createdNew: boolean;
}

export interface SendMessageInput {
  tenantId: string;
  contactId: string;
  message: string;
  channel?: "sms" | "email";
  idempotencyKey: string;
}
export interface SendMessageOutput {
  sent: true;
  channel: string;
}

export interface BookProviderAppointmentInput {
  tenantId: string;
  contactId: string;
  startTime: string;
  idempotencyKey: string;
}
export interface BookProviderAppointmentOutput {
  booked: true;
  visitId: string;
  scheduledAt: string;
}

const contactsByPhone = new Map<string, string>(); // phone -> contactId
const sentMessages = new Set<string>(); // idempotencyKey
const bookedVisits = new Map<string, { visitId: string; scheduledAt: string }>(); // idempotencyKey -> visit

let injectFaults = makeFaultInjector();

export function configureCrmEmulator(config: FaultInjectionConfig): void {
  injectFaults = makeFaultInjector(config);
}

export function resetCrmEmulator(): void {
  contactsByPhone.clear();
  sentMessages.clear();
  bookedVisits.clear();
  injectFaults = makeFaultInjector();
}

export function wasEmulatorMessageSent(idempotencyKey: string): boolean {
  return sentMessages.has(idempotencyKey);
}

export async function emulatorUpsertContact(input: UpsertContactInput): Promise<UpsertContactOutput> {
  await injectFaults();
  const existing = contactsByPhone.get(input.phone);
  if (existing) return { contactId: existing, createdNew: false };
  const contactId = input.idempotencyKey;
  contactsByPhone.set(input.phone, contactId);
  return { contactId, createdNew: true };
}

export async function emulatorSendMessage(input: SendMessageInput): Promise<SendMessageOutput> {
  await injectFaults();
  sentMessages.add(input.idempotencyKey);
  return { sent: true, channel: input.channel ?? "sms" };
}

export async function emulatorBookProviderAppointment(input: BookProviderAppointmentInput): Promise<BookProviderAppointmentOutput> {
  await injectFaults();
  const existing = bookedVisits.get(input.idempotencyKey);
  if (existing) return { booked: true, ...existing };
  const visit = { visitId: input.idempotencyKey, scheduledAt: input.startTime };
  bookedVisits.set(input.idempotencyKey, visit);
  return { booked: true, ...visit };
}
