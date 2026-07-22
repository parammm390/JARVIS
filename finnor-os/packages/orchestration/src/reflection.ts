// Reflection (§9): compare expected vs actual outcome. On mismatch: retry once, then
// flag needs_human_review in the confirmation queue. Never silently swallow a failure,
// never retry indefinitely.
//
// A4.T1: retry is now gated on errorKind, not fired blindly on every non-success outcome.
// RETRYABLE_KINDS mirrors workflow-runtime/src/outbox.ts's own established "replayable"
// judgment (sendToDeadLetter: everything except validation/terminal) — "retryable" (the
// generic/unclassified-transient default, see outbox's classifyErrorKind) and
// "provider_down" (an integration that just failed/timed out — see runtime-bridge.ts's
// classifyFailure) are both environmental, worth one real second attempt. "validation"/
// "auth"/"conflict"/"terminal"/"needs_human"/"config" describe a defect in the request or
// a state only a human/config-fix can resolve — retrying changes nothing, so those (and a
// result with no errorKind at all — a plugin bypassing runtime-bridge's classification,
// treated as non-retryable, matching steps.ts's own "unclassified defaults to terminal"
// convention) escalate immediately instead of wasting a cycle.

import type { DomainAction, ExecutionResult, ReflectionOutcome } from "@finnor/shared-types";
import { withTenant, domainActions } from "@finnor/db";
import { appendEpisode, readEpisodes } from "@finnor/memory";
import { and, eq } from "drizzle-orm";

const RETRYABLE_KINDS: ReadonlySet<string> = new Set(["retryable", "provider_down"]);

export interface Reflection {
  evaluate(action: DomainAction, result: ExecutionResult): Promise<ReflectionOutcome>;
}

export class OutcomeReflection implements Reflection {
  async evaluate(action: DomainAction, result: ExecutionResult): Promise<ReflectionOutcome> {
    let outcome: ReflectionOutcome;

    if (result.status === "success") {
      outcome = { matched: true, decision: "accept", detail: "Outcome matched expectation." };
    } else if (result.output.gated || result.output.pendingConfirmation) {
      outcome = { matched: true, decision: "accept", detail: "Awaiting human confirmation — expected state." };
    } else {
      // Failure path: has this action already been retried once? Episodic memory knows.
      const episodes = await readEpisodes(action.tenantId, { domainActionId: action.id, limit: 50 });
      const priorRetries = episodes.filter((e) => e.step === "reflection_retry").length;
      if (priorRetries === 0 && result.errorKind !== undefined && RETRYABLE_KINDS.has(result.errorKind)) {
        outcome = {
          matched: false,
          decision: "retry",
          detail: `Outcome mismatch (${result.status}): ${result.error ?? "no detail"}. Retrying once.`,
        };
        await appendEpisode(action.tenantId, action.id, "reflection_retry", {}, { reason: outcome.detail });
      } else {
        const because =
          priorRetries > 0
            ? `Still failing after one retry: ${result.error ?? "no detail"}.`
            : `${result.errorKind ?? "unclassified"} failure, not retryable: ${result.error ?? "no detail"}.`;
        outcome = {
          matched: false,
          decision: "escalate",
          detail: `${because} Escalating to a human.`,
        };
        await withTenant(action.tenantId, async (db) => {
          await db
            .update(domainActions)
            .set({ status: "needs_human_review" })
            .where(and(eq(domainActions.id, action.id), eq(domainActions.tenantId, action.tenantId)));
        });
      }
    }

    await appendEpisode(action.tenantId, action.id, "reflection", { status: result.status }, { ...outcome });
    return outcome;
  }
}
