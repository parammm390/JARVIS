import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import EmbeddedPostgres from "embedded-postgres";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const root = resolve(scriptDirectory, "../..");

type ReplayManifest = { cases: Array<{ selectors: Array<{ file: string; title: string }> }> };

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function freePort(): Promise<number> {
  return new Promise((resolvePort, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") return reject(new Error("Could not allocate replay database port"));
      const port = address.port;
      server.close((error) => error ? reject(error) : resolvePort(port));
    });
  });
}

function deterministicEnvironment(databaseUrl: string): NodeJS.ProcessEnv {
  const environment: NodeJS.ProcessEnv = { ...process.env, DATABASE_URL: databaseUrl, MIGRATIONS_DATABASE_URL: databaseUrl, AUTH_DEV_BYPASS: "1", NODE_ENV: "test", TZ: "UTC" };
  for (const key of Object.keys(environment)) {
    if (/^(OPENAI|ANTHROPIC|GROQ|BEDROCK|AWS_|VAPI|GHL|QUICKBOOKS|STRIPE|DOCUSIGN|EXA|FIRECRAWL|VOYAGE|ZEP|STEEL|SENTRY)/i.test(key)) delete environment[key];
    if (["POSTGRES_URL", "POSTGRES_URL_NON_POOLING", "SUPABASE_DB_URL"].includes(key)) delete environment[key];
  }
  return environment;
}

async function main(): Promise<void> {
  const manifest = JSON.parse(await readFile(join(root, "architecture/p0/replay-corpus.json"), "utf8")) as ReplayManifest;
  const selectorsByFile = new Map<string, Set<string>>();
  for (const selector of manifest.cases.flatMap((entry) => entry.selectors)) {
    const titles = selectorsByFile.get(selector.file) ?? new Set<string>();
    titles.add(selector.title);
    selectorsByFile.set(selector.file, titles);
  }
  const requestedFile = process.argv.find((argument) => argument.startsWith("--only="))?.slice("--only=".length);
  const allFiles = [...selectorsByFile.keys()].sort();
  if (requestedFile && !selectorsByFile.has(requestedFile)) throw new Error(`Replay manifest has no selectors for ${requestedFile}`);
  const files = requestedFile ? [requestedFile] : allFiles;
  for (const file of files) if (!existsSync(join(root, file))) throw new Error(`Replay file is missing: ${file}`);

  const databaseDirectory = await mkdtemp(join(tmpdir(), "finnor-p0-replay-"));
  const port = await freePort();
  const postgres = new EmbeddedPostgres({ databaseDir: databaseDirectory, user: "finnor", password: "finnor", port, persistent: false });
  try {
    await postgres.initialise();
    await postgres.start();
    const databaseUrl = `postgres://finnor:finnor@127.0.0.1:${port}/finnor`;
    const vitest = join(root, "node_modules/vitest/vitest.mjs");
    for (const [index, file] of files.entries()) {
      if (index > 0) await postgres.dropDatabase("finnor");
      await postgres.createDatabase("finnor");
      console.log(`\n[P0 replay ${index + 1}/${files.length}] ${file}`);
      const titlePattern = `(?:${[...selectorsByFile.get(file)!].map(escapeRegExp).join("|")})$`;
      const result = spawnSync(process.execPath, [vitest, "run", file, "--testNamePattern", titlePattern], {
        cwd: root,
        env: deterministicEnvironment(databaseUrl),
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
        maxBuffer: 64 * 1024 * 1024,
      });
      process.stdout.write(result.stdout ?? "");
      process.stderr.write(result.stderr ?? "");
      if (result.error) throw result.error;
      if (result.status !== 0) throw new Error(`Locked replay file failed with exit code ${result.status}: ${file}`);
      const expectedTests = selectorsByFile.get(file)!.size;
      const passedMatch = [...(result.stdout ?? "").matchAll(/Tests\s+(\d+) passed/g)].at(-1);
      const passedTests = Number(passedMatch?.[1] ?? 0);
      if (passedTests !== expectedTests) throw new Error(`Locked replay selected ${expectedTests} tests in ${file}, but exactly ${passedTests} passed`);
    }
    console.log(requestedFile
      ? `P0 locked replay file PASS: ${selectorsByFile.get(requestedFile)!.size} selectors in ${requestedFile}`
      : `P0 locked replay PASS: ${manifest.cases.length} cases across ${files.length} deterministic files`);
  } finally {
    await postgres.stop().catch(() => undefined);
    await rm(databaseDirectory, { recursive: true, force: true });
  }
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
