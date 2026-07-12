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
import { parseSpokenDecision, diagnoseFailure, resolveProvider } from "@finnor/orchestration";
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
