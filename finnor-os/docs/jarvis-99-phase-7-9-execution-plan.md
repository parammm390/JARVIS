# Phases 7–9 Execution Plan (companion to jarvis-99-roadmap.md)

**Scope note:** "the first three phases" = Phase 7, 8, 9 — the first three of the
`PHASES 7-16 (NEXT)` continuation block in `jarvis-99-roadmap.md`. Phases 1-6 are
built and verified — confirmed live: `npx tsc -p tsconfig.json` exits clean and the
full suite (`node --env-file=.env node_modules/.bin/vitest run`) passes 43/43 test
files, 246/246 tests, against the real local Postgres. **They are NOT committed** —
`git status` shows the entire Phase 1-6 surface (packages/workflow-runtime,
packages/read-models, packages/data-platform, packages/voice-os,
packages/orchestration/src/compiler.ts, all four vertical-workflow plugins, migrations
0008-0011, 11 integration test files, and this repo's own jarvis-99-roadmap.md) sitting
uncommitted since commit `53992f1`. Before starting Phase 7, commit that work in
reviewed, logical chunks — building three more phases on top of ~35 uncommitted paths
with no rollback point compounds the risk every phase adds.

**How this document relates to the roadmap:** `jarvis-99-roadmap.md`'s own per-phase
sections are intentionally terse — "self-contained block, paste into a fresh chat"
prompts meant for a session with zero prior context. This document is the missing
middle layer: it was written after actually reading the current implementation of
every file each phase touches (not just the roadmap's prose description of them), and
it resolves every ambiguity and sequencing hazard found along the way into concrete,
unambiguous decisions — exact function signatures, exact file paths, exact insertion
points, exact test cases. The target reader is a low-reasoning-effort execution pass
with no room to improvise architecture; every judgment call that matters is made here,
not left open.

Still paste the roadmap's own `SHARED CONTEXT` block first in whatever session
executes this — this document assumes that context and does not repeat it. Use this
doc's per-phase `EXECUTION PROMPT` block (bottom of each section) as what actually gets
pasted after the shared context, in place of the roadmap's own shorter prompt.

---

## Read this before writing any code

Seven concrete facts about the *current* code that shape every decision below. Each
one was found by reading the actual files, not inferred from the roadmap's prose —
where the roadmap's description and the code disagree, the code wins.

**1. `scripts/eval-planner.ts` never goes through the orchestrator.** It constructs
`new LLMPlanner(registry)` and calls `.plan()` directly
([scripts/eval-planner.ts:159-160](../scripts/eval-planner.ts)) — it never touches
`FinnorOrchestrator.handleInstruction()`. Phase 7's own acceptance test is "re-run
`scripts/eval-planner.ts`, report the real before/after delta." **If the repair pass
is wired only into `FinnorOrchestrator.handleInstruction()`, the eval harness will
never exercise it and the reported delta will be zero by construction** — not because
the repair pass doesn't work, but because the measurement tool can't see it. The
repair pass (and, by the same logic, Phase 8's tiering) must live *inside*
`LLMPlanner.plan()` itself.

**2. Never hold a `withTenant()` transaction open across an LLM call.** `withTenant()`
([packages/db/index.ts:66-84](../packages/db/index.ts)) checks out one pooled
connection and holds it via `BEGIN...COMMIT` for the duration of the callback.
Production's pool caps at `max: 2` under SSL. A real incident (documented in project
memory, commit `81d613e`) shows exactly how two stuck connections silently wedge the
*entire* queue with zero error logged anywhere. `planner.ts` today does all its DB work
(policy lookup, entity grounding, insert) inside one transaction — safe today because
nothing inside it makes a network call to a third party. Every new LLM call this plan
adds (repair confirmation, second-candidate generation) **must run before that
transaction opens**, never inside it.

**3. `action_log` rows require a real `domain_action_id`.** The column is `NOT NULL`
with a FK to `domain_actions.id` ([packages/db/schema.ts:165](../packages/db/schema.ts)).
Nothing can be logged about a draft before its row exists. Consequence: any decision
that changes *what* gets inserted (a repair, a tier classification) must be computed
in-memory before the `INSERT ... RETURNING`, and the audit-trail entry documenting
that decision is a *second* step written immediately after, once `row.id` is real —
exactly the two-phase shape `critic-review.ts` already uses (write the row, react to
it later), just compressed into the same function call instead of a separate job.

**4. `MemorySnapshot.longTerm` is computed but silently never used.**
`buildMemorySnapshot()` ([packages/memory/src/index.ts](../packages/memory/src/index.ts))
fetches `longTerm` (household memory), but `planner.ts`'s `user` JSON
([packages/orchestration/src/planner.ts:73-80](../packages/orchestration/src/planner.ts))
only serializes `shortTerm`, `semantic`, and `recentEpisodes` — `longTerm` is dropped
on the floor. This is a pre-existing gap, out of scope to fix here, but it is *exactly*
the mistake Phase 9 must not repeat: adding a field to `MemorySnapshot` does not mean
the planner uses it. Phase 9's plan below includes an explicit test that asserts the
new field actually appears in the string sent to the LLM, not just in the type.

**5. `proposals.status` and `quotes.status` are not mirrored 1:1.**
`applySignatureOutcome()` ([packages/domain-plugins/proposal-signature/index.ts:138-150](../packages/domain-plugins/proposal-signature/index.ts))
sets `quotes.status` to the full `accepted | declined | expired` enum, but only ever
mirrors `proposals.status` to `"accepted"` — never to `"declined"` or `"expired"`.
Any acceptance-rate query in Phase 9 must read `quotes.status` (or the `business_events`
rows the same function writes: `entityType: "quote"`,
`eventType: "quote_accepted" | "quote_declined" | "quote_expired"`), never
`proposals.status` alone, or it silently undercounts every rejection as "still open."

**6. `proposals` has no `tenant_id` column.** Confirmed in
[packages/db/schema.ts:91-99](../packages/db/schema.ts) — it only carries
`householdId`. Every existing query that needs to scope proposals by tenant joins
through `households` first (`read-models/index.ts`'s `pipelineHealth()` does exactly
this for `proposalsByStatus`). Phase 9's household-pattern query must follow the same
join, not filter on a column that doesn't exist.

**7. No timestamp anywhere captures "technician ETA vs. scheduled time."** The
roadmap's own Phase 9 example — "how often was this technician's ETA late" — doesn't
correspond to any column or event actually written today. `appointments` has
`scheduledAt` but no actual-arrival timestamp; `service_visits`/`work_orders` have
`completedAt`, which measures finish, not arrival. The nearest real, honestly-available
signal is `appointments.status = 'no_show'` per technician
([packages/db/schema.ts:406-424](../packages/db/schema.ts)). Phase 9 below builds
**no-show rate**, not a fabricated lateness metric — the same "never invent
completeness" standard the roadmap holds the codebase to applies to this plan too.

---

## PHASE 7 — Self-Critique & Repair Before the Gate

### What actually has to happen, precisely

The repair pass is a new pipeline stage inside `LLMPlanner.plan()`
([packages/orchestration/src/planner.ts](../packages/orchestration/src/planner.ts)),
sitting between "LLM returns a raw plan" and "grounded/compiled/inserted as a
`domain_actions` row." It is not a new job, not async, not a separate service — it is
a few more lines inside the same method that already does grounding and compiling,
because (per finding #1) that's the only place `scripts/eval-planner.ts` can see it.

### Step 0 — mandatory, before writing any code

```bash
cd finnor-os
npx tsx scripts/eval-planner.ts
```

Record every `fail`/`error` scenario name and detail verbatim, in a table, before
touching `repair.ts`. For each failure, classify it as either:

- **(a) a real planner ambiguity** — a plausible-but-wrong `action_type`/payload a
  repair pass could reasonably catch, or
- **(b) not real** — a rate-limit/network error, or a scenario whose expectation is
  itself questionable.

Only (a) items get a named checklist rule below. Do not assume the roadmap's
description ("5 real ambiguities") is still accurate — `planner.ts`/`compiler.ts` have
both changed since that number was recorded (Phase 6's grounded-payload/compiled-graph
columns didn't exist yet), so the actual current failure set may differ. Trust this
fresh run's output, not the roadmap text's number.

**High-confidence hypotheses to verify against the fresh run** (found by cross-referencing
the roadmap's two named examples against the actual scenario list in
[scripts/eval-planner.ts](../scripts/eval-planner.ts) — confirm, don't assume):

| Scenario name | Instruction | Suspected collision |
|---|---|---|
| `quotation: send_proposal` | "Send the proposal to the Petersons for their quote." | `answer_business_question` (roadmap's own named example) |
| `workflow: start_water_test_workflow` | "Book and confirm a water test appointment for Marcus Webb this Thursday." | `schedule_water_test` |
| `workflow: start_invoice_to_cash_workflow` | "Get the Hendersons' invoice paid — send them a payment link." | `create_invoice` or `send_payment_reminder` |

### New file: `packages/orchestration/src/repair.ts`

```ts
import { z } from "zod";
import { type LLMProvider, resolveProvider } from "./llm";
import { redactStructured, redactText } from "@finnor/security";

export interface RepairCandidate {
  actionType: string;
  payload: Record<string, unknown>;
}

export interface RepairInput {
  instruction: string;
  candidate: RepairCandidate;
  reasoning?: string;
  allowedActionTypes: string[];
  payloadSpec: string; // plugins.payloadSpecJson() — same string planner.ts's system prompt uses
}

export interface RepairVerdict {
  repaired: boolean;
  actionType: string;   // == candidate.actionType when repaired === false
  payload: Record<string, unknown>;
  reason: string;
  deterministicFlags: string[]; // ids of checklist rules that fired, [] if none
}

interface ChecklistRule {
  id: string;
  /** High confidence = mechanical enough to apply without an LLM call at all. */
  confidence: "high" | "low";
  applies: (input: RepairInput) => boolean;
  suggest: (input: RepairInput) => RepairCandidate;
}
```

**The checklist is a typed array, not prose** — each rule has an `id` so a repaired
action's `action_log` entry can say *which* rule fired, and so the before/after eval
report can attribute a fixed scenario to a specific rule instead of a vague "it got
better." Author the rules from Step 0's actual findings; the two below are the
concrete starting point the high-confidence hypotheses above imply — write them, then
add whatever else the fresh run surfaces:

```ts
const WORKFLOW_TO_SIMPLE: Record<string, string> = {
  // mirrors compiler.ts's WORKFLOW_ACTION_TYPES set — a workflow type's "simpler
  // single-step namesake" the planner sometimes picks instead
  start_water_test_workflow: "schedule_water_test",
  start_invoice_to_cash_workflow: "create_invoice",
  request_proposal_signature: "send_proposal",
  start_installation_workflow: "log_visit_report",
};
const OUTCOME_LANGUAGE = /\b(get (it|them|this) (paid|signed|booked|confirmed)|make sure|until|follow (it |them )?through)\b/i;

const rules: ChecklistRule[] = [
  {
    id: "workflow-vs-single-step",
    confidence: "low", // language-pattern match — hint for the LLM call, not auto-applied
    applies: (i) => Object.values(WORKFLOW_TO_SIMPLE).includes(i.candidate.actionType) && OUTCOME_LANGUAGE.test(i.instruction),
    suggest: (i) => {
      const workflowType = Object.entries(WORKFLOW_TO_SIMPLE).find(([, simple]) => simple === i.candidate.actionType)![0];
      return { actionType: workflowType, payload: i.candidate.payload };
    },
  },
  {
    id: "generic-fallback-has-specific-signal",
    confidence: "low",
    applies: (i) => i.candidate.actionType === "answer_business_question" && /\b(proposal|quote|send)\b/i.test(i.instruction),
    suggest: (i) => ({ actionType: "send_proposal", payload: i.candidate.payload }),
  },
];
```

Both starting rules are `confidence: "low"` deliberately — natural-language pattern
matching is exactly the kind of brittle heuristic this codebase avoids elsewhere
(`compiler.ts`'s own comment: "Deliberately small and explicit... rather than being
guessed at"). Low-confidence rules become *hints* fed into the LLM confirmation call,
not silent auto-corrections. Reserve `confidence: "high"` for a rule you can prove is
structurally unambiguous (e.g., "payload has a well-formed `proposalId` field but
`action_type` isn't `send_proposal`, and `send_proposal` is the only registered action
type whose schema even has a `proposalId` field") — if Step 0's fresh run doesn't
surface anything that clean, it's fine to ship Phase 7 with zero high-confidence rules
and let the LLM call carry all of it.

```ts
export function runChecklist(input: RepairInput): { flags: string[]; highConfidenceSuggestion: RepairCandidate | null } {
  const fired = rules.filter((r) => r.applies(input));
  const high = fired.find((r) => r.confidence === "high");
  return { flags: fired.map((r) => r.id), highConfidenceSuggestion: high ? high.suggest(input) : null };
}

const RepairResponseSchema = z.object({
  repaired: z.boolean(),
  actionType: z.string(),
  payload: z.record(z.unknown()),
  reason: z.string(),
});

export function repairLlmConfigured(): boolean {
  return Boolean(process.env.AWS_BEDROCK_API_KEY);
}

export async function repairAction(
  input: RepairInput,
  provider: LLMProvider = resolveProvider("bedrock-deepseek"),
): Promise<RepairVerdict> {
  const { flags, highConfidenceSuggestion } = runChecklist(input);

  if (highConfidenceSuggestion) {
    return { repaired: true, actionType: highConfidenceSuggestion.actionType, payload: highConfidenceSuggestion.payload, reason: `deterministic rule matched (${flags.join(", ")})`, deterministicFlags: flags };
  }

  if (!repairLlmConfigured()) {
    return { repaired: false, actionType: input.candidate.actionType, payload: input.candidate.payload, reason: "repair LLM not configured — deterministic checks only", deterministicFlags: flags };
  }

  const system = [
    "You are reviewing a domain action Finnor's planner just drafted, BEFORE a human ever sees it for approval. Nothing has executed yet.",
    "Confirm the draft as-is, or correct its action_type and/or payload ONLY if it clearly misreads the instruction — a wrong action entirely, or a workflow-vs-single-step mismatch.",
    `The ONLY valid action_type values are: ${input.allowedActionTypes.join(", ")}.`,
    `Required payload fields per action_type: ${input.payloadSpec}`,
    flags.length > 0 ? `A pattern check flagged this draft for possible confusion: ${flags.join(", ")}. Weigh this, but use your own judgment.` : "",
    'Respond with ONLY this JSON: {"repaired": boolean, "actionType": "...", "payload": {...}, "reason": "one short sentence"}. If repaired is false, actionType/payload must equal the original draft exactly.',
  ].filter(Boolean).join("\n");

  const user = JSON.stringify(redactStructured({
    instruction: redactText(input.instruction).value,
    draftedActionType: input.candidate.actionType,
    draftedPayload: input.candidate.payload,
    plannerReasoning: input.reasoning ?? null,
  }));

  let verdict: RepairVerdict;
  try {
    const raw = await provider.complete({ system, user, json: true });
    const parsed = RepairResponseSchema.parse(JSON.parse(raw));
    verdict = { ...parsed, deterministicFlags: flags };
  } catch (err) {
    return { repaired: false, actionType: input.candidate.actionType, payload: input.candidate.payload, reason: `repair LLM call failed or returned malformed JSON: ${(err as Error).message}`, deterministicFlags: flags };
  }

  if (!verdict.repaired) return { ...verdict, actionType: input.candidate.actionType, payload: input.candidate.payload };
  if (!input.allowedActionTypes.includes(verdict.actionType)) {
    return { repaired: false, actionType: input.candidate.actionType, payload: input.candidate.payload, reason: `repair proposed an unregistered action_type "${verdict.actionType}" — discarded`, deterministicFlags: flags };
  }
  return verdict; // payload validation against the target plugin happens in planner.ts, which has the registry
}
```

Note the last line: `repairAction()` does not import `PluginRegistry` (avoid a new
coupling) — the caller (`planner.ts`, which already has `this.plugins`) validates the
corrected payload against the target plugin's `validate()` and discards the correction
if it fails, falling back to the original. That check belongs one layer up.

### Modify `packages/orchestration/src/planner.ts`

Current structure (for reference — see the file for exact current lines): the LLM
call and `PlanSchema` parse happen first, then everything else (`restoredPayloads`,
policy lookup, grounding, `buildCommandGraph`, insert) happens inside one
`withTenant(...)` call.

Restructure `plan()`'s body after `const valid = parsed.actions.filter(...)` to:

1. Compute `restoredPayloads` exactly as today, but **before** opening the
   transaction (it's already pure — `restoreTokens` has no DB dependency — this is a
   trivial hoist, not a logic change).
2. **New:** `Promise.all` a `repairAction()` call per action (independent actions run
   concurrently, mirroring the existing per-action concurrency pattern used for
   grounding). Build each call's `RepairInput` from `this.plugins.actionTypes()` and
   `this.plugins.payloadSpecJson()` (same values the system prompt already uses).
3. **New:** for each repaired verdict where `repaired === true`, validate the
   corrected payload against the *target* plugin before accepting it:
   ```ts
   const targetPlugin = this.plugins.resolve(verdict.actionType);
   const validation = targetPlugin?.validate(verdict.actionType, verdict.payload, /* policy needed here — see note below */);
   const accepted = targetPlugin && validation?.valid;
   const finalActionType = accepted ? verdict.actionType : valid[i]!.action_type;
   const finalPayload = accepted ? verdict.payload : restoredPayloads[i]!;
   ```
   `validate()` takes a `DomainPolicy` third argument that in practice (per every
   plugin read) is unused or only read for `tenantId`/thresholds inside `draft()`, not
   `validate()` — check the specific target plugin's `validate()` before assuming it's
   safe to pass a throwaway/default policy object here; if any plugin's `validate()`
   genuinely needs real policy data, fetch that action_type's policy row inside the
   same lightweight pre-lookup described in Phase 8 below rather than duplicating a
   second query here.
4. Open `withTenant(...)` as today, but the policy lookup's `inArray(...)` set and
   every downstream `groundEntitiesWithDb`/`buildCommandGraph`/insert call reads
   `finalActionType`/`finalPayload` per action instead of `valid[i].action_type`/
   `restoredPayloads[i]`.
5. **After** `const rows = await db.insert(domainActions)...returning()`, still inside
   the same `withTenant` callback (or immediately after it returns — `appendEpisode`
   does not require an open tenant transaction; `critic-review.ts` calls it completely
   outside of any `withTenant` block), add one `appendEpisode` call per row:
   ```ts
   await appendEpisode(
     tenantContext.tenantId, row.id, "repair",
     { originalActionType: valid[i]!.action_type, originalPayload: restoredPayloads[i] },
     { repaired: verdict.repaired, actionType: finalActionType, payload: finalPayload, reason: verdict.reason, deterministicFlags: verdict.deterministicFlags },
   );
   ```
   **Log this unconditionally**, whether or not anything changed — `critic-review.ts`
   always writes its episode regardless of `flagged`; mirror that precedent exactly,
   both for auditability and because Phase 9/12's later work needs "how often did
   repair actually fire" as a real queryable signal, not just the times it changed
   something.
6. `reasoning` on the returned `DomainAction` stays the planner's own original
   narration — do not overwrite it with the repair reason. The repair's own reasoning
   lives only in the `"repair"` action_log episode. Keeping these separate matches
   finding #3's shape (draft narration vs. audit trail are different concerns) and
   avoids silently mutating a field other code may already assume is the LLM's literal
   first-pass explanation.

### Explicit edge cases

- **Multiple actions in one instruction** ("create an invoice... and schedule a water
  test..."): repair runs per-action, independently; a correction to action A must not
  touch action B's payload/grounding.
- **Repaired `action_type` not in the registry** (LLM hallucination): rejected inside
  `repairAction()` itself before it's even returned (see the function above) —
  `planner.ts` never has to handle this case.
- **Repaired payload fails the target plugin's `validate()`**: discard the correction,
  keep the original, and the `action_log` reason string should say exactly why (e.g.
  `"llm proposed send_proposal but payload failed validation: payload.proposalId: Required"`)
  — never silently keep a broken correction, never silently keep the original without
  recording that a correction was attempted and rejected.
- **`AWS_BEDROCK_API_KEY` unset** (local dev/CI without it): deterministic checks still
  run (no key needed); if none is high-confidence, `repairAction()` returns
  `{repaired:false, reason:"repair LLM not configured..."}` without attempting a
  network call — exactly `criticConfigured()`'s precedent, made explicit via
  `repairLlmConfigured()` rather than an implicit try/catch swallow, so it's directly
  testable.
- **`draftKnownAction()` (system-originated scans) must never call repair.** This is
  structurally guaranteed by construction — repair lives inside `LLMPlanner.plan()`,
  and `draftKnownAction()` never calls `plan()` — but write a regression test for it
  anyway (see below); a future refactor could easily break this invisibly.

### Test file: `tests/integration/planner-repair.test.ts`

Mirror [tests/integration/critic-review.test.ts](../tests/integration/critic-review.test.ts)'s
structure exactly: `describe.skipIf(!available)`, `vi.stubGlobal("fetch", ...)` to stub
`BedrockOpenAICompatProvider`'s HTTP call (it's a plain `fetch()` — confirmed by that
file's own header comment), `beforeEach` clearing `AWS_BEDROCK_API_KEY` +
`vi.unstubAllGlobals()`. Use tenant `00000000-0000-4000-8000-0000000000f9` (confirmed
unused — `f1`-`f8` are already claimed by other integration test files).

Required cases:
1. Repair leaves an unambiguous action untouched — mock fetch returns
   `{"repaired":false,...}` — assert the inserted row's `action_type` is unchanged and
   the `"repair"` episode logs `repaired:false`.
2. Repair corrects an `action_type`, and **the corrected type is what actually gets
   inserted and would execute downstream** — mock fetch returns a correction; assert
   the `domain_actions` row's `action_type` column (not just the in-memory return
   value) is the corrected one, and `groundedPayload`/`compiledGraph` reflect the
   *corrected* type, not the original (this is the test that would have caught getting
   the sequencing in finding #1/#3 wrong).
3. Repair discards a correction whose payload fails the target plugin's `validate()` —
   mock fetch returns a correction missing a required field; assert the original
   action_type/payload survives and the log reason names the validation failure.
4. Clean no-op when `AWS_BEDROCK_API_KEY` isn't set: no `fetch` stub installed at all;
   assert no network call was attempted (this is what proves the graceful-degradation
   path, not just that it returns *something*).
5. `draftKnownAction()` never produces a `"repair"` episode (regression guard for the
   edge case above).
6. At least one scenario from Step 0's actual failure table, run **against the real
   LLM** (not mocked — mirror `plan-compiler.test.ts`'s un-mocked style for this one
   case, budget real API latency), proving it now resolves correctly end-to-end. This
   is the direct evidence for the phase's required "at least one of the known failure
   patterns is now caught and repaired" claim.

### Verify

```bash
npx tsc --build --force
node --env-file=.env node_modules/.bin/vitest run   # from finnor-os/, run twice
npx tsx scripts/eval-planner.ts                       # after-baseline
```

Report as a table: scenario × before-status × after-status, plus the raw pass-count
delta (e.g. "31/41 → 36/41"). Call out explicitly if any scenario got *worse* — per
the roadmap's own instruction, do not omit or spin a regression.

### EXECUTION PROMPT (paste after the roadmap's SHARED CONTEXT block)

```
/goal Implement Phase 7 per finnor-os/docs/jarvis-99-phase-7-9-execution-plan.md's
"PHASE 7" section — follow it exactly, it already resolves the sequencing (repair must
live inside LLMPlanner.plan() itself, not the orchestrator, or scripts/eval-planner.ts
can never see it) and the transaction-vs-LLM-call ordering (never hold a withTenant
transaction open across the repair LLM call). Start with Step 0 exactly as written:
run scripts/eval-planner.ts fresh, record every failing scenario in a table, classify
each as a real ambiguity or not, before writing any code. Build
packages/orchestration/src/repair.ts and the planner.ts changes as specified. Write
tests/integration/planner-repair.test.ts mirroring critic-review.test.ts's structure,
tenant 00000000-0000-4000-8000-0000000000f9. Verify per the doc's Verify section and
report the real eval-planner.ts before/after delta as a table — never fabricate a
number.
```

---

## PHASE 8 — Risk-Tiered Reasoning Depth

Depends on Phase 7 existing (`repairAction`/`RepairVerdict` from `repair.ts`).

### Reasoning tier, precisely

```ts
// packages/shared-types/src/index.ts — add
export type ReasoningTier = "low" | "medium" | "high";
```

Tenant-configurable magnitude threshold lives inside the **existing**
`domainPolicies.policy` jsonb blob — no schema migration needed. New, documented
convention: `policy.policy.riskThresholds?.amountUsd` (optional number). Absent →
`DEFAULT_AMOUNT_USD_THRESHOLD = 500`. Label this default in a code comment as a
starting guess, not a researched number — same honesty norm as
`PLACEHOLDER_NEEDS_REAL_VALUE`, even though this constant doesn't hard-gate anything,
only tiers reasoning depth.

**Ground truth on what actually triggers the magnitude check:** a repo-wide search
shows exactly one plugin schema field named `amountUsd` in any LLM-drafted payload —
`accounting`'s `create_invoice`
([packages/domain-plugins/accounting/index.ts:23](../packages/domain-plugins/accounting/index.ts)).
Do not assume magnitude-tiering does more than it actually does today — it is a narrow
signal that currently only fires for invoice creation. **The `compiledGraph.kind ===
"workflow"` check is the primary lever** for "high stakes" in practice, since it covers
every vertical-workflow action type (proposal signature, installation, invoice-to-cash,
water-test) regardless of dollar amount. Both checks stay, but write the plan/tests
understanding which one actually does the heavy lifting.

New file: `packages/orchestration/src/tiering.ts` (sibling to `repair.ts` — separate
single-purpose module, matching how `compiler.ts` and `repair.ts` are already split):

```ts
import type { CommandGraph } from "./compiler";
import type { ReasoningTier } from "@finnor/shared-types";

export const DEFAULT_AMOUNT_USD_THRESHOLD = 500;

export function classifyReasoningTier(input: {
  requiresConfirmation: boolean;
  compiledGraph: CommandGraph;
  payload: Record<string, unknown>;
  amountThresholdUsd?: number;
}): ReasoningTier {
  if (!input.requiresConfirmation) return "low";
  const threshold = input.amountThresholdUsd ?? DEFAULT_AMOUNT_USD_THRESHOLD;
  const amount = typeof input.payload.amountUsd === "number" ? input.payload.amountUsd : null;
  if (input.compiledGraph.kind === "workflow" || (amount !== null && amount > threshold)) return "high";
  return "medium";
}

export interface CandidateScoreInputs {
  actionType: string;
  groundedPayload: Array<{ field: string; status: "verified" | "not_found" | "unverifiable" }>;
  /** Extension point for Phase 9 — default 0, Phase 9 wires a real value in later. */
  patternScore?: number;
}

export function scoreCandidate(input: CandidateScoreInputs): number {
  const verifiedBonus = input.groundedPayload.filter((g) => g.status === "verified").length;
  const notFoundPenalty = input.groundedPayload.filter((g) => g.status === "not_found").length * -2;
  const genericFallbackPenalty = input.actionType === "answer_business_question" ? -1 : 0;
  return verifiedBonus + notFoundPenalty + genericFallbackPenalty + (input.patternScore ?? 0);
}
```

### Sequencing inside `LLMPlanner.plan()` (extends Phase 7's restructure)

1. LLM call → `valid` actions; restore tokens (unchanged from Phase 7).
2. **New, short, LLM-free** `withTenant` call: select `{actionType, requiresConfirmation, policy}`
   from `domainPolicies` for the involved action types. This existed before as part of
   the one big transaction; hoisting just the `SELECT` out here (before any LLM call)
   is what finding #2 requires — nothing LLM-bound may share a transaction.
3. Per action: `buildCommandGraph(actionType, requiresConfirmation)` (pure, unchanged)
   → `classifyReasoningTier(...)`.
4. Branch per tier:
   - **low** — `finalCandidate = {actionType, payload}` unchanged, skip repair
     entirely, skip candidate B. This is the one path Phase 7 alone would have made
     slightly slower for every action; Phase 8 restores the original zero-overhead
     path for anything that doesn't require confirmation at all.
   - **medium** — `finalCandidate = repairAction(...)`'s result (Phase 7, unmodified).
   - **high** — generate a second candidate, score both, pick a winner, **then**
     repair-pass the winner (see below).
5. Ground (`groundEntitiesWithDb`) and insert using `finalCandidate` per action, inside
   the real transaction, exactly as Phase 7 left it.
6. Post-insert, append **both** episode types where applicable: Phase 7's `"repair"`
   episode (medium/high tiers only), and a new `"reasoning_tier"` episode
   (**always**, all tiers, for auditability):
   ```ts
   await appendEpisode(tenantId, row.id, "reasoning_tier", {},
     { tier, candidateBGenerated: tier === "high", scoreA: scoreA ?? null, scoreB: scoreB ?? null, winner: tier === "high" ? winnerLabel : "A" });
   ```

### High tier's second candidate, precisely

Call the **real planner-quality provider** (`resolveProvider("groq")` — i.e. the same
provider the first call used, deliberately *not* `bedrock-deepseek`), since this tier
exists specifically to spend more reasoning where stakes justify it — using the cheap
model here would defeat the point. Prompt: given the instruction and candidate A,
either confirm it or propose a meaningfully different alternative, responding in the
same shape as one entry of `PlanSchema`. Parse with the same defensive
malformed-JSON-safe-fallback pattern the first call already uses (`parsed = {actions: []}`
equivalent for a single-candidate response — on any failure, candidate B simply does
not exist and scoring trivially picks A).

**Scoring requires grounding both candidates**, which means calling
`groundEntitiesWithDb` twice for high-tier actions: once (in a short, dedicated,
non-final `withTenant` call, no LLM in flight) to score A vs. B and pick a winner, and
again for the winner inside the real insert transaction in step 5 above. This is a
deliberate, acceptable duplication — high-tier actions are rare by design (that's the
entire point of tiering), and threading cached grounding results across the
repair-pass's potential payload mutation would add real complexity for a case that by
construction almost never fires. Do not try to optimize this away now; if high-tier
volume ever becomes large enough for the double query to matter, that's a
measure-first, optimize-second problem for a later phase, not a speculative one to
solve here.

After scoring, run the winner through **Phase 7's `repairAction()`** exactly as the
medium tier does — "THEN repair-pass it," per the roadmap. Never skip repair for a
high-tier action just because it already went through a second-candidate check; those
are two different failure modes (wrong pick vs. right pick, wrong payload detail).

### Non-goals, reinforced

Never more than 2 candidates. Never let low/medium tier get slower except by the
single Phase-7 repair call medium tier already pays for. `scoreCandidate`'s
`patternScore` parameter exists now and defaults to 0 — do not attempt to fill it in
this phase; Phase 9 wires a real value in as its own explicit follow-up edit (see
Phase 9 below), keeping the two phases' responsibilities visibly separate rather than
Phase 9 silently mutating Phase 8's scorer body.

### Test file: `tests/integration/reasoning-tier.test.ts`

Tenant `00000000-0000-4000-8000-0000000000fa`. Cases:
1. An action with `requiresConfirmation: false` takes the low path — no `"repair"`
   episode, `"reasoning_tier"` episode logs `tier: "low"`, `candidateBGenerated: false`.
2. A `create_invoice` for `$50` (below the default $500 threshold,
   `requiresConfirmation: true`) is **medium** — repair runs, no candidate B.
3. A `create_invoice` for `$5,000` (above threshold) is **high** — candidate B
   generated (mock the second LLM call), both scored, winner logged.
4. A workflow-tagged action type (e.g. `start_invoice_to_cash_workflow`) is **high**
   regardless of amount — the `compiledGraph.kind` trigger, independent of the
   `amountUsd` trigger.
5. A tenant with `domain_policies.policy.riskThresholds.amountUsd = 100` set
   overrides the default — a $150 invoice for *that* tenant is high tier even though
   it would be medium under the default.

### Verify

Same 3-command bar as Phase 7, plus this suite.

### EXECUTION PROMPT

```
/goal Implement Phase 8 per finnor-os/docs/jarvis-99-phase-7-9-execution-plan.md's
"PHASE 8" section. This depends on Phase 7's repair.ts already existing — read it
first. Build packages/orchestration/src/tiering.ts exactly as specified
(classifyReasoningTier, scoreCandidate with its patternScore extension point left at
default 0 — Phase 9 fills that in later, do not attempt it now). Restructure
planner.ts's plan() per the doc's sequencing: policy lookup hoisted into its own
short pre-transaction query, tier branch (low/medium/high), high tier's second
candidate uses resolveProvider("groq") NOT the cheap deepseek model, THEN repair-passes
the winner. Never hold a withTenant transaction open across any LLM call — this is the
single most important constraint in the whole phase. Write
tests/integration/reasoning-tier.test.ts, tenant 00000000-0000-4000-8000-0000000000fa,
covering all 5 cases in the doc. Verify per the doc's Verify section.
```

---

## PHASE 9 — Retrieval-Based Pattern Context

Depends on Phase 7 (for the wiring precedent) and Phase 8 (for the `patternScore`
extension point it fills in). Ships for exactly 2-3 action types, per the roadmap's
own explicit scope limit: `send_proposal`/`generate_quote` (household proposal
history) and `assign_technician_to_visit` (technician reliability).

### New types — placement matters

`shared-types` is the dependency floor everything else builds on (`memory` imports
`shared-types`, never the reverse). Define `PatternContext` **in `shared-types`**, the
same layer `MemorySnapshot` itself already lives in — the function that *builds* it
lives in `@finnor/memory`, exactly mirroring how `buildMemorySnapshot()` (the
function) lives in `memory` while `MemorySnapshot` (the type) lives in `shared-types`.
Defining `PatternContext` inside `packages/memory` instead and trying to reference it
from `shared-types` would create a package cycle — don't.

```ts
// packages/shared-types/src/index.ts — add
export interface HouseholdProposalPattern {
  totalSent: number;
  accepted: number;
  declined: number;
  expired: number;
  avgAcceptedTotalUsd: number | null;
}
export interface TechnicianReliabilityPattern {
  technicianId: string;
  name: string;
  totalAppointments: number;
  noShowCount: number;
  noShowRate: number;
}
export interface PatternContext {
  householdProposals: HouseholdProposalPattern | null; // null only when no householdId was supplied
  technicianReliability: TechnicianReliabilityPattern[]; // tenant-wide, [] if no data yet
}

// extend the existing MemorySnapshot — ADD a field, do not touch the other four
export interface MemorySnapshot {
  shortTerm: Record<string, unknown> | null;
  longTerm: Record<string, unknown> | null;
  semantic: Array<{ chunk: string; sourceDocId: string | null; similarity: number }>;
  episodic: Array<Record<string, unknown>>;
  patterns: PatternContext | null;
}
```

### New file: `packages/memory/src/patterns.ts`

Sibling to `short-term.ts`/`long-term.ts`/`semantic.ts`/`episodic.ts`/`consolidated.ts`;
re-export it from `index.ts` the exact same way the other four already are
(`export * from "./patterns"`).

**Household proposal pattern** — must join through `households` (finding #6: `proposals`
has no `tenant_id`), and must read `quotes.status`/the `business_events` outcome rows,
not `proposals.status` alone (finding #5):

```ts
import { withTenant, proposals, quotes, households, businessEvents, technicians, appointments, type Db } from "@finnor/db";
import { and, eq, inArray, isNotNull } from "drizzle-orm";
import type { PatternContext, HouseholdProposalPattern, TechnicianReliabilityPattern } from "@finnor/shared-types";

async function householdProposalPattern(db: Db, tenantId: string, householdId: string): Promise<HouseholdProposalPattern> {
  const rows = await db
    .select({ proposalId: proposals.id, quoteId: proposals.quoteId, totalUsd: quotes.totalUsd })
    .from(proposals)
    .innerJoin(households, eq(households.id, proposals.householdId))
    .leftJoin(quotes, eq(quotes.id, proposals.quoteId))
    .where(and(eq(households.tenantId, tenantId), eq(proposals.householdId, householdId)));

  const quoteIds = rows.map((r) => r.quoteId).filter((id): id is string => id !== null);
  const outcomes = quoteIds.length === 0 ? [] : await db
    .select({ entityId: businessEvents.entityId, eventType: businessEvents.eventType })
    .from(businessEvents)
    .where(and(
      eq(businessEvents.tenantId, tenantId),
      eq(businessEvents.entityType, "quote"),
      inArray(businessEvents.entityId, quoteIds),
      inArray(businessEvents.eventType, ["quote_accepted", "quote_declined", "quote_expired"]),
    ));
  const outcomeByQuoteId = new Map(outcomes.map((o) => [o.entityId, o.eventType]));

  let accepted = 0, declined = 0, expired = 0;
  const acceptedTotals: number[] = [];
  for (const r of rows) {
    const outcome = r.quoteId ? outcomeByQuoteId.get(r.quoteId) : undefined;
    if (outcome === "quote_accepted") { accepted++; if (r.totalUsd !== null) acceptedTotals.push(Number(r.totalUsd)); }
    else if (outcome === "quote_declined") declined++;
    else if (outcome === "quote_expired") expired++;
  }
  return {
    totalSent: rows.length, accepted, declined, expired,
    avgAcceptedTotalUsd: acceptedTotals.length > 0 ? acceptedTotals.reduce((s, n) => s + n, 0) / acceptedTotals.length : null,
  };
}

async function technicianReliabilityPattern(db: Db, tenantId: string): Promise<TechnicianReliabilityPattern[]> {
  const rows = await db
    .select({ technicianId: appointments.technicianId, status: appointments.status, name: technicians.name })
    .from(appointments)
    .innerJoin(technicians, eq(technicians.id, appointments.technicianId))
    .where(and(eq(appointments.tenantId, tenantId), isNotNull(appointments.technicianId)));

  const byTech = new Map<string, { name: string; total: number; noShow: number }>();
  for (const r of rows) {
    const key = r.technicianId!;
    const bucket = byTech.get(key) ?? { name: r.name, total: 0, noShow: 0 };
    bucket.total++;
    if (r.status === "no_show") bucket.noShow++;
    byTech.set(key, bucket);
  }
  return [...byTech.entries()].map(([technicianId, b]) => ({
    technicianId, name: b.name, totalAppointments: b.total, noShowCount: b.noShow,
    noShowRate: b.total > 0 ? b.noShow / b.total : 0,
  }));
}

export async function buildPatternContext(tenantId: string, householdId?: string): Promise<PatternContext> {
  return withTenant(tenantId, async (db) => ({
    householdProposals: householdId ? await householdProposalPattern(db, tenantId, householdId) : null,
    technicianReliability: await technicianReliabilityPattern(db, tenantId),
  }));
}
```

Note `technicianReliability` is **tenant-wide**, not household-scoped — technician
performance isn't a household fact, and computing it tenant-wide sidesteps a real
chicken-and-egg problem: `buildMemorySnapshot()` runs *before* planning, so the
specific technician a not-yet-drafted `assign_technician_to_visit` action will
reference isn't known yet. A small, bounded, tenant-wide list handed to the LLM (same
shape as `shortTerm`/`episodic` — context for it to use its own judgment on) avoids
needing to predict the future action_type at all.

### Wire into `buildMemorySnapshot()` (`packages/memory/src/index.ts`)

```ts
const [shortTerm, longTerm, pgvectorHits, zepHits, episodic, patterns] = await Promise.all([
  sessionId ? readShortTerm(...).catch(() => null) : Promise.resolve(null),
  householdId ? readHouseholdMemory(...).catch(() => null) : Promise.resolve(null),
  semanticQuery ? querySemantic(...).catch(() => []) : Promise.resolve([]),
  semanticQuery ? queryConsolidatedFacts(...) : Promise.resolve([]),
  readEpisodes(...).catch(() => []),
  buildPatternContext(tenantId, householdId).catch(() => ({ householdProposals: null, technicianReliability: [] })),
]);
return { shortTerm, longTerm: longTerm as Record<string, unknown> | null, semantic: [...pgvectorHits, ...zepHits], episodic, patterns };
```

Same `.catch(() => ...)` graceful-degradation convention every other memory source in
this function already follows — a pattern-query failure must never break planning.

### The step finding #4 exists to prevent: actually use it in the prompt

Modify `packages/orchestration/src/planner.ts`'s `user` JSON construction — this is
not optional, it is the entire point of the phase:

```ts
const user = JSON.stringify({
  instruction: redactedInstruction.value,
  memory: {
    shortTerm: redactStructured(memory.shortTerm),
    semantic: memory.semantic.map((s) => redactText(s.chunk).value).slice(0, 5),
    recentEpisodes: redactStructured(memory.episodic.slice(0, 5)),
    patterns: memory.patterns, // Phase 9 — ids/counts/rates only, no free text, safe to skip redaction
  },
});
```

And add to the system prompt, next to the existing `memory.shortTerm.turns` explanation:

```
"memory.patterns.householdProposals (if present) summarizes this household's own past proposal/quote outcomes — use it only as soft context, never as a source of new facts to invent into a payload.",
"memory.patterns.technicianReliability lists each technician's appointment no-show rate tenant-wide — if the instruction doesn't name a technician for an assignment action, this may inform picking one; if it does name one, respect the instruction and don't override it.",
```

Call this "retrieval" or "pattern context" in every comment, every log line, every bit
of user-facing text — never "learning," per the roadmap's own explicit instruction and
`docs/multi-agent.md`'s existing honesty standard for this exact kind of claim.

### The Phase 8 wiring — patternScore, filled in

`scoreCandidate()`'s `patternScore` parameter ([Phase 8](#new-file-packagesorchestrationsrctieringts))
was left at a hardcoded default of 0. Phase 9's actual follow-up edit — to
`tiering.ts`'s **call site** in `planner.ts`, not to `scoreCandidate` itself — is: when
scoring a high-tier candidate whose `actionType === "assign_technician_to_visit"` and
whose payload has a resolved `technicianId`, look that id up in
`memory.patterns.technicianReliability` and pass
`patternScore: -matchingTech.noShowRate * 2` (a small penalty proportional to
unreliability; absent a match, `patternScore` stays `undefined`/0). This is what makes
Phase 9's data actually feed back into a real decision instead of sitting inert — name
this explicitly as a Phase 9 deliverable, not an afterthought, since "ship pattern data
nothing reads" would fail the roadmap's own "prove it moves the needle" bar.

### Non-goals, reinforced

No "similar households" — that requires a similarity metric the roadmap doesn't
specify, and building one would tempt exactly the vector-embedding "learned behavior"
path Phase 9's own Non-goals section rules out. No fine-tuning. No claiming this is
learning anywhere. Ship only the 2-3 named action types; do not expand to all ~40
before this round even ships (per the roadmap's own "prove it moves the needle first"
instruction).

### Test file: `tests/integration/pattern-context.test.ts`

Tenant `00000000-0000-4000-8000-0000000000fb`. Cases:
1. Seed a household with 3 proposals/quotes: 2 accepted (known `totalUsd` each), 1
   declined. Assert `buildPatternContext` returns
   `{totalSent:3, accepted:2, declined:1, expired:0, avgAcceptedTotalUsd: <correct mean>}`.
2. Seed a technician with 5 appointments, 1 `no_show`. Assert `noShowRate === 0.2`.
3. `buildMemorySnapshot()` with no `householdId` returns `patterns.householdProposals: null`
   (not a crash, not an empty-but-wrong object) and still populates
   `technicianReliability` (tenant-wide, doesn't need a household).
4. **The most important test in this phase**, guarding directly against finding #4:
   construct an `LLMPlanner` with a stubbed provider that captures its `complete()`
   call's `user` argument; assert the literal substring `"patterns"` (and a seeded
   household's real accepted-count) appears in that string. A type-level addition to
   `MemorySnapshot` with no assertion like this proves nothing — this is what actually
   proves the planner sees it.

### Verify

Same 3-command bar. No numeric "improvement" claim is expected here (retrieval, not a
scored capability like Phase 7's eval delta) — the deliverable is "the pattern
genuinely reaches the prompt for the 2-3 shipped action types," proven by test 4 above
against real seeded data.

### EXECUTION PROMPT

```
/goal Implement Phase 9 per finnor-os/docs/jarvis-99-phase-7-9-execution-plan.md's
"PHASE 9" section. Depends on Phase 7 (wiring precedent) and Phase 8
(tiering.ts's scoreCandidate patternScore hook) already existing — read both first.
Define PatternContext in packages/shared-types (NOT packages/memory — that would
create a package cycle). Build packages/memory/src/patterns.ts exactly as specified,
paying attention to the two schema gotchas the doc calls out: proposals has no
tenant_id column (must join through households), and proposals.status never gets set
to declined/expired (must read quotes.status / the quote_accepted|declined|expired
business_events rows instead). Wire buildPatternContext into buildMemorySnapshot AND
into planner.ts's actual outgoing prompt (system prompt text + the `user` JSON's
memory.patterns field) — a type addition alone does nothing, prove it lands in the
prompt with the exact test the doc specifies (stub the provider, assert "patterns"
appears in the captured `user` string). Then do the Phase 8 follow-up: wire
technicianReliability into tiering.ts's scoreCandidate call site in planner.ts via the
patternScore parameter for assign_technician_to_visit candidates. Call this "pattern
context" or "retrieval" everywhere, never "learning." Write
tests/integration/pattern-context.test.ts, tenant
00000000-0000-4000-8000-0000000000fb, covering all 4 cases. Verify per the doc's
Verify section.
```

---

## Cross-phase file manifest

| File | Phase 7 | Phase 8 | Phase 9 |
|---|---|---|---|
| `packages/orchestration/src/repair.ts` | **new** | — | — |
| `packages/orchestration/src/tiering.ts` | — | **new** | edit (call site only, in planner.ts, not this file) |
| `packages/orchestration/src/planner.ts` | edit (restructure `plan()`) | edit (extend restructure) | edit (prompt + patternScore wiring) |
| `packages/shared-types/src/index.ts` | — | edit (`ReasoningTier`) | edit (`PatternContext`, `MemorySnapshot.patterns`) |
| `packages/memory/src/patterns.ts` | — | — | **new** |
| `packages/memory/src/index.ts` | — | — | edit (`buildMemorySnapshot`) |
| `tests/integration/planner-repair.test.ts` | **new** | — | — |
| `tests/integration/reasoning-tier.test.ts` | — | **new** | — |
| `tests/integration/pattern-context.test.ts` | — | — | **new** |

No schema migrations in any of the three phases — every new signal (repair audit
trail, reasoning tier, pattern context) rides on existing tables (`action_log`,
`domain_policies.policy` jsonb, `business_events`, `appointments`). That is itself
worth verifying at the end of Phase 9: run `git status` on `packages/db/migrations/`
and confirm nothing new landed there unless a real, justified need appeared that this
plan didn't anticipate — if one did, say explicitly what forced it before adding it.

## Suggested build order

Strictly sequential — 8 reuses 7's `repair.ts`, 9 reuses 8's `tiering.ts` extension
point and reinforces 7's wiring lesson. Do not parallelize across phases even though
they touch mostly-disjoint files; the *shape* of Phase 8's `planner.ts` restructure
depends on Phase 7's already being in place, and getting the order backwards means
redoing the restructure twice.

1. Phase 7 end-to-end (code → tests → both verify passes → real eval-planner.ts delta
   reported) before starting Phase 8.
2. Phase 8 end-to-end before starting Phase 9.
3. Phase 9 last — it is the only one of the three with a hard dependency on both
   priors' extension points actually existing.
