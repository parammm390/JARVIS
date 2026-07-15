// Voice OS (Phase 5, docs/jarvis-90-execution-blueprint.md §5): real caller
// identity + session/turn history + confirmations bound to a specific action.
// Consumed by apps/api/app/api/webhooks/vapi/route.ts, replacing its hardcoded
// owner userId/role and its "confirm the newest pending domain_actions" heuristic.

import { withTenant, voiceIdentities, voiceSessions, voiceTurns, pendingConfirmations, handoffs, tenants, users } from "@finnor/db";
import { and, desc, eq } from "drizzle-orm";
import { findHousehold } from "../../domain-plugins/shared/db-helpers";

export type VoiceRole = "owner" | "dispatcher" | "technician" | "customer" | "unknown";

export interface VoiceIdentity {
  id: string;
  tenantId: string;
  phoneNumber: string;
  matchedHouseholdId: string | null;
  matchedUserId: string | null;
  role: VoiceRole;
}

/**
 * Looks up an existing voice_identities row by phone; if absent, attempts a match
 * against households.contactInfo the same way findHousehold() already does for
 * text/voice instructions, else creates an `unknown`-role row. Bumps last_seen_at
 * on every call — never silently defaults an unresolved caller to owner trust.
 */
export async function resolveVoiceIdentity(tenantId: string, phoneNumber: string): Promise<VoiceIdentity> {
  return withTenant(tenantId, async (db) => {
    const [existing] = await db
      .select()
      .from(voiceIdentities)
      .where(and(eq(voiceIdentities.tenantId, tenantId), eq(voiceIdentities.phoneNumber, phoneNumber)));
    if (existing) {
      await db.update(voiceIdentities).set({ lastSeenAt: new Date() }).where(eq(voiceIdentities.id, existing.id));
      return {
        id: existing.id,
        tenantId,
        phoneNumber,
        matchedHouseholdId: existing.matchedHouseholdId,
        matchedUserId: existing.matchedUserId,
        role: existing.role as VoiceRole,
      };
    }

    // Only two identities are actually resolvable from real data today: the tenant's
    // registered owner line (tenants.ownerPhone) and a known customer (households'
    // phone). Staff (dispatcher/technician) callers aren't resolvable — `users` has
    // no phone column, and `technicians` rows aren't linked to a `users` login — so
    // matching them is out of scope this phase rather than guessed at.
    const [tenant] = await db.select({ ownerPhone: tenants.ownerPhone }).from(tenants).where(eq(tenants.id, tenantId));
    const isOwnerLine = Boolean(tenant?.ownerPhone) && tenant!.ownerPhone === phoneNumber;
    let matchedUserId: string | null = null;
    if (isOwnerLine) {
      const [ownerUser] = await db.select({ id: users.id }).from(users).where(and(eq(users.tenantId, tenantId), eq(users.role, "owner"))).limit(1);
      matchedUserId = ownerUser?.id ?? null;
    }
    const household = isOwnerLine ? null : await findHousehold(tenantId, { phone: phoneNumber });
    const role: VoiceRole = isOwnerLine ? "owner" : household ? "customer" : "unknown";
    const [created] = await db
      .insert(voiceIdentities)
      .values({ tenantId, phoneNumber, matchedHouseholdId: household?.id ?? null, matchedUserId, role })
      .onConflictDoNothing({ target: [voiceIdentities.tenantId, voiceIdentities.phoneNumber] })
      .returning();
    if (created) {
      return {
        id: created.id,
        tenantId,
        phoneNumber,
        matchedHouseholdId: created.matchedHouseholdId,
        matchedUserId: created.matchedUserId,
        role: created.role as VoiceRole,
      };
    }
    // Lost an insert race to a concurrent call from the same number — re-select.
    const [raced] = await db
      .select()
      .from(voiceIdentities)
      .where(and(eq(voiceIdentities.tenantId, tenantId), eq(voiceIdentities.phoneNumber, phoneNumber)));
    return {
      id: raced!.id,
      tenantId,
      phoneNumber,
      matchedHouseholdId: raced!.matchedHouseholdId,
      matchedUserId: raced!.matchedUserId,
      role: raced!.role as VoiceRole,
    };
  });
}

export interface VoiceSession {
  id: string;
  tenantId: string;
  voiceIdentityId: string | null;
}

/** Idempotent by callExternalId — a live call's repeated tool-calls messages all
 *  reuse the same session row rather than opening a new one per message. */
export async function openVoiceSession(
  tenantId: string,
  callExternalId: string,
  voiceIdentityId?: string,
): Promise<VoiceSession> {
  return withTenant(tenantId, async (db) => {
    const [existing] = await db.select().from(voiceSessions).where(eq(voiceSessions.callExternalId, callExternalId));
    if (existing) {
      if (voiceIdentityId && !existing.voiceIdentityId) {
        await db.update(voiceSessions).set({ voiceIdentityId }).where(eq(voiceSessions.id, existing.id));
      }
      return { id: existing.id, tenantId, voiceIdentityId: voiceIdentityId ?? existing.voiceIdentityId };
    }
    const [created] = await db
      .insert(voiceSessions)
      .values({ tenantId, callExternalId, voiceIdentityId: voiceIdentityId ?? null })
      .onConflictDoNothing({ target: voiceSessions.callExternalId })
      .returning();
    if (created) return { id: created.id, tenantId, voiceIdentityId: created.voiceIdentityId };
    const [raced] = await db.select().from(voiceSessions).where(eq(voiceSessions.callExternalId, callExternalId));
    return { id: raced!.id, tenantId, voiceIdentityId: raced!.voiceIdentityId };
  });
}

export async function closeVoiceSession(tenantId: string, sessionId: string): Promise<void> {
  await withTenant(tenantId, (db) =>
    db.update(voiceSessions).set({ status: "ended", endedAt: new Date() }).where(eq(voiceSessions.id, sessionId)),
  );
}

export async function appendVoiceTurn(params: {
  tenantId: string;
  voiceSessionId: string;
  role: "caller" | "assistant";
  transcriptText: string;
  resolvedActionIds?: string[];
}): Promise<void> {
  await withTenant(params.tenantId, async (db) => {
    const [last] = await db
      .select({ sequence: voiceTurns.sequence })
      .from(voiceTurns)
      .where(eq(voiceTurns.voiceSessionId, params.voiceSessionId))
      .orderBy(desc(voiceTurns.sequence))
      .limit(1);
    await db.insert(voiceTurns).values({
      tenantId: params.tenantId,
      voiceSessionId: params.voiceSessionId,
      sequence: (last?.sequence ?? 0) + 1,
      role: params.role,
      transcriptText: params.transcriptText,
      resolvedActionIds: params.resolvedActionIds ?? [],
    });
  });
}

export async function createPendingConfirmation(params: {
  tenantId: string;
  voiceSessionId: string;
  domainActionId: string;
  promptText: string;
}): Promise<{ id: string }> {
  const [row] = await withTenant(params.tenantId, (db) =>
    db
      .insert(pendingConfirmations)
      .values({
        tenantId: params.tenantId,
        voiceSessionId: params.voiceSessionId,
        domainActionId: params.domainActionId,
        promptText: params.promptText,
      })
      .returning({ id: pendingConfirmations.id }),
  );
  return { id: row!.id };
}

/**
 * Resolves this session's own OPEN pending_confirmations — never the tenant's
 * newest-pending domain_actions. This is the fix for the cross-caller/cross-session
 * bug: a "yes" only ever applies to what THIS call's own instruction actually drafted.
 */
export async function resolveOpenConfirmations(
  tenantId: string,
  voiceSessionId: string,
): Promise<Array<{ id: string; domainActionId: string }>> {
  const rows = await withTenant(tenantId, (db) =>
    db
      .select({ id: pendingConfirmations.id, domainActionId: pendingConfirmations.domainActionId })
      .from(pendingConfirmations)
      .where(and(eq(pendingConfirmations.voiceSessionId, voiceSessionId), eq(pendingConfirmations.status, "awaiting"))),
  );
  return rows;
}

export async function markConfirmationsResolved(
  tenantId: string,
  confirmationIds: string[],
  decision: "confirmed" | "rejected",
): Promise<void> {
  if (confirmationIds.length === 0) return;
  await withTenant(tenantId, async (db) => {
    for (const id of confirmationIds) {
      await db
        .update(pendingConfirmations)
        .set({ status: decision, resolvedAt: new Date() })
        .where(eq(pendingConfirmations.id, id));
    }
  });
}

export async function createHandoff(params: {
  tenantId: string;
  voiceSessionId: string;
  reason: string;
  toRole?: string;
  toUserId?: string;
}): Promise<{ id: string }> {
  const [row] = await withTenant(params.tenantId, (db) =>
    db
      .insert(handoffs)
      .values({
        tenantId: params.tenantId,
        voiceSessionId: params.voiceSessionId,
        reason: params.reason,
        toRole: params.toRole ?? null,
        toUserId: params.toUserId ?? null,
      })
      .returning({ id: handoffs.id }),
  );
  return { id: row!.id };
}
