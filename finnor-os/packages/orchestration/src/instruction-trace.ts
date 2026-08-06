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
import { redactStructured, redactText } from "@finnor/security";
import type { AnswerEnvelope } from "./fast-read-lane";

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

/** The only answer result shape the browser trace is allowed to receive. The
 *  grounded query result remains in the executor/receipt path; it is never copied
 *  into this envelope. */
export interface InstructionTraceAnswerResult {
  kind: "answer";
  spokenSummary: string;
  display?: Record<string, unknown>;
  displaySummary?: string;
  facts?: Array<{ label: string; value: string; source?: string }>;
  evidence?: Array<{ source: string; ref: string; timestamp: string }>;
  asOf?: string;
  freshness?: { status: "fresh" | "stale" | "unknown"; observedAt: string };
}

export interface InstructionTraceResultEnvelope {
  actionId: string;
  result: InstructionTraceAnswerResult;
}

// These are read-only answer-capable action types. Membership is only a fallback
// for older plugins that did not stamp expected.answered; it is never sufficient
// when the executor says the action is waiting for approval.
const READ_ONLY_ANSWER_ACTION_TYPES = new Set([
  "answer_business_question",
  "get_business_overview",
  "check_stock_level",
  "flag_reorder_needed",
  "answer_water_question",
  "answer_customer_question",
  "check_reminder_due",
  "check_technician_availability",
  "summarize_ad_performance",
  "search_web",
  "check_business_reviews",
]);

export function isReadOnlyAnswerAction(actionType: string, expected: Record<string, unknown> | undefined, awaitingApproval: boolean): boolean {
  if (awaitingApproval) return false;
  return expected?.answered === true || READ_ONLY_ANSWER_ACTION_TYPES.has(actionType);
}

const MAX_TRACE_SPOKEN_SUMMARY_LENGTH = 1_200;
const MAX_TRACE_DISPLAY_DEPTH = 4;
const MAX_TRACE_DISPLAY_ENTRIES = 20;
const MAX_TRACE_DISPLAY_ITEMS = 12;
const MAX_TRACE_DISPLAY_STRING_LENGTH = 240;

// These keys are deliberately denied even when a plugin accidentally places them
// under its displaySafe projection. The trace is a browser-facing channel, not a
// second receipt or memory transport.
const PRIVATE_TRACE_KEY = /^(?:grounded(?:On|Payload)?|memory|semantic(?:Snippets?)?|citations?|raw|payload|data|error|secret|password|apiKey)$/i;

function sanitizeSpokenSummary(value: unknown): string {
  if (typeof value !== "string") return "";
  return redactText(value)
    .value.replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_TRACE_SPOKEN_SUMMARY_LENGTH);
}

function sanitizeDisplayValue(value: unknown, depth: number): unknown {
  if (value === null || typeof value === "boolean") return value;
  if (typeof value === "number") return Number.isFinite(value) ? value : undefined;
  if (typeof value === "string") {
    return redactText(value)
      .value.replace(/[\u0000-\u001f\u007f]/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, MAX_TRACE_DISPLAY_STRING_LENGTH);
  }
  if (depth >= MAX_TRACE_DISPLAY_DEPTH) return undefined;
  if (Array.isArray(value)) {
    return value
      .slice(0, MAX_TRACE_DISPLAY_ITEMS)
      .map((item) => sanitizeDisplayValue(item, depth + 1))
      .filter((item): item is NonNullable<typeof item> => item !== undefined);
  }
  if (typeof value !== "object") return undefined;

  const result: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value as Record<string, unknown>).slice(0, MAX_TRACE_DISPLAY_ENTRIES)) {
    if (PRIVATE_TRACE_KEY.test(key)) continue;
    const sanitized = sanitizeDisplayValue(entry, depth + 1);
    if (sanitized !== undefined) result[key.slice(0, 80)] = sanitized;
  }
  return result;
}

/** Sanitizes only an explicitly display-safe projection; arbitrary execution
 *  output is never used as a fallback source for structured trace data. */
export function sanitizeInstructionTraceDisplay(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const redacted = redactStructured(value);
  const sanitized = sanitizeDisplayValue(redacted, 0);
  if (!sanitized || typeof sanitized !== "object" || Array.isArray(sanitized)) return undefined;
  return Object.keys(sanitized).length > 0 ? (sanitized as Record<string, unknown>) : undefined;
}

function fallbackSpokenSummary(output: Record<string, unknown>): string {
  const items = output.items;
  if (Array.isArray(items)) return `I found ${items.length} inventory item${items.length === 1 ? "" : "s"}.`;
  const reorderNeeded = output.reorderNeeded;
  if (Array.isArray(reorderNeeded)) return `${reorderNeeded.length} inventory item${reorderNeeded.length === 1 ? " needs" : "s need"} reordering.`;
  if (typeof output.name === "string" && typeof output.quantity === "number") return `${output.name}: ${output.quantity} in stock.`;
  return "The requested information is ready.";
}

/** Builds the privacy-conscious payload for a successful read-only answer. */
export function createInstructionTraceResultEnvelope(actionId: string, output: Record<string, unknown>): InstructionTraceResultEnvelope {
  const display = sanitizeInstructionTraceDisplay(output.displaySafe);
  const spokenSummary =
    sanitizeSpokenSummary(output.spokenSummary) ||
    sanitizeSpokenSummary(output.answer) ||
    sanitizeSpokenSummary(output.recommendation) ||
    sanitizeSpokenSummary(fallbackSpokenSummary(output));
  return {
    actionId,
    result: {
      kind: "answer",
      spokenSummary,
      ...(display ? { display } : {}),
    },
  };
}

/** Trace adapter for the deterministic fast lane. Keep the richer AnswerEnvelope
 * fields bounded and display-safe so instruction_events never becomes a raw data
 * transport. The legacy output adapter above remains unchanged for existing plugins. */
export function createInstructionTraceAnswerEnvelope(actionId: string, answer: AnswerEnvelope): InstructionTraceResultEnvelope {
  const display = sanitizeInstructionTraceDisplay(answer.display);
  const facts = answer.display.facts
    .slice(0, MAX_TRACE_DISPLAY_ITEMS)
    .map((fact) => ({
      label: sanitizeSpokenSummary(fact.label).slice(0, 120),
      value: sanitizeSpokenSummary(fact.value).slice(0, MAX_TRACE_DISPLAY_STRING_LENGTH),
    }))
    .filter((fact) => Boolean(fact.label && fact.value));
  const evidence = answer.evidence
    .slice(0, MAX_TRACE_DISPLAY_ITEMS)
    .map((citation) => ({
      source: sanitizeSpokenSummary(citation.source).slice(0, 120),
      ref: sanitizeSpokenSummary(citation.ref).slice(0, 240),
      timestamp: sanitizeSpokenSummary(citation.timestamp).slice(0, 80),
    }))
    .filter((citation) => Boolean(citation.source && citation.ref && citation.timestamp));
  return {
    actionId,
    result: {
      kind: "answer",
      spokenSummary: sanitizeSpokenSummary(answer.spokenSummary),
      ...(display ? { display } : {}),
      displaySummary: sanitizeSpokenSummary(answer.display.title),
      ...(facts.length > 0 ? { facts } : {}),
      ...(evidence.length > 0 ? { evidence } : {}),
      ...(typeof answer.asOf === "string" ? { asOf: sanitizeSpokenSummary(answer.asOf).slice(0, 80) } : {}),
      freshness: {
        status: answer.freshness.status,
        observedAt: sanitizeSpokenSummary(answer.freshness.observedAt).slice(0, 80),
      },
    },
  };
}

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
  // Trace payloads are JSON objects, but not every safe envelope is an index-
  // signature-shaped `Record<string, unknown>` (the fast-read result is a
  // deliberately closed interface). Keep this boundary structural so the
  // compiler checks the caller's object shape without forcing an unsafe cast.
  payload: object = {},
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
