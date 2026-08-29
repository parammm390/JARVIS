import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  createDefaultPluginRegistry,
  createHumanOperabilityMatrix,
  createUserCapabilityRegistry,
} from "@finnor/orchestration";

const repoRoot = resolve(fileURLToPath(new URL("../../..", import.meta.url)));
const outputPath = resolve(repoRoot, "scripts/release/human-operability-matrix.generated.json");
const registry = createUserCapabilityRegistry(createDefaultPluginRegistry());
const generated = `${JSON.stringify(createHumanOperabilityMatrix(registry), null, 2)}\n`;

if (process.argv.includes("--check")) {
  let existing = "";
  try { existing = readFileSync(outputPath, "utf8"); } catch { /* mismatch reported below */ }
  if (existing !== generated) {
    throw new Error("Generated Human Operability Matrix is stale. Run npm run release:human-operability in finnor-os.");
  }
  console.log("Human Operability Matrix is source-synchronized");
} else {
  writeFileSync(outputPath, generated);
  console.log(`Generated Human Operability Matrix: ${registry.actions().length} actions + ${registry.queries().length} queries`);
}
