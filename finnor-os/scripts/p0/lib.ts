import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

export const BASELINE_SHA = "8fcd8a1cebcf92791047777c0d9c70e95fc7aad2";
export const P0_BRANCH = "codex/p0-existing-substrate-freeze";
export const P0_RUNTIME_CORRECTION_PATHS = [
  "apps/worker/src/handlers/business-operation.ts",
  "packages/db/migration-head.ts",
  "packages/orchestration/src/index.ts",
  "packages/read-models/src/work-cases.ts",
] as const;

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
