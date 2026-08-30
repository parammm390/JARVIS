import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildReferenceInventory } from "../p0/reference-inventory";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const baselineSha = process.env.FINNOR_CLOSURE_ANCHOR_SHA ?? "d8b69d08005f299d39aaa8638a0214b26bd787c7";
const branch = process.env.FINNOR_CERTIFICATION_BRANCH ?? "codex/p2-operational-effect-system-closure";
const outputPath = join(root, "architecture/p2/closure-reference-inventory.json");

// These are the only production owners intentionally changed after the exact
// remote-main snapshot: the certified P0 correction, current-main reconciliation,
// and the P1/P2 Operational IR shadow/effect modules. The inventory still reports
// every changed reference; this allowlist only labels those audited paths as
// reconciled rather than silently treating them as safe.
const reconciledProductionPaths = [
  "apps/worker/src/handlers/business-operation.ts",
  "packages/read-models/src/work-cases.ts",
  "packages/orchestration/src/index.ts",
  "packages/orchestration/src/operational-ir-shadow.ts",
  "packages/orchestration/src/operational-ir-effect-resolution.ts",
  "packages/orchestration/src/operational-ir-effect-shadow.ts",
  "packages/orchestration/src/operational-ir-shadow.test.ts",
  "packages/orchestration/src/operational-ir-effect-shadow.test.ts",
  "packages/operational-ir",
] as const;

async function main(): Promise<void> {
  const inventory = buildReferenceInventory({ baselineSha, branch, allowedProductionPaths: reconciledProductionPaths });
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(inventory, null, 2)}\n`, "utf8");
  console.log(`Wrote ${outputPath}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
