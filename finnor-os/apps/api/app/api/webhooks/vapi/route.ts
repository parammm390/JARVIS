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

import { VapiWebhookSchema } from "@finnor/policy-schema";
import { adminDb, jobs, withTenant, domainActions, actionLog } from "@finnor/db";
import { parseSpokenDecision, diagnoseFailure } from "@finnor/orchestration";
import { and, desc, eq, inArray } from "drizzle-orm";
import { getOrchestrator } from "../../../../lib/orchestrator";

function verifySecret(req: Request): boolean {
  const expected = process.env.VAPI_WEBHOOK_SECRET;
  if (!expected) return true; // not configured yet — set VAPI_WEBHOOK_SECRET in production
  return req.headers.get("x-vapi-secret") === expected;
}

function defaultTenant(): string {
  return process.env.VAPI_DEFAULT_TENANT_ID ?? "PLACEHOLDER_NEEDS_REAL_VALUE";
}

interface VapiToolCall {
  id: string;
  function?: { name?: string; arguments?: Record<string, unknown> | string };
}

async function handleToolCalls(message: Record<string, unknown>): Promise<Response> {
  const tenantId = defaultTenant();
  const callId = (message.call as { id?: string } | undefined)?.id ?? "unknown";
  const list = (message.toolCallList ?? message.toolCalls ?? []) as VapiToolCall[];
  const results: Array<{ toolCallId: string; result: string }> = [];

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
        const actions = await getOrchestrator().handleInstruction(
          instruction,
          {
            tenantId,
            userId: "00000000-0000-4000-8000-0000000000ee",
            role: "owner", // voice channel authenticates as the owner's line for now
          },
          { sessionId: `vapi:${callId}` },
        );
        if (actions.length === 0) {
          results.push({ toolCallId: tc.id, result: "I couldn't map that to anything I can do yet. Try rephrasing." });
          continue;
        }
        // Read the drafted, gated actions back for spoken approval in this same call.
        const summaries = await withTenant(tenantId, (db) =>
          db
            .select({ id: domainActions.id, summary: domainActions.summary, status: domainActions.status })
            .from(domainActions)
            .where(inArray(domainActions.id, actions.map((a) => a.id))),
        );
        const gated = summaries.filter((s) => s.status === "pending");
        // Ungated actions (read-only research, stock checks) already completed — speak
        // their actual answers, not just an acknowledgement.
        const completed = summaries.filter((s) => s.status === "completed");
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
            const out = ((e.output as Record<string, unknown>).output ?? {}) as Record<string, unknown>;
            const spokenAnswer =
              (out.spokenSummary as string | undefined) ??
              (out.recommendation as string | undefined) ??
              (out.answer as string | undefined) ??
              (out.quantity !== undefined ? `${out.name ?? "item"}: ${out.quantity} in stock.` : undefined);
            if (spokenAnswer) answers.push(spokenAnswer);
          }
        }
        const parts: string[] = [];
        if (answers.length > 0) parts.push(answers.join(" "));
        if (gated.length > 0) {
          parts.push(`${gated.map((s) => s.summary ?? "an action").join(" Also: ")} Say yes to approve, or no to reject.`);
        }
        if (parts.length === 0) parts.push("Done — everything ran, nothing needed your approval.");
        results.push({ toolCallId: tc.id, result: parts.join(" ") });
      } else if (name === "finnor_confirm") {
        const decisionWord = String(args.decision ?? args.answer ?? "");
        const decision = parseSpokenDecision(decisionWord);
        if (decision === "unclear") {
          results.push({ toolCallId: tc.id, result: "I didn't catch a clear yes or no — nothing was executed. Say yes or no." });
          continue;
        }
        // Apply to the caller's newest pending action(s) — same rows the queue UI shows.
        const pending = await withTenant(tenantId, (db) =>
          db
            .select({ id: domainActions.id })
            .from(domainActions)
            .where(eq(domainActions.status, "pending"))
            .orderBy(desc(domainActions.createdAt))
            .limit(args.actionId ? 1 : 5),
        );
        const ids = args.actionId ? [String(args.actionId)] : pending.map((p) => p.id);
        // Independent decisions execute concurrently — the caller hears one answer.
        const outcomes = await Promise.all(
          ids.map((id) => getOrchestrator().decide(id, tenantId, decision, `voice:${callId}`)),
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
      console.error("[vapi tool-call]", err);
      results.push({
        toolCallId: tc.id,
        result: "Something went wrong on my side — that action is parked in your review queue, nothing was sent.",
      });
    }
  }
  return Response.json({ results });
}

export async function POST(req: Request): Promise<Response> {
  if (!verifySecret(req)) return Response.json({ error: "Bad signature" }, { status: 401 });
  const parsed = VapiWebhookSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Malformed webhook" }, { status: 400 });

  const msg = parsed.data.message as Record<string, unknown> & {
    type: string;
    transcript?: string;
    call?: { id?: string; metadata?: Record<string, unknown> };
  };

  // 1. Live-call tools: plan + spoken confirmation inside the same call.
  if (msg.type === "tool-calls") {
    return handleToolCalls(msg);
  }

  if (msg.type === "end-of-call-report" && msg.transcript) {
    const tenantId = defaultTenant();
    const metadata = (msg.call?.metadata ?? {}) as Record<string, unknown>;

    // 2. Outbound confirmation call ended — parse the spoken decision from the transcript.
    if (metadata.pendingActionId) {
      const decision = parseSpokenDecision(msg.transcript);
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

    // 3. Normal customer call — transcript becomes a Planner instruction (as before).
    await adminDb()
      .insert(jobs)
      .values({
        type: "process_instruction",
        payload: { tenantId, instruction: msg.transcript, source: "vapi", callId: msg.call?.id ?? null },
        idempotencyKey: msg.call?.id ? `vapi:${msg.call.id}` : null,
      })
      .onConflictDoNothing({ target: jobs.idempotencyKey });
  }
  return Response.json({ received: true });
}
