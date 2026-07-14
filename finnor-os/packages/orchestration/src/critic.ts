// Critic (§9 extension): an async, independently-prompted second pass over an
// LLM-planned action — the "verification layer" half of the multi-agent story (see
// docs/multi-agent.md for what this is and isn't). It runs AFTER the action is
// already gated and sitting in the confirmation queue, never before and never
// blocking: a synchronous pre-draft critic call would add a full LLM round trip to
// every voice instruction, directly undoing this project's voice-latency work. A
// gated action already pauses for a human regardless, so reviewing it during that
// wait costs zero added latency (see apps/worker/src/handlers/critic-review.ts).

import { z } from "zod";
import { type LLMProvider, resolveProvider } from "./llm";
import { redactStructured } from "@finnor/security";

export interface CriticInput {
  instruction: string;
  actionType: string;
  payload: Record<string, unknown>;
  summary: string;
  reasoning?: string | null;
}

export interface CriticVerdict {
  flagged: boolean;
  reason: string;
}

const CriticVerdictSchema = z.object({
  flagged: z.boolean(),
  reason: z.string(),
});

/** Same plug-and-play signal every other adapter in this codebase uses: nothing to
 *  do until a real key lands, never a hard failure in the meantime. */
export function criticConfigured(): boolean {
  return Boolean(process.env.AWS_BEDROCK_API_KEY);
}

const SYSTEM_PROMPT = [
  "You are a second, independent check on an action Finnor's planner already drafted — a human will still approve or reject it regardless of your verdict, so your job is narrow: catch clear misinterpretation, not second-guess reasonable judgment calls.",
  "You are given the dealer's original instruction, the action_type and payload the planner produced, and the planner's own stated reasoning.",
  "Flag ONLY when the drafted action clearly contradicts or misreads the instruction: the wrong action entirely, an amount/customer/date/detail the instruction never stated, or a fabricated fact not present in the instruction or reasoning.",
  "Do NOT flag: the action simply requiring human confirmation (that is normal, not a concern), a reasonable reading of ambiguous phrasing, or details that are legitimately absent from the instruction.",
  'Respond with ONLY this JSON, nothing else: {"flagged": boolean, "reason": "one short sentence explaining your verdict either way"}',
].join("\n");

export async function reviewAction(
  input: CriticInput,
  provider: LLMProvider = resolveProvider("bedrock-deepseek"),
): Promise<CriticVerdict> {
  let raw: string;
  try {
    raw = await provider.complete({ system: SYSTEM_PROMPT, user: JSON.stringify(redactStructured(input)), json: true });
  } catch (err) {
    throw new Error(`Critic LLM call failed: ${(err as Error).message}`);
  }
  try {
    return CriticVerdictSchema.parse(JSON.parse(raw));
  } catch {
    // Malformed response — never guess a verdict either way; the planner treats its
    // own unparseable JSON the same way (fall back to the safe, unclaimed default).
    return { flagged: false, reason: "Critic response could not be parsed — no verdict reached." };
  }
}
