// jarvis-v3 P3.T2 (plan v3 §7.1/§8 PHASE 3): the instruction lifecycle trace.
// `instruction_sessions`/`instruction_events` (migration 0062, unapplied this session —
// see JARVIS-FRONTEND-MAESTRO-STATE-v3.md BLOCKER for why) back the frontend's 400ms
// trace poll. Both functions here are best-effort, fire-and-forget from the caller's
// perspective — the SAME convention `index.ts`'s own appendShortTerm/mirrorTurnToZep
// calls already use (`.catch(() => undefined)`): a trace-recording failure must never
// break the real instruction it is only describing.

import { withTenant, instructionSessions, instructionEvents } from "@finnor/db";
import { eq, sql } from "drizzle-orm";
import { getLogger } from "@finnor/tools";

// 15 values, verbatim from this session's own binding list — see migration 0062's own
// comment on the "14 vs 15" discrepancy between that list's stated count and its
// actual enumerated tokens. Do not invent, rename, or drop any (binding rule).
export const INSTRUCTION_EVENT_PHASES = [
  "received",
  "context_retrieved",
  "planning",
  "plan_ready",
  "clarification_required",
  "action_created",
  "action_gated",
  "dispatched",
  "executing",
  "step_progress",
  "verifying",
  "verified",
  "completed",
  "failed",
  "cancelled",
] as const;
export type InstructionEventPhase = (typeof INSTRUCTION_EVENT_PHASES)[number];

export interface EnsureInstructionSessionOpts {
  sessionId?: string;
  userId?: string;
  source?: "typed" | "voice";
}

/** Idempotent — a second call for the same (tenantId, instructionId) is a no-op (the
 *  row IS the claim, same `onConflictDoNothing` shape as intake-idempotency's own
 *  claim insert). Must be called (and resolve) before the first `emitInstructionEvent`
 *  for this instructionId — `instruction_events.instruction_id` foreign-keys here. */
export async function ensureInstructionSession(
  tenantId: string,
  instructionId: string,
  instructionText: string,
  opts: EnsureInstructionSessionOpts = {},
): Promise<void> {
  try {
    await withTenant(tenantId, (db) =>
      db
        .insert(instructionSessions)
        .values({
          id: instructionId,
          tenantId,
          sessionId: opts.sessionId ?? null,
          userId: opts.userId ?? null,
          instructionText,
          source: opts.source ?? "typed",
        })
        .onConflictDoNothing(),
    );
  } catch (err) {
    getLogger().warn(
      { err: err instanceof Error ? err.message : String(err), instructionId },
      "[instruction-trace] ensureInstructionSession failed (non-fatal — no trace this turn, real instruction unaffected)",
    );
  }
}

/** Monotonic `seq` per instructionId, read-then-insert inside `withTenant`'s own
 *  transaction. The real write pattern this system has (one instructionId, one
 *  synchronous `handleInstruction` call as its only writer) makes this safe in
 *  practice; the UNIQUE(instruction_id, seq) constraint (migration 0062) turns any
 *  genuine race into a caught, logged insert failure rather than silent corruption —
 *  never a crash, never a duplicate seq. No-ops (does not throw, does not write)
 *  when `instructionId` is absent — the phone (`webhooks/vapi/route.ts`) and async
 *  worker (`process-instruction.ts`) paths never send one and are untouched by this
 *  phase. */
export async function emitInstructionEvent(
  tenantId: string,
  instructionId: string | undefined,
  phase: InstructionEventPhase,
  payload: Record<string, unknown> = {},
): Promise<void> {
  if (!instructionId) return;
  try {
    await withTenant(tenantId, async (db) => {
      const [row] = await db
        .select({ maxSeq: sql<number>`coalesce(max(${instructionEvents.seq}), 0)::int` })
        .from(instructionEvents)
        .where(eq(instructionEvents.instructionId, instructionId));
      const nextSeq = (row?.maxSeq ?? 0) + 1;
      await db.insert(instructionEvents).values({
        tenantId,
        instructionId,
        seq: nextSeq,
        phase,
        payload,
      });
    });
  } catch (err) {
    getLogger().warn(
      { err: err instanceof Error ? err.message : String(err), instructionId, phase },
      "[instruction-trace] emitInstructionEvent failed (non-fatal — trace gap, real instruction unaffected)",
    );
  }
}
