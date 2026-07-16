// Self-critique & repair pass (Phase 7, docs/jarvis-99-phase-7-9-execution-plan.md).
// Runs INSIDE LLMPlanner.plan() itself — not the orchestrator, not a job — because
// scripts/eval-planner.ts calls LLMPlanner.plan() directly and would never see a
// repair pass wired anywhere else. Must never run while a withTenant() transaction is
// open: production's pool caps at max: 2, and a real incident (commit 81d613e) showed
// two stuck connections silently wedging the entire queue. Callers must invoke this
// before opening any transaction.

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
  actionType: string; // == candidate.actionType when repaired === false
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

// Every rule below is sourced from a real, confirmed scenario in a fresh
// `npx tsx scripts/eval-planner.ts` run (Step 0), not from the roadmap's older
// (now-stale) failure count. Confirmed real failures at the time this file was
// written:
//   1. "Send the proposal to the Petersons for their quote." -> send_proposal_to_recent_installs
//      (expected send_proposal) — a single-household instruction misread as the batch action.
//   2. "Text Linda Chen to confirm her appointment time." -> answer_business_question
//      (expected send_customer_message) — the generic fallback winning over a specific action.
//   3. "Give me a full overview of the business right now." -> answer_business_question
//      (expected get_business_overview) — same fallback collision, different action.
//   4. "Get the Hendersons' invoice paid — send them a payment link." -> send_payment_reminder /
//      answer_business_question (expected start_invoice_to_cash_workflow) — the
//      workflow-vs-single-step collision the roadmap itself names.
// Seven other scenarios errored on a Groq rate limit during Step 0 (infra, not a
// planner ambiguity) and are not represented here — see the phase report for the full
// classification table.

const WORKFLOW_TO_SIMPLE: Record<string, string> = {
  // mirrors compiler.ts's WORKFLOW_ACTION_TYPES set — a workflow type's "simpler
  // single-step namesake" the planner sometimes picks instead
  start_water_test_workflow: "schedule_water_test",
  start_invoice_to_cash_workflow: "create_invoice",
  request_proposal_signature: "send_proposal",
  start_installation_workflow: "log_visit_report",
};
const OUTCOME_LANGUAGE =
  /\b(get (it|them|this) (paid|signed|booked|confirmed)|make sure|until|follow (it |them )?through|send (them |him |her )?a payment link)\b/i;

const BATCH_LANGUAGE = /\b(everyone|every customer|all (of )?(our |the )?(customers|households)|last \d+ days|recent installs)\b/i;

const OVERVIEW_LANGUAGE = /\b(full (overview|picture)|business (overview|snapshot)|how('?s| is)? (the )?business)\b/i;
const CUSTOMER_MESSAGE_LANGUAGE = /\b(text|message|confirm (her|his|their)? ?appointment)\b/i;

const rules: ChecklistRule[] = [
  {
    // Confirmed real failure #4 (see header note): workflow-shaped instructions
    // ("get it paid", "follow through") sometimes collapse to the single-step
    // namesake or the generic fallback instead of the workflow action_type.
    id: "workflow-vs-single-step",
    confidence: "low", // language-pattern match — hint for the LLM call, not auto-applied
    applies: (i) =>
      (Object.values(WORKFLOW_TO_SIMPLE).includes(i.candidate.actionType) || i.candidate.actionType === "answer_business_question") &&
      OUTCOME_LANGUAGE.test(i.instruction),
    suggest: (i) => {
      const workflowType =
        Object.entries(WORKFLOW_TO_SIMPLE).find(([, simple]) => simple === i.candidate.actionType)?.[0] ??
        "start_invoice_to_cash_workflow";
      return { actionType: workflowType, payload: i.candidate.payload };
    },
  },
  {
    // Confirmed real failure #1: a single-household "send the proposal" instruction
    // misread as the batch action_type.
    id: "single-household-not-batch",
    confidence: "low",
    applies: (i) => i.candidate.actionType === "send_proposal_to_recent_installs" && !BATCH_LANGUAGE.test(i.instruction),
    suggest: (i) => ({ actionType: "send_proposal", payload: i.candidate.payload }),
  },
  {
    // Confirmed real failures #2 and #3: the generic answer_business_question
    // fallback winning over a specific, better-matching action_type.
    id: "generic-fallback-has-specific-signal",
    confidence: "low",
    applies: (i) =>
      i.candidate.actionType === "answer_business_question" &&
      (/\b(proposal|quote|send)\b/i.test(i.instruction) ||
        CUSTOMER_MESSAGE_LANGUAGE.test(i.instruction) ||
        OVERVIEW_LANGUAGE.test(i.instruction)),
    suggest: (i) => {
      if (OVERVIEW_LANGUAGE.test(i.instruction)) return { actionType: "get_business_overview", payload: i.candidate.payload };
      if (CUSTOMER_MESSAGE_LANGUAGE.test(i.instruction)) return { actionType: "send_customer_message", payload: i.candidate.payload };
      return { actionType: "send_proposal", payload: i.candidate.payload };
    },
  },
];

// Natural-language pattern matching is exactly the kind of brittle heuristic this
// codebase avoids elsewhere (compiler.ts's own comment: "Deliberately small and
// explicit... rather than being guessed at"). All three rules above stay
// confidence: "low" deliberately — hints fed into the LLM confirmation call, never
// silent auto-corrections. None of Step 0's confirmed failures was clean enough to
// justify a "high" confidence auto-apply rule (each depends on reading intent, not a
// structurally unambiguous payload shape), so this phase ships with zero
// high-confidence rules and lets the LLM call carry all of it — exactly the outcome
// the roadmap's own guidance says is fine.

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

/** Same plug-and-play signal every other adapter in this codebase uses (see
 *  critic.ts's criticConfigured()): nothing to do until a real key lands, never a
 *  hard failure in the meantime. */
export function repairLlmConfigured(): boolean {
  return Boolean(process.env.AWS_BEDROCK_API_KEY);
}

export async function repairAction(
  input: RepairInput,
  provider: LLMProvider = resolveProvider("bedrock-deepseek"),
): Promise<RepairVerdict> {
  const { flags, highConfidenceSuggestion } = runChecklist(input);

  if (highConfidenceSuggestion) {
    return {
      repaired: true,
      actionType: highConfidenceSuggestion.actionType,
      payload: highConfidenceSuggestion.payload,
      reason: `deterministic rule matched (${flags.join(", ")})`,
      deterministicFlags: flags,
    };
  }

  if (!repairLlmConfigured()) {
    return {
      repaired: false,
      actionType: input.candidate.actionType,
      payload: input.candidate.payload,
      reason: "repair LLM not configured — deterministic checks only",
      deterministicFlags: flags,
    };
  }

  const system = [
    "You are reviewing a domain action Finnor's planner just drafted, BEFORE a human ever sees it for approval. Nothing has executed yet.",
    "Confirm the draft as-is, or correct its action_type and/or payload ONLY if it clearly misreads the instruction — a wrong action entirely, or a workflow-vs-single-step mismatch.",
    `The ONLY valid action_type values are: ${input.allowedActionTypes.join(", ")}.`,
    `Required payload fields per action_type: ${input.payloadSpec}`,
    flags.length > 0
      ? `A pattern check flagged this draft for possible confusion: ${flags.join(", ")}. Weigh this, but use your own judgment.`
      : "",
    'Respond with ONLY this JSON: {"repaired": boolean, "actionType": "...", "payload": {...}, "reason": "one short sentence"}. If repaired is false, actionType/payload must equal the original draft exactly.',
  ]
    .filter(Boolean)
    .join("\n");

  const user = JSON.stringify(
    redactStructured({
      instruction: redactText(input.instruction).value,
      draftedActionType: input.candidate.actionType,
      draftedPayload: input.candidate.payload,
      plannerReasoning: input.reasoning ?? null,
    }),
  );

  let verdict: RepairVerdict;
  try {
    const raw = await provider.complete({ system, user, json: true });
    const parsed = RepairResponseSchema.parse(JSON.parse(raw));
    verdict = { ...parsed, deterministicFlags: flags };
  } catch (err) {
    return {
      repaired: false,
      actionType: input.candidate.actionType,
      payload: input.candidate.payload,
      reason: `repair LLM call failed or returned malformed JSON: ${(err as Error).message}`,
      deterministicFlags: flags,
    };
  }

  if (!verdict.repaired) {
    return { ...verdict, actionType: input.candidate.actionType, payload: input.candidate.payload };
  }
  if (!input.allowedActionTypes.includes(verdict.actionType)) {
    return {
      repaired: false,
      actionType: input.candidate.actionType,
      payload: input.candidate.payload,
      reason: `repair proposed an unregistered action_type "${verdict.actionType}" — discarded`,
      deterministicFlags: flags,
    };
  }
  return verdict; // payload validation against the target plugin happens in planner.ts, which has the registry
}
