// Reflection (§9): compare expected vs actual outcome. On mismatch: retry once, then
// flag needs_human_review in the confirmation queue. Never silently swallow a failure,
// never retry indefinitely.

import type { DomainAction, ExecutionResult, ReflectionOutcome } from "@finnor/shared-types";
import { withTenant, domainActions } from "@finnor/db";
import { appendEpisode, readEpisodes } from "@finnor/memory";
import { and, eq } from "drizzle-orm";

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
      if (priorRetries === 0) {
        outcome = {
          matched: false,
          decision: "retry",
          detail: `Outcome mismatch (${result.status}): ${result.error ?? "no detail"}. Retrying once.`,
        };
        await appendEpisode(action.tenantId, action.id, "reflection_retry", {}, { reason: outcome.detail });
      } else {
        outcome = {
          matched: false,
          decision: "escalate",
          detail: `Still failing after one retry: ${result.error ?? "no detail"}. Escalating to a human.`,
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
