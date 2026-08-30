import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

/** Current production integration base, resolved before P0 reconciliation
 * artifacts were added. The historical 8fcd8a1/f21cd6c audit remains recorded
 * separately; this certification is anchored to the Human Compiler substrate
 * that is actually being released. */
export const BASELINE_SHA = "d87a256e87d9a2f4308135dd8383848a6b137b85";
/** Immutable commit produced by the P0 reconciliation. Descendant phases certify
 * this exact diff instead of incorrectly folding their own files into P0. */
export const P0_CERTIFIED_SHA = "507a75a73ef3faf93f492098a4e473feee608c7a";
export const P0_BRANCH = "codex/three-phase-production-closure";
export const P0_RUNTIME_CORRECTION_PATHS: readonly string[] = [];

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, child]) => [key, canonicalize(child)]),
    );
  }
  return value;
}

export function deterministicHash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(canonicalize(value))).digest("hex");
}

export async function readJson<T>(path: string): Promise<T> {
  return JSON.parse(await readFile(path, "utf8")) as T;
}
