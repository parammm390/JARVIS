// B2.T8: opt-in planner memory. Keep this separate from memory retrieval itself so
// the prompt contract (and its token budget) remains explicit and unit-testable.

import type { MemorySnapshot } from "@finnor/shared-types";
import { redactText, redactStructured } from "@finnor/security";

const MAX_MEMORY_WORDS = 1500;

export function plannerMemoryEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.PLANNER_MEMORY === "1";
}

function withinWordBudget(text: string, remaining: number): { text: string; used: number } {
  const words = text.trim().split(/\s+/).filter(Boolean);
  const accepted = words.slice(0, Math.max(0, remaining));
  return { text: accepted.join(" "), used: accepted.length };
}

/** Exactly five semantic rows maximum; the combined redacted content is capped at
 * 1,500 whitespace tokens (a conservative prompt-budget unit, not a fabricated
 * tokenizer claim). */
export function plannerMemoryContext(memory: MemorySnapshot, enabled = plannerMemoryEnabled()): Record<string, unknown> {
  if (!enabled) return {};
  let remaining = MAX_MEMORY_WORDS;
  const semantic: string[] = [];
  for (const hit of memory.semantic.slice(0, 5)) {
    const redacted = redactText(hit.chunk).value;
    const bounded = withinWordBudget(redacted, remaining);
    if (bounded.used === 0) break;
    semantic.push(bounded.text);
    remaining -= bounded.used;
  }
  const longTerm = (memory.longTerm ?? {}) as Record<string, unknown>;
  return {
    canonicalSummary: redactStructured(longTerm.canonicalSummary ?? null),
    semantic,
  };
}
