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
//  3. end-of-call-report for a normal customer call: persisted and normalized as
//     untrusted evidence; it can wake an exact wait but never becomes an instruction.

import { createHash, randomUUID } from "node:crypto";
import { VapiWebhookSchema } from "@finnor/policy-schema";
import { adminDb, withTenant, domainActions, domainPolicies, actionLog, tenantPhoneNumbers, getPool, households, communicationsLog, works, receiveWork, users, workAggregate, ingestIntegrationEventTx, externalOperations, integrationOperations, enqueueJob, type Db } from "@finnor/db";
import { createTask, persistCall, recordBusinessEvent } from "@finnor/data-platform";
import { ensureSecretsLoaded, resolveTenantCredentialContext } from "@finnor/security";
import { parseSpokenDecision, diagnoseFailure, resolveProviderForPurpose } from "@finnor/orchestration";
import { VOICE_AGENT_KEYS, logWithTrace } from "@finnor/tools";
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
import { and, desc, eq, inArray, notInArray, sql } from "drizzle-orm";
import { getOrchestrator } from "../../../../lib/orchestrator";
import { checkAndRecordReceipt } from "../../../../lib/webhook-replay";
import { verifyTimestampedHmacSignature } from "../../../../lib/verify-hmac-signature";
import { employeeAuthoritySnapshot } from "@finnor/authority";
import { parseVoiceObjectiveCommand } from "../../../../lib/voice-objective-command";

/**
 * HMAC-with-timestamp: header `x-vapi-signature: t=<unix>,v1=<hex hmac>` computed over
 * `${t}.${rawBody}`. Fails open ONLY when the secret is unset AND NODE_ENV isn't
 * production (dev convenience); fails CLOSED otherwise, and always rejects a
 * signature outside a 5-minute window even with a valid secret.
 */
function verifySignature(req: Request, rawBody: string, secret?: string): boolean {
  return verifyTimestampedHmacSignature(req, {
    header: "x-vapi-signature",
    secret,
    rawBody,
    allowUnsetSecret: process.env.NODE_ENV !== "production",
  });
}

/**
 * Resolves which tenant a call belongs to from the DIALED number — replaces the
 * previous hardcoded defaultTenant() everywhere, which routed every call on every
 * deployed line to the same single tenant regardless of who was actually dialed.
 * Match order: (1) Vapi's own phoneNumberId (preferred — stable across number
 * changes), then (2) the dialed number in E.164. An unmapped line fails closed;
 * choosing a default tenant would turn a provider/configuration error into a
 * cross-tenant data write. `tenant_phone_numbers` has no RLS (like `jobs`) because
 * tenant_id is exactly what's unknown at this point.
 */
async function resolveTenantFromCall(call: { phoneNumberId?: string; phoneNumber?: { number?: string } } | undefined): Promise<string | null> {
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
  logWithTrace({}).error(
    { phoneNumberId: call?.phoneNumberId, hasDialedNumber: Boolean(dialedNumber) },
    "[vapi] tenant line is unmapped — webhook rejected before replay claim",
  );
  return null;
}

type SafeCallContext = {
  direction?: "outbound";
  agentKey?: (typeof VOICE_AGENT_KEYS)[number];
  domainActionId?: string;
  householdId?: string;
  invoiceId?: string;
  purpose?: string;
};

function nonEmptyString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

/** Only values authored by Finnor's bounded call writers survive into the durable
 * call row. Provider metadata is intentionally not copied wholesale. */
function safeCallContext(metadata: unknown): SafeCallContext {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return {};
  const source = metadata as Record<string, unknown>;
  const agentKey = nonEmptyString(source.agentKey);
  return {
    ...(source.direction === "outbound" ? { direction: "outbound" } : {}),
    ...(agentKey && VOICE_AGENT_KEYS.includes(agentKey as (typeof VOICE_AGENT_KEYS)[number])
      ? { agentKey: agentKey as (typeof VOICE_AGENT_KEYS)[number] }
      : {}),
    ...(nonEmptyString(source.domainActionId) ? { domainActionId: nonEmptyString(source.domainActionId) } : {}),
    ...(nonEmptyString(source.householdId) ? { householdId: nonEmptyString(source.householdId) } : {}),
    ...(nonEmptyString(source.invoiceId) ? { invoiceId: nonEmptyString(source.invoiceId) } : {}),
    ...(nonEmptyString(source.purpose) ? { purpose: nonEmptyString(source.purpose) } : {}),
  };
}

function callContextRaw(context: SafeCallContext, type: string, outcome?: Record<string, unknown>): Record<string, unknown> {
  return {
    type,
    ...(context.direction ? { direction: context.direction } : {}),
    ...(context.agentKey ? { agentKey: context.agentKey } : {}),
    ...(context.domainActionId ? { domainActionId: context.domainActionId } : {}),
    ...(context.householdId ? { householdId: context.householdId } : {}),
    ...(context.invoiceId ? { invoiceId: context.invoiceId } : {}),
    ...(context.purpose ? { purpose: context.purpose } : {}),
    ...(outcome ? { outcome } : {}),
  };
}

const OUTBOUND_OUTCOMES = new Set(["booked", "interested", "follow_up_later", "not_interested", "opted_out", "wrong_number", "voicemail", "no_answer", "unknown"]);

function boundedProviderText(value: unknown, max = 500): string | undefined {
  if (typeof value !== "string") return undefined;
  const clean = value.replace(/\s+/g, " ").trim();
  return clean ? clean.slice(0, max) : undefined;
}

/** Provider analysis is data, never an instruction. Only a narrow allowlist reaches
 * durable business state; arbitrary analysis/artifact keys are discarded. */
function outboundOutcome(msg: Record<string, unknown>, transcript: string): Record<string, unknown> {
  const analysis = msg.analysis && typeof msg.analysis === "object" && !Array.isArray(msg.analysis)
    ? (msg.analysis as Record<string, unknown>)
    : {};
  const structured = analysis.structuredData && typeof analysis.structuredData === "object" && !Array.isArray(analysis.structuredData)
    ? (analysis.structuredData as Record<string, unknown>)
    : {};
  const rawOutcome = boundedProviderText(structured.outcome, 40)?.toLowerCase();
  const explicitTranscriptOptOut = /\b(?:do not|don't|stop)\s+(?:call(?:ing)?|contact(?:ing)?|text(?:ing)?)\b|\bopt\s+me\s+out\b/i.test(transcript);
  const optOut = structured.optOut === true || rawOutcome === "opted_out" || explicitTranscriptOptOut;
  return {
    outcome: optOut ? "opted_out" : rawOutcome && OUTBOUND_OUTCOMES.has(rawOutcome) ? rawOutcome : "unknown",
    sentiment: ["positive", "neutral", "negative", "unknown"].includes(String(structured.sentiment)) ? String(structured.sentiment) : "unknown",
    appointmentRequested: structured.appointmentRequested === true,
    preferredTimeText: boundedProviderText(structured.preferredTimeText, 200) ?? null,
    optOut,
    experienceSummary: boundedProviderText(structured.experienceSummary, 500) ?? boundedProviderText(analysis.summary, 500) ?? null,
  };
}

async function recordOutboundCustomerOutcomeTx(
  db: Db,
  tenantId: string,
  householdId: string | undefined,
  callId: string | undefined,
  callContext: SafeCallContext,
  outcome: Record<string, unknown>,
): Promise<void> {
  if (!householdId) return;
  const summary = [
    `Outbound ${callContext.purpose ?? "customer"} call`,
    `outcome: ${String(outcome.outcome ?? "unknown")}`,
    outcome.experienceSummary ? `experience: ${String(outcome.experienceSummary)}` : null,
    outcome.preferredTimeText ? `preferred time: ${String(outcome.preferredTimeText)}` : null,
  ].filter(Boolean).join("; ");
  await db.insert(communicationsLog).values({
    householdId,
    channel: "call",
    direction: "outbound",
    content: summary.slice(0, 1200),
  });
  if (outcome.optOut === true) {
    await db.update(households).set({ marketingConsent: false }).where(eq(households.id, householdId));
  }
  await recordBusinessEvent(db, {
    tenantId,
    entityType: "household",
    entityId: householdId,
    eventType: "campaign_call_completed",
    source: "vapi",
    payload: {
      callId: callId ?? null,
      domainActionId: callContext.domainActionId ?? null,
      agentKey: callContext.agentKey ?? null,
      purpose: callContext.purpose ?? null,
      ...outcome,
    },
  });
  if (outcome.appointmentRequested === true) {
    await createTask(db, {
      tenantId,
      subjectType: "household",
      subjectId: householdId,
      title: `Confirm appointment requested during ${callContext.purpose ?? "outbound"} call${outcome.preferredTimeText ? ` · ${String(outcome.preferredTimeText)}` : ""}`.slice(0, 500),
      priority: "high",
    });
  }
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
    const deadlineAt = Date.now() + 2_500;
    const text = await Promise.race([
      resolveProviderForPurpose("answer", "voice").complete({
        system:
          "Rewrite this raw key:value execution result as one short, natural spoken sentence a person would say out loud. State every fact given — never drop or invent a value. No preamble, just the sentence.",
        user: raw,
        purpose: "answer",
        channel: "voice",
        signal: controller.signal,
        deadlineAt,
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

async function handleToolCalls(message: Record<string, unknown>, tenantId: string): Promise<Response> {
  const callMeta = message.call as
    | { id?: string; phoneNumberId?: string; customer?: { number?: string }; phoneNumber?: { number?: string }; metadata?: Record<string, unknown> }
    | undefined;
  const callId = callMeta?.id ?? "unknown";
  const list = (message.toolCallList ?? message.toolCalls ?? []) as VapiToolCall[];
  const results: Array<{ toolCallId: string; result: string }> = [];

  // Real caller resolution (§5 voice OS) — replaces the previous hardcoded owner
  // userId/role that every caller on this line got, regardless of who was actually
  // calling. Only a phone number matching the tenant's registered owner line resolves
  // to owner trust; anything else (a customer, an unrecognized number, no caller-id
  // at all) never gets silently upgraded the way it used to.
  const identity = callMeta?.customer?.number ? await resolveVoiceIdentity(tenantId, callMeta.customer.number) : null;
  const staffCtx: { userId: string; role: Role } | null =
    identity?.matchedUserId && ["owner", "dispatcher", "technician"].includes(identity.role)
      ? { userId: identity.matchedUserId, role: identity.role as Role }
      : null;
  const voiceAuthority = staffCtx ? await employeeAuthoritySnapshot({ tenantId, userId: staffCtx.userId, employeeId: staffCtx.userId, role: staffCtx.role }) : null;
  const session = await openVoiceSession(tenantId, callId, identity?.id, staffCtx?.userId, voiceAuthority ?? undefined);
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
        const sessionId = `vapi:${callId}`;
        const [activeWork] = await withTenant(tenantId, (db) => db
          .select({ id: works.id })
          .from(works)
          .where(and(eq(works.tenantId, tenantId), eq(works.sessionId, sessionId), notInArray(works.status, ["completed"])))
          .orderBy(desc(works.updatedAt))
          .limit(1));
        const objectiveCommand = parseVoiceObjectiveCommand(instruction);
        if (objectiveCommand) {
          const orchestrator = getOrchestrator();
          const activeAggregate = activeWork ? await workAggregate(tenantId, activeWork.id) : null;
          const activeObjective = activeAggregate?.objectiveLoop;
          let spoken: string;
          if (objectiveCommand.command === "start") {
            if (activeObjective && !["completed", "failed", "cancelled"].includes(activeObjective.state)) {
              spoken = `There is already an active objective: ${activeObjective.objective}. Say redirect this objective to, followed by the revised outcome.`;
            } else {
              const started = await orchestrator.startObjective(
                objectiveCommand.objective,
                { tenantId, userId: staffCtx.userId, employeeId: staffCtx.userId, authorityRevision: voiceAuthority?.revision, authorityRoles: voiceAuthority?.roles, role: staffCtx.role, correlationId },
                { sessionId, channel: "voice", workId: activeWork?.id, idempotencyKey: `vapi:${callId}:objective:${tc.id}` },
              );
              spoken = `I own that objective now. It is durable Work ${started.workId.slice(0, 8)}, and I will inspect current business state before choosing one bounded next step.`;
            }
          } else if (!activeWork || !activeObjective) {
            spoken = "There is no active objective in this call to control.";
          } else if (objectiveCommand.command === "inspect") {
            spoken = `The objective is ${activeObjective.state.replaceAll("_", " ")}. I am trying to ${activeObjective.objective}. ${activeObjective.reason ?? "Canonical inspection will determine what happens next."}${activeObjective.nextStep ? ` Next: ${activeObjective.nextStep}` : ""}`;
          } else {
            if (objectiveCommand.command === "redirect") {
              await receiveWork({
                tenantId,
                instruction: objectiveCommand.objective,
                channel: "voice",
                sessionId,
                workId: activeWork.id,
                userId: staffCtx.userId,
                idempotencyKey: `vapi:${callId}:objective-redirect:${tc.id}`,
                authorityContext: { employeeId: staffCtx.userId, revision: voiceAuthority?.revision ?? null, roles: voiceAuthority?.roles ?? [], principal: staffCtx.userId },
              });
            }
            const controlled = await orchestrator.controlObjective({
              tenantId,
              workId: activeWork.id,
              command: objectiveCommand.command,
              actorId: staffCtx.userId,
              objective: objectiveCommand.command === "redirect" ? objectiveCommand.objective : undefined,
              correlationId,
            });
            spoken = objectiveCommand.command === "interrupt"
              ? `I interrupted the objective durably. Completed progress is preserved, and it will not continue until you explicitly resume or redirect it.`
              : objectiveCommand.command === "cancel"
                ? `I cancelled responsibility for that objective explicitly. Its causal history is preserved and it will not resume.`
              : objectiveCommand.command === "redirect"
                ? `I redirected the same Work to: ${controlled.objective}. I will re-inspect canonical business state before the next step.`
                : `I resumed the same objective. I will re-inspect canonical business state before choosing the next bounded step.`;
          }
          await appendVoiceTurn({ tenantId, voiceSessionId: session.id, role: "caller", transcriptText: instruction, resolvedActionIds: [] });
          results.push({ toolCallId: tc.id, result: spoken });
          continue;
        }
        const instructionResult = await getOrchestrator().handleInstructionResult(
          instruction,
          { tenantId, userId: staffCtx.userId, employeeId: staffCtx.userId, authorityRevision: voiceAuthority?.revision, authorityRoles: voiceAuthority?.roles, role: staffCtx.role, correlationId },
          {
            sessionId,
            channel: "voice",
            workId: activeWork?.id,
            idempotencyKey: `vapi:${callId}:tool:${tc.id}`,
          },
        );
        const actions = instructionResult.actions;
        await appendVoiceTurn({
          tenantId,
          voiceSessionId: session.id,
          role: "caller",
          transcriptText: instruction,
          resolvedActionIds: actions.map((a) => a.id),
        });
        if (instructionResult.answer) {
          results.push({ toolCallId: tc.id, result: instructionResult.answer.spokenSummary });
          continue;
        }
        if (instructionResult.objective) {
          results.push({ toolCallId: tc.id, result: `I accepted that as durable objective Work ${instructionResult.workId?.slice(0, 8)}. I will re-inspect current business state, take one governed step at a time, and stop only when the outcome verifies or I am explicitly blocked.` });
          continue;
        }
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
          ids.map((id) => getOrchestrator().decide(id, tenantId, decision, staffCtx.userId, { role: staffCtx.role, note: `voice:${callId}` })),
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
    status?: string;
    call?: { id?: string; phoneNumberId?: string; customer?: { number?: string }; phoneNumber?: { number?: string }; metadata?: Record<string, unknown> };
  };

  // Resolve the tenant before claiming the provider replay receipt. If a line is
  // configured after an initial failed delivery, Vapi can retry the identical event
  // and continue safely; an unmapped attempt must not poison its idempotency key.
  const tenantId = await resolveTenantFromCall(msg.call);
  if (!tenantId) {
    return Response.json(
      { error: "Unmapped Vapi line; no tenant-scoped work was accepted" },
      { status: 503, headers: { "retry-after": "60" } },
    );
  }

  let webhookSecret: string | undefined;
  try {
    webhookSecret = (await resolveTenantCredentialContext(tenantId, "vapi")).credentials.webhookSecret;
  } catch {
    // A tenant with no real Vapi binding may still exercise unsigned emulator
    // webhooks outside production. Production always fails closed below.
  }
  if (!verifySignature(req, rawBody, webhookSecret)) {
    logWithTrace({ route: "webhooks/vapi", tenantId }).warn({ event: "webhook_signature_rejected", provider: "vapi" }, "rejected webhook: bad x-vapi-signature");
    return Response.json({ error: "Bad signature" }, { status: 401 });
  }

  // Replay protection, keyed by message shape — NOT bare call id: a single call
  // fires many "tool-calls" messages (one per utterance) AND many "status-update"
  // messages (queued/ringing/in-progress/forwarding/ended), all sharing the same
  // call.id and, for status-update, the same msg.type too — deduping on call id (or
  // call id + type) alone would silently drop every status transition after the
  // first. "end-of-call-report" genuinely fires once per call, so call id alone is
  // the right key there.
  const callId = msg.call?.id;
  if (msg.type !== "end-of-call-report") {
    const toolCallIds = ((msg.toolCallList ?? msg.toolCalls ?? []) as VapiToolCall[]).map((tc) => tc.id).join(",");
    const eventId = callId
      ? msg.type === "tool-calls"
        ? `${callId}:tool-calls:${toolCallIds}`
        : msg.type === "status-update"
          ? `${callId}:status-update:${msg.status ?? "unknown"}`
          : `${callId}:${msg.type}`
      : `body:${createHash("sha256").update(rawBody).digest("hex")}`;
    const receipt = await checkAndRecordReceipt("vapi", eventId, rawBody);
    if (receipt === "duplicate") return Response.json({ received: true, duplicate: true });
  }

  // 1. Live-call tools: plan + spoken confirmation inside the same call.
  if (msg.type === "tool-calls") {
    return handleToolCalls(msg, tenantId);
  }

  // B1.T4: in-progress call status → NOTIFY → SSE, so the cockpit sees a call
  // ringing/connecting/ending live, not only once persistCall runs at the very end.
  // Deliberately ephemeral — no durable row (calls has no in-progress state of its
  // own; persistCall's insert at end-of-call-report remains the durable record, and
  // migration 0037's calls_notify trigger covers that half already). A direct
  // pg_notify from here, not a trigger, since there is no table write to hang one off.
  if (msg.type === "status-update" && callId) {
    await getPool().query("SELECT pg_notify('jarvis_events', $1)", [
      JSON.stringify({ tenantId, kind: "call_status", id: callId, ts: new Date().toISOString(), status: msg.status ?? "unknown" }),
    ]);
    return Response.json({ received: true });
  }

  if (msg.type === "end-of-call-report") {
    const metadata = (msg.call?.metadata ?? {}) as Record<string, unknown>;
    const callContext = safeCallContext(metadata);
    const transcript = msg.transcript ?? "";

    // 2. Outbound confirmation call ended — parse the spoken decision from the transcript.
    if (metadata.pendingActionId) {
      const decision = parseSpokenDecision(transcript, await loadVoiceConfirmationPhrases(tenantId));
      if (decision === "unclear") {
        // Fail closed: unclear speech never approves. The action stays pending in the queue.
        return Response.json({ received: true, decision: "unclear", note: "action left pending" });
      }
      const approverEmployeeId = typeof metadata.approverEmployeeId === "string" ? metadata.approverEmployeeId : null;
      const [approver] = approverEmployeeId ? await withTenant(tenantId, (db) => db.select({ id: users.id, role: users.role, phoneNumber: users.phoneNumber, status: users.status }).from(users).where(and(eq(users.tenantId, tenantId), eq(users.id, approverEmployeeId))).limit(1)) : [];
      if (!approver || approver.status !== "active" || !approver.phoneNumber || approver.phoneNumber !== msg.call?.customer?.number) {
        return Response.json({ received: true, decision: "refused", note: "outbound approver identity could not be re-verified" });
      }
      const result = await getOrchestrator().decide(
        String(metadata.pendingActionId),
        tenantId,
        decision,
        approver.id,
        { role: approver.role, note: `voice:${msg.call?.id ?? "outbound"}` },
      );
      return Response.json({ received: true, decision, result: result.status });
    }

    // A2.T1: same trace-id namespace as the live-call path above.
    const correlationId = msg.call?.id ? `vapi:${msg.call.id}` : randomUUID();

    // 3. Normal customer call — persist the canonical call, then normalize one
    // untrusted observation. Customer/provider speech is evidence and may satisfy an
    // exact configured wait; it is never submitted as a privileged instruction.
    const outcome = callContext.direction === "outbound" ? outboundOutcome(msg, transcript) : undefined;
    const inboundIdentity = !callContext.householdId && msg.call?.customer?.number
      ? await resolveVoiceIdentity(tenantId, msg.call.customer.number)
      : null;
    const resolvedHouseholdId = callContext.householdId ?? inboundIdentity?.matchedHouseholdId ?? undefined;
    const normalized = await withTenant(tenantId, async (db) => {
      const persisted = msg.call?.id ? await persistCall(db, {
          tenantId,
          provenance: { sourceSystem: "vapi", externalId: msg.call.id },
          direction: callContext.direction ?? "inbound",
          transcript,
          fromNumber: msg.call?.customer?.number,
          toNumber: msg.call?.phoneNumber?.number,
          startedAt: typeof msg.startedAt === "string" ? new Date(msg.startedAt) : undefined,
          endedAt: typeof msg.endedAt === "string" ? new Date(msg.endedAt) : undefined,
          endedReason: typeof msg.endedReason === "string" ? msg.endedReason : undefined,
          raw: callContextRaw(callContext, msg.type, outcome),
          householdId: resolvedHouseholdId,
        }) : null;
      const [linkedAction] = callContext.domainActionId ? await db.select({ workId: domainActions.workId }).from(domainActions).where(and(
        eq(domainActions.tenantId, tenantId),
        eq(domainActions.id, callContext.domainActionId),
      )).limit(1) : [];
      const event = await ingestIntegrationEventTx(db, {
        tenantId,
        source: "vapi",
        provider: "vapi",
        sourceEventId: msg.call?.id ? `${msg.call.id}:completed` : `body:${createHash("sha256").update(rawBody).digest("hex")}:completed`,
        eventType: "call.completed",
        occurredAt: typeof msg.endedAt === "string" ? new Date(msg.endedAt) : new Date(),
        party: resolvedHouseholdId ? { type: "household", id: resolvedHouseholdId } : null,
        resource: persisted ? { type: "call", id: persisted.callId } : null,
        workId: linkedAction?.workId ?? null,
        // Provider metadata is only a hint. Attach the action ref after a tenant-
        // scoped canonical lookup succeeds.
        domainActionId: linkedAction ? callContext.domainActionId ?? null : null,
        providerConversationId: msg.call?.id ?? null,
        correlationId,
        payload: {
          direction: callContext.direction ?? "inbound",
          endedReason: typeof msg.endedReason === "string" ? msg.endedReason.slice(0, 200) : null,
          outcome: outcome ?? null,
          transcriptExcerpt: transcript.replace(/\s+/g, " ").trim().slice(0, 4000),
        },
        evidenceRefs: persisted ? [{ type: "call", id: persisted.callId }] : [],
        trustClass: "untrusted_external",
      });
      if (callContext.direction === "outbound" && !event.duplicate) {
        await recordOutboundCustomerOutcomeTx(db, tenantId, resolvedHouseholdId, msg.call?.id, callContext, outcome ?? outboundOutcome(msg, transcript));
      }
      return event;
    });

    if (msg.call?.id) {
      const waiting = await withTenant(tenantId, async (db) => ({
        external: await db.select({ actionId: externalOperations.domainActionId, operationKey: externalOperations.operationKey }).from(externalOperations).where(and(
          eq(externalOperations.tenantId, tenantId),
          eq(externalOperations.provider, "vapi"),
          eq(externalOperations.verificationStatus, "awaiting_observation"),
          eq(sql`${externalOperations.response}->>'callId'`, msg.call!.id!),
        )),
        capability: await db.select({ id: integrationOperations.id }).from(integrationOperations).where(and(
          eq(integrationOperations.tenantId, tenantId),
          eq(integrationOperations.provider, "vapi"),
          eq(integrationOperations.verificationStatus, "awaiting_observation"),
          eq(sql`${integrationOperations.response}->>'callId'`, msg.call!.id!),
        )),
      }));
      for (const operation of waiting.external) await enqueueJob(
        "observe_external_effect",
        { tenantId, domainActionId: operation.actionId, externalOperationKey: operation.operationKey, attempt: 99 },
        `observe-vapi-event:${tenantId}:${msg.call.id}:${operation.operationKey}`,
      );
      for (const operation of waiting.capability) await enqueueJob(
        "observe_external_effect",
        { tenantId, integrationOperationId: operation.id, attempt: 99 },
        `observe-vapi-event:${tenantId}:${msg.call.id}:${operation.id}`,
      );
    }

    // A customer answering an outbound campaign/payment/service call is never the
    // authenticated dealer. Persist the call and its bounded outcome, then stop: the
    // old path enqueued their transcript as an owner `process_instruction`, which
    // could turn customer speech into privileged plans.
    if (callContext.direction === "outbound") {
      return Response.json({ received: true, duplicate: normalized.duplicate, outbound: true, outcome: outcome?.outcome ?? "unknown" });
    }

    return Response.json({ received: true, duplicate: normalized.duplicate, observation: true, instructionQueued: false });
  }
  return Response.json({ received: true });
}
