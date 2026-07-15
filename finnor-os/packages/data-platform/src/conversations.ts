// Persists what the Vapi webhook used to throw away: a queryable, permanent record of
// calls/messages, replacing the "transcript embedded once in jobs.payload, then
// discarded" pattern in apps/api/app/api/webhooks/vapi/route.ts.

import { conversations, calls, messages, type Db } from "@finnor/db";
import { and, eq } from "drizzle-orm";
import { recordBusinessEvent } from "./events";

export interface GetOrCreateConversationParams {
  tenantId: string;
  householdId?: string;
  contactId?: string;
  channel: "voice" | "sms" | "email" | "webchat";
}

export async function getOrCreateConversation(
  db: Db,
  params: GetOrCreateConversationParams,
): Promise<{ conversationId: string }> {
  if (params.householdId) {
    const [existing] = await db
      .select()
      .from(conversations)
      .where(
        and(
          eq(conversations.tenantId, params.tenantId),
          eq(conversations.householdId, params.householdId),
          eq(conversations.channel, params.channel),
          eq(conversations.status, "open"),
        ),
      );
    if (existing) return { conversationId: existing.id };
  }

  const [conv] = await db
    .insert(conversations)
    .values({
      tenantId: params.tenantId,
      householdId: params.householdId ?? null,
      contactId: params.contactId ?? null,
      channel: params.channel,
    })
    .returning();
  return { conversationId: conv!.id };
}

export interface PersistCallParams {
  tenantId: string;
  provenance: { sourceSystem: string; externalId: string };
  direction: "inbound" | "outbound";
  transcript?: string;
  fromNumber?: string;
  toNumber?: string;
  recordingUrl?: string;
  startedAt?: Date;
  endedAt?: Date;
  endedReason?: string;
  raw?: Record<string, unknown>;
  householdId?: string;
}

// Idempotent by (tenant_id, source_system, external_id) — a webhook retry or replayed
// end-of-call-report never creates a second row for the same provider call id.
export async function persistCall(
  db: Db,
  params: PersistCallParams,
): Promise<{ callId: string; conversationId: string; alreadyExisted: boolean }> {
  const [existing] = await db
    .select()
    .from(calls)
    .where(
      and(
        eq(calls.tenantId, params.tenantId),
        eq(calls.sourceSystem, params.provenance.sourceSystem),
        eq(calls.externalId, params.provenance.externalId),
      ),
    );
  if (existing) {
    return { callId: existing.id, conversationId: existing.conversationId!, alreadyExisted: true };
  }

  const { conversationId } = await getOrCreateConversation(db, {
    tenantId: params.tenantId,
    householdId: params.householdId,
    channel: "voice",
  });

  const [call] = await db
    .insert(calls)
    .values({
      tenantId: params.tenantId,
      conversationId,
      direction: params.direction,
      fromNumber: params.fromNumber ?? null,
      toNumber: params.toNumber ?? null,
      transcript: params.transcript ?? null,
      recordingUrl: params.recordingUrl ?? null,
      startedAt: params.startedAt ?? null,
      endedAt: params.endedAt ?? null,
      endedReason: params.endedReason ?? null,
      raw: params.raw ?? {},
      sourceSystem: params.provenance.sourceSystem,
      externalId: params.provenance.externalId,
    })
    .returning();

  await db.update(conversations).set({ lastActivityAt: new Date() }).where(eq(conversations.id, conversationId));

  await recordBusinessEvent(db, {
    tenantId: params.tenantId,
    entityType: "call",
    entityId: call!.id,
    eventType: "call_recorded",
    source: params.provenance.sourceSystem,
  });

  return { callId: call!.id, conversationId, alreadyExisted: false };
}

export interface PersistMessageParams {
  tenantId: string;
  conversationId: string;
  direction: "inbound" | "outbound";
  channel: string;
  content: string;
  provenance?: { sourceSystem: string; externalId?: string };
}

export async function persistMessage(db: Db, params: PersistMessageParams): Promise<{ messageId: string }> {
  const [msg] = await db
    .insert(messages)
    .values({
      tenantId: params.tenantId,
      conversationId: params.conversationId,
      direction: params.direction,
      channel: params.channel,
      content: params.content,
      sourceSystem: params.provenance?.sourceSystem ?? null,
      externalId: params.provenance?.externalId ?? null,
    })
    .returning();
  await recordBusinessEvent(db, {
    tenantId: params.tenantId,
    entityType: "message",
    entityId: msg!.id,
    eventType: "message_recorded",
  });
  return { messageId: msg!.id };
}
