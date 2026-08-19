import "dotenv/config";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { closePool } from "@finnor/db";
import { parseImportDefinition, runDeclarativeImport } from "@finnor/import-engine";
import { loadClientManifest } from "./client-manifest";

function args(): Record<string, string | boolean> {
  return Object.fromEntries(process.argv.slice(2).map((argument) => {
    const [key, ...rest] = argument.replace(/^--/, "").split("=");
    return [key!, rest.length ? rest.join("=") : true];
  }));
}

async function main(): Promise<void> {
  const options = args();
  const tenantId = String(options.tenantId ?? "");
  const sourcePath = String(options.file ?? "");
  if (!tenantId || !sourcePath) throw new Error("Usage: --tenantId=<uuid> --file=<source> (--mapping=<json> | --manifest=<json> --importKey=<key>) [--dry-run]");

  let definition: ReturnType<typeof parseImportDefinition>;
  if (options.mapping) {
    definition = parseImportDefinition(JSON.parse(await readFile(resolve(String(options.mapping)), "utf8")));
  } else if (options.manifest && options.importKey) {
    const manifest = await loadClientManifest(resolve(String(options.manifest)));
    const selected = manifest.imports.find((candidate) => candidate.key === options.importKey);
    if (!selected) throw new Error(`manifest import ${String(options.importKey)} was not found`);
    definition = parseImportDefinition({ key: selected.key, format: selected.source, ...selected.definition });
  } else {
    throw new Error("Provide --mapping, or both --manifest and --importKey");
  }

  const report = await runDeclarativeImport({
    tenantId,
    definition,
    source: { name: sourcePath, content: await readFile(resolve(sourcePath), "utf8") },
    dryRun: options["dry-run"] === true,
  });
  console.log(JSON.stringify(report, null, 2));
  if (report.quarantined) process.exitCode = 2;
}

main().catch((error) => { console.error(error); process.exitCode = 1; }).finally(() => closePool());
