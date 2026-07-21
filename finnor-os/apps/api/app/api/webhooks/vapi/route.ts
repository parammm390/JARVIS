// POST /api/webhooks/vapi — the voice-native entry point (§8, §20 + voice extension).
//
// Three shapes arrive here:
//  1. tool-calls (live call): the Vapi assistant exposes two tools —
//     finnor_instruct(instruction)   → plan + gate; the returned draft summary is read
//                                       aloud IN THE SAME CALL for a spoken yes/no.
//     finnor_confirm(decision)       → the spoken yes/no, applied through the same
//                                       audit-first decide() path the console uses.
//  2. end-of-call-report for an outbound confirmation call (metadata.pendingActionId):
//     the transcript is parsed for the spoken decision. Unclear NEVER approves.
//  3. end-of-call-report for a normal customer call: transcript enqueued for the
//     Planner, exactly as before.

import { createHash, randomUUID } from "node:crypto";
import { VapiWebhookSchema } from "@finnor/policy-schema";
import { adminDb, jobs, withTenant, domainActions, domainPolicies, actionLog, tenantPhoneNumbers } from "@finnor/db";
import { persistCall } from "@finnor/data-platform";
import { ensureSecretsLoaded } from "@finnor/security";
import { parseSpokenDecision, diagnoseFailure, resolveProvider } from "@finnor/orchestration";
import { logWithTrace } from "@finnor/tools";
import type { Role } from "@finnor/shared-types";
import {
  resolveVoiceIdentity,
  openVoiceSession,
  appendVoiceTurn,
  createPendingConfirmation,
  resolveOpenConfirmations,
  markConfirmationsResolved,
  createHandoff,
} from "@finnor/voice-os";
import { and, desc, eq, inArray } from "drizzle-orm";
import { getOrchestrator } from "../../../../lib/orchestrator";
import { checkAndRecordReceipt } from "../../../../lib/webhook-replay";
import { verifyTimestampedHmacSignature } from "../../../../lib/verify-hmac-signature";

/**
 * HMAC-with-timestamp: header `x-vapi-signature: t=<unix>,v1=<hex hmac>` computed over
 * `${t}.${rawBody}`. Fails open ONLY when the secret is unset AND NODE_ENV isn't
 * production (dev convenience); fails CLOSED otherwise, and always rejects a
 * signature outside a 5-minute window even with a valid secret.
 */
function verifySignature(req: Request, rawBody: string): boolean {
  return verifyTimestampedHmacSignature(req, {
    header: "x-vapi-signature",
    secret: process.env.VAPI_WEBHOOK_SECRET,
    rawBody,
    allowUnsetSecret: process.env.NODE_ENV !== "production",
  });
}

function defaultTenant(): string {
  return process.env.VAPI_DEFAULT_TENANT_ID ?? "PLACEHOLDER_NEEDS_REAL_VALUE";
}

/**
 * Resolves which tenant a call belongs to from the DIALED number — replaces the
 * previous hardcoded defaultTenant() everywhere, which routed every call on every
 * deployed line to the same single tenant regardless of who was actually dialed.
 * Match order: (1) Vapi's own phoneNumberId (preferred — stable across number
 * changes), (2) the dialed number in E.164, (3) env default with a loud warning so
 * misrouting is visible instead of silent. `tenant_phone_numbers` has no RLS (like
 * `jobs`) because tenant_id is exactly what's unknown at this point.
 */
async function resolveTenantFromCall(call: { phoneNumberId?: string; phoneNumber?: { number?: string } } | undefined): Promise<string> {
  if (call?.phoneNumberId) {
    const [byVapiId] = await adminDb()
      .select({ tenantId: tenantPhoneNumbers.tenantId })
      .from(tenantPhoneNumbers)
      .where(eq(tenantPhoneNumbers.vapiPhoneNumberId, call.phoneNumberId));
    if (byVapiId) return byVapiId.tenantId;
  }
  const dialedNumber = call?.phoneNumber?.number;
  if (dialedNumber) {
    const [byNumber] = await adminDb()
      .select({ tenantId: tenantPhoneNumbers.tenantId })
      .from(tenantPhoneNumbers)
      .where(eq(tenantPhoneNumbers.phoneNumber, dialedNumber));
    if (byNumber) return byNumber.tenantId;
  }
  logWithTrace({}).warn(
    { phoneNumberId: call?.phoneNumberId, dialedNumber },
    "[vapi] no tenant_phone_numbers match — falling back to VAPI_DEFAULT_TENANT_ID",
  );
  return defaultTenant();
}

/**
 * Per-tenant extra approve/reject phrases for parseSpokenDecision, sourced from
 * `domain_policies` under the conventional action type `voice_confirmation`
 * (`policy.approvePhrases` / `policy.rejectPhrases`, arrays of strings). No
 * domain_policies row → today's built-in-patterns-only behavior, unchanged. This is
 * retrieval feeding a config the dealer edits by hand — nothing here ever writes a
 * phrase automatically (see computeLearningDigest's unclearConfirmations for the
 * read-only signal that informs what to add).
 */
async function loadVoiceConfirmationPhrases(tenantId: string): Promise<{ approve?: string[]; reject?: string[] }> {
  const [row] = await withTenant(tenantId, (db) =>
    db.select({ policy: domainPolicies.policy }).from(domainPolicies).where(eq(domainPolicies.actionType, "voice_confirmation")),
  );
  const policy = (row?.policy ?? {}) as { approvePhrases?: unknown; rejectPhrases?: unknown };
  const asStrings = (v: unknown): string[] | undefined => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : undefined);
  return { approve: asStrings(policy.approvePhrases), reject: asStrings(policy.rejectPhrases) };
}

interface VapiToolCall {
  id: string;
  function?: { name?: string; arguments?: Record<string, unknown> | string };
}

/**
 * Turns ANY plugin's execute() output into something speakable — not just the few
 * plugins that happen to set spokenSummary/recommendation/answer. Most plugins return
 * structured data (arrays of rows, a handful of scalar fields) with nothing shaped for
 * voice; without this, those results were silently swallowed into a generic "done"
 * message that implied success even when there was nothing real to report.
 */
/** Cheap model, tight timeout, hard fallback to the raw heuristic string on any
 *  failure — narration quality is worth improving, but never at the cost of the
 *  voice channel hanging or going silent because a second model call misbehaved. */
async function naturalizeScalars(actionSummary: string | null, scalarEntries: [string, unknown][]): Promise<string> {
  const raw = `${actionSummary ? actionSummary + " — " : ""}${scalarEntries.map(([k, v]) => `${k}: ${v}`).join(", ")}.`;
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 2_500);
    const text = await Promise.race([
      resolveProvider("bedrock-deepseek").complete({
        system:
          "Rewrite this raw key:value execution result as one short, natural spoken sentence a person would say out loud. State every fact given — never drop or invent a value. No preamble, just the sentence.",
        user: raw,
      }),
      new Promise<string>((_, reject) => setTimeout(() => reject(new Error("narration timeout")), 2_500)),
    ]);
    clearTimeout(timeout);
    return text.trim() || raw;
  } catch {
    return raw;
  }
}

async function describeExecutionOutput(actionSummary: string | null, out: Record<string, unknown>): Promise<string> {
  const known =
    (out.spokenSummary as string | undefined) ??
    (out.recommendation as string | undefined) ??
    (out.answer as string | undefined) ??
    (out.quantity !== undefined ? `${out.name ?? "item"}: ${out.quantity} in stock.` : undefined);
  if (known) return known;

  const note = typeof out.note === "string" ? out.note + " " : "";

  const arrayEntry = Object.entries(out).find(([, v]) => Array.isArray(v));
  if (arrayEntry) {
    const [, arr] = arrayEntry as [string, unknown[]];
    if (arr.length === 0) return `${note}${actionSummary ?? "That"} — nothing found.`;
    const sample = arr.slice(0, 5).map((item) => {
      if (item && typeof item === "object") {
        const rec = item as Record<string, unknown>;
        const label = rec.name ?? rec.sku ?? rec.title ?? rec.label ?? rec.campaign;
        const qty = rec.quantity ?? rec.threshold;
        if (label) return qty !== undefined ? `${label} (${qty})` : String(label);
        return JSON.stringify(item).slice(0, 60);
      }
      return String(item);
    });
    return `${note}${actionSummary ? actionSummary + " — " : ""}${arr.length} result${arr.length === 1 ? "" : "s"}: ${sample.join(", ")}${arr.length > 5 ? ", and more" : ""}.`;
  }

  const scalarEntries = Object.entries(out).filter(([, v]) => typeof v === "string" || typeof v === "number" || typeof v === "boolean");
  if (scalarEntries.length > 0) {
    return naturalizeScalars(actionSummary, scalarEntries);
  }
  return actionSummary ? `${actionSummary} — done.` : "Done, but nothing specific to report.";
}

async function handleToolCalls(message: Record<string, unknown>): Promise<Response> {
  const callMeta = message.call as
    | { id?: string; phoneNumberId?: string; customer?: { number?: string }; phoneNumber?: { number?: string } }
    | undefined;
  const tenantId = await resolveTenantFromCall(callMeta);
  const callId = callMeta?.id ?? "unknown";
  const list = (message.toolCallList ?? message.toolCalls ?? []) as VapiToolCall[];
  const results: Array<{ toolCallId: string; result: string }> = [];

  // Real caller resolution (§5 voice OS) — replaces the previous hardcoded owner
  // userId/role that every caller on this line got, regardless of who was actually
  // calling. Only a phone number matching the tenant's registered owner line resolves
  // to owner trust; anything else (a customer, an unrecognized number, no caller-id
  // at all) never gets silently upgraded the way it used to.
  const identity = callMeta?.customer?.number ? await resolveVoiceIdentity(tenantId, callMeta.customer.number) : null;
  const session = await openVoiceSession(tenantId, callId, identity?.id);
  const staffCtx: { userId: string; role: Role } | null =
    identity?.role === "owner" ? { userId: identity.matchedUserId ?? identity.id, role: "owner" } : null;
  // A2.T1: mint the trace id at the live-call intake, keyed by callId so every action
  // this call produces (one finnor_instruct tool-call per utterance) correlates under
  // the same id — same "vapi:<callId>" namespace the outbound-confirmation path below
  // already uses for its own correlation-free purposes (session/idempotency keys).
  const correlationId = `vapi:${callId}`;

  for (const tc of list) {
    const name = tc.function?.name ?? "";
    const rawArgs = tc.function?.arguments ?? {};
    const args = (typeof rawArgs === "string" ? JSON.parse(rawArgs || "{}") : rawArgs) as Record<string, unknown>;

    try {
      if (name === "finnor_instruct") {
        const instruction = String(args.instruction ?? args.query ?? "");
        if (!instruction) {
          results.push({ toolCallId: tc.id, result: "I didn't catch an instruction — please repeat it." });
          continue;
        }
        if (!staffCtx) {
          await createHandoff({
            tenantId,
            voiceSessionId: session.id,
            reason: "unresolved caller identity on the owner assistant line",
          });
          results.push({
            toolCallId: tc.id,
            result: "I can't verify this line yet, so I can't make any changes — I've flagged this call for a team member to follow up.",
          });
          continue;
        }
        const actions = await getOrchestrator().handleInstruction(
          instruction,
          { tenantId, userId: staffCtx.userId, role: staffCtx.role, correlationId },
          { sessionId: `vapi:${callId}` },
        );
        await appendVoiceTurn({
          tenantId,
          voiceSessionId: session.id,
          role: "caller",
          transcriptText: instruction,
          resolvedActionIds: actions.map((a) => a.id),
        });
        if (actions.length === 0) {
          results.push({
            toolCallId: tc.id,
            result:
              "I don't have that exact thing, but I can pull the full business overview — leads, pending items, inventory, invoices, upcoming visits — want that instead?",
          });
          continue;
        }
        // Read the drafted, gated actions back for spoken approval in this same call.
        const summaries = await withTenant(tenantId, (db) =>
          db
            .select({
              id: domainActions.id,
              summary: domainActions.summary,
              status: domainActions.status,
              actionType: domainActions.actionType,
            })
            .from(domainActions)
            .where(inArray(domainActions.id, actions.map((a) => a.id))),
        );
        const gated = summaries.filter((s) => s.status === "pending");
        const completed = summaries.filter((s) => s.status === "completed");
        // Bind each gated action to THIS session — finnor_confirm resolves against
        // these specific rows, not "whatever's newest pending for the tenant."
        await Promise.all(
          gated.map((g) =>
            createPendingConfirmation({
              tenantId,
              voiceSessionId: session.id,
              domainActionId: g.id,
              promptText: g.summary ?? "an action",
            }),
          ),
        );
        // Never silently drop a failure — a stuck/blocked/reviewed action must be
        // reported honestly, never folded into a generic "done" that implies success.
        const troubled = summaries.filter((s) =>
          ["failed", "needs_human_review", "blocked_integration_unavailable"].includes(s.status),
        );

        const answers: string[] = [];
        if (completed.length > 0) {
          const episodes = await withTenant(tenantId, (db) =>
            db
              .select({ actionId: actionLog.domainActionId, output: actionLog.output })
              .from(actionLog)
              .where(and(inArray(actionLog.domainActionId, completed.map((c) => c.id)), eq(actionLog.step, "execute")))
              .orderBy(desc(actionLog.timestamp)),
          );
          const seen = new Set<string>();
          for (const e of episodes) {
            if (seen.has(e.actionId)) continue;
            seen.add(e.actionId);
            const summaryRow = completed.find((c) => c.id === e.actionId);
            const out = ((e.output as Record<string, unknown>).output ?? {}) as Record<string, unknown>;
            answers.push(await describeExecutionOutput(summaryRow?.summary ?? null, out));
          }
        }

        const parts: string[] = [];
        if (answers.length > 0) parts.push(answers.join(" "));
        if (gated.length > 0) {
          parts.push(`${gated.map((s) => s.summary ?? "an action").join(" Also: ")} Say yes to approve, or no to reject.`);
        }
        if (troubled.length > 0) {
          parts.push(
            troubled
              .map((s) => `${s.actionType ? s.actionType.replaceAll("_", " ") : "one step"} hit an issue and needs your review in the queue.`)
              .join(" "),
          );
        }
        // A plugin returning literally nothing usable is a bug to surface, not a false
        // "it worked" — say so honestly instead of implying success with no content.
        if (parts.length === 0) {
          parts.push(
            summaries.length > 0
              ? `I ran that, but got nothing specific back to tell you — worth checking the audit log for "${summaries[0]!.actionType?.replaceAll("_", " ") ?? "this"}."`
              : "I ran that but have nothing specific to report.",
          );
        }
        results.push({ toolCallId: tc.id, result: parts.join(" ") });
      } else if (name === "finnor_confirm") {
        const decisionWord = String(args.decision ?? args.answer ?? "");
        const decision = parseSpokenDecision(decisionWord, await loadVoiceConfirmationPhrases(tenantId));
        // Recorded regardless of outcome (including "unclear") — this is the caller
        // turn computeLearningDigest's unclearConfirmations later re-parses to surface
        // real phrasings that failed to match, so the dealer can add them as config.
        await appendVoiceTurn({ tenantId, voiceSessionId: session.id, role: "caller", transcriptText: decisionWord });
        if (decision === "unclear") {
          results.push({ toolCallId: tc.id, result: "I didn't catch a clear yes or no — nothing was executed. Say yes or no." });
          continue;
        }
        if (!staffCtx) {
          results.push({ toolCallId: tc.id, result: "I can't verify this line, so there's nothing pending for me to confirm here." });
          continue;
        }
        // Resolve against THIS session's own open pending_confirmations — never the
        // tenant's newest-pending domain_actions. A bare "yes" now only ever applies
        // to what this call's own finnor_instruct actually drafted, never an
        // unrelated caller's or an earlier session's pending action.
        const open = await resolveOpenConfirmations(tenantId, session.id);
        const ids = args.actionId ? [String(args.actionId)] : open.map((o) => o.domainActionId);
        if (ids.length === 0) {
          results.push({ toolCallId: tc.id, result: "I don't have anything pending to confirm on this call." });
          continue;
        }
        // Independent decisions execute concurrently — the caller hears one answer.
        const outcomes = await Promise.all(
          ids.map((id) => getOrchestrator().decide(id, tenantId, decision, `voice:${callId}`)),
        );
        await markConfirmationsResolved(
          tenantId,
          open.filter((o) => ids.includes(o.domainActionId)).map((o) => o.id),
          decision === "approve" ? "confirmed" : "rejected",
        );
        let executed = 0;
        const problems: string[] = [];
        if (decision === "approve") {
          for (const r of outcomes) {
            if (r.status === "success") executed++;
            // Speak the specific failure out loud — same diagnosis the queue card shows.
            else problems.push(diagnoseFailure(r.error, "that action"));
          }
        }
        const spoken =
          decision === "reject"
            ? "Rejected — nothing will be sent."
            : problems.length === 0
              ? `Approved and done — ${executed} action${executed === 1 ? "" : "s"} executed. Everything is in the audit log.`
              : `Approved ${ids.length} action${ids.length === 1 ? "" : "s"}, but ${problems.length} couldn't finish. ${problems[0]}`;
        results.push({ toolCallId: tc.id, result: spoken });
      } else {
        results.push({ toolCallId: tc.id, result: `Unknown tool ${name}.` });
      }
    } catch (err) {
      logWithTrace({ traceId: correlationId, tenantId }).error(
        { err: err instanceof Error ? err.message : String(err) },
        "[vapi tool-call] failed",
      );
      results.push({
        toolCallId: tc.id,
        result: "Something went wrong on my side — that action is parked in your review queue, nothing was sent.",
      });
    }
  }
  return Response.json({ results });
}

export async function POST(req: Request): Promise<Response> {
  await ensureSecretsLoaded();
  const rawBody = await req.text();
  if (!verifySignature(req, rawBody)) return Response.json({ error: "Bad signature" }, { status: 401 });
  let json: unknown = null;
  try {
    json = JSON.parse(rawBody);
  } catch {
    // parsed.success below handles it
  }
  const parsed = VapiWebhookSchema.safeParse(json);
  if (!parsed.success) return Response.json({ error: "Malformed webhook" }, { status: 400 });

  const msg = parsed.data.message as Record<string, unknown> & {
    type: string;
    transcript?: string;
    call?: { id?: string; phoneNumberId?: string; phoneNumber?: { number?: string }; metadata?: Record<string, unknown> };
  };

  // Replay protection, keyed by message shape — NOT bare call id: a single call
  // fires many "tool-calls" messages (one per utterance), all sharing the same
  // call.id, so deduping on call.id alone would silently drop every tool-call after
  // the first one in a live call. "end-of-call-report" genuinely fires once per call,
  // so call id alone is the right key there.
  const callId = msg.call?.id;
  {
    const toolCallIds = ((msg.toolCallList ?? msg.toolCalls ?? []) as VapiToolCall[]).map((tc) => tc.id).join(",");
    const eventId = callId
      ? msg.type === "tool-calls"
        ? `${callId}:tool-calls:${toolCallIds}`
        : `${callId}:${msg.type}`
      : `body:${createHash("sha256").update(rawBody).digest("hex")}`;
    const receipt = await checkAndRecordReceipt("vapi", eventId, rawBody);
    if (receipt === "duplicate") return Response.json({ received: true, duplicate: true });
  }

  // 1. Live-call tools: plan + spoken confirmation inside the same call.
  if (msg.type === "tool-calls") {
    return handleToolCalls(msg);
  }

  if (msg.type === "end-of-call-report" && msg.transcript) {
    const tenantId = await resolveTenantFromCall(msg.call);
    const metadata = (msg.call?.metadata ?? {}) as Record<string, unknown>;

    // 2. Outbound confirmation call ended — parse the spoken decision from the transcript.
    if (metadata.pendingActionId) {
      const decision = parseSpokenDecision(msg.transcript, await loadVoiceConfirmationPhrases(String(metadata.tenantId ?? tenantId)));
      if (decision === "unclear") {
        // Fail closed: unclear speech never approves. The action stays pending in the queue.
        return Response.json({ received: true, decision: "unclear", note: "action left pending" });
      }
      const result = await getOrchestrator().decide(
        String(metadata.pendingActionId),
        String(metadata.tenantId ?? tenantId),
        decision,
        `voice:${msg.call?.id ?? "outbound"}`,
      );
      return Response.json({ received: true, decision, result: result.status });
    }

    // A2.T1: same trace-id namespace as the live-call path above.
    const correlationId = msg.call?.id ? `vapi:${msg.call.id}` : randomUUID();

    // 3. Normal customer call — persist a permanent, queryable call record (Phase 1
    // canonical data platform; replaces the old "transcript used once, then discarded"
    // pattern), then the transcript still becomes a Planner instruction as before.
    if (msg.call?.id) {
      const startedAt = typeof msg.startedAt === "string" ? new Date(msg.startedAt) : undefined;
      const endedAt = typeof msg.endedAt === "string" ? new Date(msg.endedAt) : undefined;
      await withTenant(tenantId, (db) =>
        persistCall(db, {
          tenantId,
          provenance: { sourceSystem: "vapi", externalId: msg.call!.id! },
          direction: "inbound",
          transcript: msg.transcript,
          startedAt,
          endedAt,
          endedReason: typeof msg.endedReason === "string" ? msg.endedReason : undefined,
          raw: { type: msg.type },
        }),
      ).catch((err) => {
        // Never let call-persistence failure block the instruction from still reaching
        // the Planner — the jobs insert below is the load-bearing path.
        logWithTrace({ traceId: correlationId, tenantId }).error(
          { err: err instanceof Error ? err.message : String(err) },
          "[vapi] failed to persist call record",
        );
      });
    }

    // _correlationId is the convention queue.ts's tick() and enqueueJob() already
    // read/write; a bare `.insert(jobs)` (this call bypasses the enqueueJob() helper
    // for its custom idempotencyKey shape) has to set it by hand.
    await adminDb()
      .insert(jobs)
      .values({
        type: "process_instruction",
        payload: {
          tenantId,
          instruction: msg.transcript,
          source: "vapi",
          callId: msg.call?.id ?? null,
          _correlationId: correlationId,
        },
        idempotencyKey: msg.call?.id ? `vapi:${msg.call.id}` : null,
      })
      .onConflictDoNothing({ target: jobs.idempotencyKey });
  }
  return Response.json({ received: true });
}
