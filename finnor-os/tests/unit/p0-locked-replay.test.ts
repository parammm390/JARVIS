import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const REQUIRED_CASES = [
  "canonical_queries", "conversation", "single_consequential_action", "objectives", "approval", "rejection", "wait_resume", "provider_execution",
  "provider_failure", "unknown_external_outcome", "reconciliation", "compensation", "computer_read", "computer_write", "ambiguous_entity",
  "cross_tenant_forged_reference", "stale_precondition", "authority_change", "duplicate_callback_job", "worker_restart", "terminal_failure",
  "realtime_ui_reconstruction", "receipt", "causal_replay",
];

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value as Record<string, unknown>).sort(([left], [right]) => left.localeCompare(right)).map(([key, child]) => [key, canonicalize(child)]));
  return value;
}

describe("P0 locked deterministic replay corpus", () => {
  it("locks every required semantic category to an existing non-live test selector and exact corpus hash", async () => {
    const root = resolve(import.meta.dirname, "../..");
    const path = resolve(root, "architecture/p0/replay-corpus.json");
    const manifest = JSON.parse(await readFile(path, "utf8")) as {
      determinism: { liveLlm: boolean; liveProviders: boolean; network: boolean };
      cases: Array<{ id: string; selectors: Array<{ file: string; title: string }> }>;
      corpusHash: string;
    };
    expect(manifest.determinism).toMatchObject({ liveLlm: false, liveProviders: false, network: false });
    expect(manifest.cases.map((entry) => entry.id).sort()).toEqual([...REQUIRED_CASES].sort());
    for (const entry of manifest.cases) {
      expect(entry.selectors.length).toBeGreaterThan(0);
      for (const selector of entry.selectors) {
        expect(selector.file).not.toContain("/live/");
        expect(await readFile(resolve(root, selector.file), "utf8")).toContain(selector.title);
      }
    }
    const { corpusHash: _lockedHash, ...body } = manifest;
    const hash = createHash("sha256").update(JSON.stringify(canonicalize(body))).digest("hex");
    expect(manifest.corpusHash).toBe(hash);
  });
});
