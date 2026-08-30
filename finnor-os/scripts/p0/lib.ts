import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

/** The pre-reconciliation P0 baseline is retained for the final audit report. */
export const PREVIOUS_BASELINE_SHA = "8fcd8a1cebcf92791047777c0d9c70e95fc7aad2";
/** P0 certification must compare only the reconciled branch to current main. */
export const BASELINE_SHA = "9b9798acb764752d68bf10b97b8f0921b7f0163a";
export const P0_BRANCH = "codex/p0-existing-substrate-freeze";
/** Current main already contains every runtime correction identified by the previous P0.
 * The reconciled branch therefore adds no production runtime file. */
export const P0_RUNTIME_CORRECTION_PATHS = [] as const;

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
