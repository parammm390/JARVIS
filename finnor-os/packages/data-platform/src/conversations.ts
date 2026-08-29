// Persists what the Vapi webhook used to throw away: a queryable, permanent record of
// calls/messages, replacing the "transcript embedded once in jobs.payload, then
// discarded" pattern in apps/api/app/api/webhooks/vapi/route.ts.

import { conversations, calls, households, messages, type Db } from "@finnor/db";
import { and, eq, sql } from "drizzle-orm";
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
  sentAt?: Date;
}

export async function persistMessage(db: Db, params: PersistMessageParams): Promise<{ messageId: string; alreadyExisted: boolean }> {
  if (params.provenance?.sourceSystem && params.provenance.externalId) {
    const [existing] = await db.select({ id: messages.id }).from(messages).where(and(
      eq(messages.tenantId, params.tenantId),
      eq(messages.sourceSystem, params.provenance.sourceSystem),
      eq(messages.externalId, params.provenance.externalId),
    )).limit(1);
    if (existing) return { messageId: existing.id, alreadyExisted: true };
  }
  const activityAt = params.sentAt ?? new Date();
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
      sentAt: activityAt,
    })
    .onConflictDoNothing()
    .returning();
  if (!msg && params.provenance?.sourceSystem && params.provenance.externalId) {
    const [winner] = await db.select({ id: messages.id }).from(messages).where(and(
      eq(messages.tenantId, params.tenantId),
      eq(messages.sourceSystem, params.provenance.sourceSystem),
      eq(messages.externalId, params.provenance.externalId),
    )).limit(1);
    if (winner) return { messageId: winner.id, alreadyExisted: true };
  }
  if (!msg) throw new Error("Canonical message insert lost its idempotency claim without a persisted winner");
  await recordBusinessEvent(db, {
    tenantId: params.tenantId,
    entityType: "message",
    entityId: msg.id,
    eventType: "message_recorded",
  });
  // A newly-created conversation starts with the schema's `now()` placeholder.
  // If this is its first interaction and the provider supplies an older event
  // timestamp (for example, a webhook replay), that placeholder must not make a
  // genuinely inactive customer look active. Once any message/call exists, the
  // update is strictly monotonic so delayed events can never move activity back.
  await db.update(conversations).set({ lastActivityAt: sql`CASE
    WHEN ${conversations.lastActivityAt} = ${conversations.createdAt}
      AND NOT EXISTS (
        SELECT 1 FROM finnor_os.messages AS prior_message
        WHERE prior_message.conversation_id = ${params.conversationId}
          AND prior_message.id <> ${msg.id}
      )
      AND NOT EXISTS (
        SELECT 1 FROM finnor_os.calls AS prior_call
        WHERE prior_call.conversation_id = ${params.conversationId}
      )
    THEN ${activityAt}
    ELSE greatest(${conversations.lastActivityAt}, ${activityAt})
  END` }).where(and(
    eq(conversations.tenantId, params.tenantId),
    eq(conversations.id, params.conversationId),
  ));
  return { messageId: msg.id, alreadyExisted: false };
}

export interface RecordCustomerMessageParams {
  tenantId: string;
  householdId: string;
  direction: "inbound" | "outbound";
  channel: string;
  content: string;
  sentAt?: Date;
  provenance?: { sourceSystem: string; externalId?: string };
}

/** The only writable customer-message boundary. `messages` owns the fact;
 * `communications_log` is a read-only compatibility projection. */
export async function recordCustomerMessage(
  db: Db,
  params: RecordCustomerMessageParams,
): Promise<{ conversationId: string; messageId: string; alreadyExisted: boolean }> {
  const [household] = await db.select({ id: households.id }).from(households).where(and(
    eq(households.tenantId, params.tenantId),
    eq(households.id, params.householdId),
  )).limit(1);
  if (!household) throw new Error("Customer message household does not belong to this tenant");
  const conversationChannel = params.channel === "call" || params.channel === "voice"
    ? "voice"
    : params.channel === "email"
      ? "email"
      : params.channel === "webchat"
        ? "webchat"
        : "sms";
  const { conversationId } = await getOrCreateConversation(db, {
    tenantId: params.tenantId,
    householdId: params.householdId,
    channel: conversationChannel,
  });
  const persisted = await persistMessage(db, {
    tenantId: params.tenantId,
    conversationId,
    direction: params.direction,
    channel: params.channel,
    content: params.content,
    ...(params.sentAt ? { sentAt: params.sentAt } : {}),
    ...(params.provenance ? { provenance: params.provenance } : {}),
  });
  return { conversationId, ...persisted };
}
