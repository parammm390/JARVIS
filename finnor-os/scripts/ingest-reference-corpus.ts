// Usage: npx tsx scripts/ingest-reference-corpus.ts <tenant-id>
// Downloads are intentionally separate: use the exact URLs in corpus/water-treatment/
// sources.json, then this script verifies each manifest checksum before it writes.

import "dotenv/config";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { closePool } from "@finnor/db";
import { ingestPublicReferencePdf, type PublicReferenceSource } from "@finnor/memory";

interface ManifestEntry extends PublicReferenceSource { file: string }
interface Manifest { sources: ManifestEntry[] }

const tenantId = process.argv[2] ?? "";
if (!tenantId) throw new Error("Usage: npx tsx scripts/ingest-reference-corpus.ts <tenant-id>");

async function main() {
  const corpusDir = path.resolve("corpus/water-treatment");
  const manifest = JSON.parse(await readFile(path.join(corpusDir, "sources.json"), "utf8")) as Manifest;
  if (!Array.isArray(manifest.sources) || manifest.sources.length === 0) throw new Error("Reference corpus manifest has no sources.");
  for (const entry of manifest.sources) {
    if (!entry.file || !entry.title || !entry.organization || !entry.url || !/^[a-f0-9]{64}$/.test(entry.sha256)) {
      throw new Error("Reference corpus manifest contains an invalid source entry.");
    }
    const result = await ingestPublicReferencePdf({
      tenantId,
      source: entry,
      bytes: await readFile(path.join(corpusDir, entry.file)),
    });
    console.log(JSON.stringify({ source: entry.url, ...result }));
  }
}

main().then(() => closePool()).catch(async (error) => {
  console.error(error);
  await closePool();
  process.exitCode = 1;
});
