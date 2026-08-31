import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

interface Manifest {
  cases: Array<{ selectors: Array<{ file: string; title: string }> }>;
}

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const osRoot = resolve(packageRoot, "../..");
const manifest = JSON.parse(readFileSync(join(packageRoot, "fixtures/locked-cases.json"), "utf8")) as Manifest;

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function deterministicEnvironment(): NodeJS.ProcessEnv {
  const environment: NodeJS.ProcessEnv = { ...process.env, NODE_ENV: "test", TZ: "UTC" };
  for (const key of Object.keys(environment)) {
    if (/^(OPENAI|ANTHROPIC|GROQ|BEDROCK|AWS_|VAPI|GHL|QUICKBOOKS|STRIPE|DOCUSIGN|EXA|FIRECRAWL|VOYAGE|ZEP|STEEL|SENTRY|DATABASE|POSTGRES|SUPABASE)/i.test(key)) delete environment[key];
  }
  return environment;
}

const selectorsByFile = new Map<string, Set<string>>();
for (const selector of manifest.cases.flatMap((entry) => entry.selectors)) {
  const titles = selectorsByFile.get(selector.file) ?? new Set<string>();
  titles.add(selector.title);
  selectorsByFile.set(selector.file, titles);
}

const vitest = join(osRoot, "node_modules/vitest/vitest.mjs");
let selectedTests = 0;
for (const [file, titles] of [...selectorsByFile.entries()].sort(([left], [right]) => left.localeCompare(right))) {
  if (!existsSync(join(osRoot, file))) throw new Error(`Locked P1 corpus file is missing: ${file}`);
  const titlePattern = `(?:${[...titles].map(escapeRegExp).join("|")})$`;
  const result = spawnSync(process.execPath, [vitest, "run", file, "--testNamePattern", titlePattern], {
    cwd: osRoot,
    env: deterministicEnvironment(),
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    maxBuffer: 32 * 1024 * 1024,
  });
  process.stdout.write(result.stdout ?? "");
  process.stderr.write(result.stderr ?? "");
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`Locked P1 corpus failed with exit code ${result.status}: ${file}`);
  const passed = Number([...(result.stdout ?? "").matchAll(/Tests\s+(\d+) passed/g)].at(-1)?.[1] ?? 0);
  if (passed !== titles.size) throw new Error(`Locked P1 corpus selected ${titles.size} tests in ${file}, but exactly ${passed} passed`);
  selectedTests += passed;
}

const integrityFile = "packages/operational-ir/src/locked-corpus.test.ts";
const integrity = spawnSync(process.execPath, [vitest, "run", integrityFile], {
  cwd: osRoot,
  env: deterministicEnvironment(),
  encoding: "utf8",
  stdio: ["ignore", "pipe", "pipe"],
  maxBuffer: 8 * 1024 * 1024,
});
process.stdout.write(integrity.stdout ?? "");
process.stderr.write(integrity.stderr ?? "");
if (integrity.error) throw integrity.error;
if (integrity.status !== 0) throw new Error(`Locked P1 corpus integrity test failed with exit code ${integrity.status}`);
const integrityPassed = Number([...(integrity.stdout ?? "").matchAll(/Tests\s+(\d+) passed/g)].at(-1)?.[1] ?? 0);
if (integrityPassed !== 1) throw new Error(`Locked P1 corpus expected one integrity proof, but ${integrityPassed} passed`);

console.log(`P1 locked extension PASS: ${manifest.cases.length} cases, ${selectedTests} unique semantic selectors, 1 manifest/hash proof`);
