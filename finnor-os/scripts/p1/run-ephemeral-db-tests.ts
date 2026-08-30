import { spawnSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import EmbeddedPostgres from "embedded-postgres";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const npmScript = process.argv.find((argument) => argument.startsWith("--npm-script="))?.slice("--npm-script=".length);
const files = process.argv.slice(2).filter((argument) => !argument.startsWith("--"));
const allowedNpmScripts = new Set(["release:contract", "test"]);
if (npmScript && !allowedNpmScripts.has(npmScript)) throw new Error(`Unsupported ephemeral DB npm script: ${npmScript}`);
if (!npmScript && (files.length === 0 || files.some((file) => !/^tests\/(?:integration|unit)\/[a-z0-9._/-]+\.test\.ts$/i.test(file)))) {
  throw new Error("Pass explicit test paths or an allowlisted --npm-script value");
}

function freePort(): Promise<number> {
  return new Promise((resolvePort, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") return reject(new Error("Could not allocate test database port"));
      server.close((error) => error ? reject(error) : resolvePort(address.port));
    });
  });
}

async function main(): Promise<void> {
  const databaseDirectory = await mkdtemp(join(tmpdir(), "finnor-p1-tests-"));
  const port = await freePort();
  const postgres = new EmbeddedPostgres({
    databaseDir: databaseDirectory,
    user: "finnor",
    password: "finnor",
    port,
    persistent: false,
  });
  try {
    await postgres.initialise();
    await postgres.start();
    await postgres.createDatabase("finnor");
    const databaseUrl = `postgres://finnor:finnor@127.0.0.1:${port}/finnor`;
    const environment: NodeJS.ProcessEnv = {
      ...process.env,
      DATABASE_URL: databaseUrl,
      MIGRATIONS_DATABASE_URL: databaseUrl,
      AUTH_DEV_BYPASS: "1",
      ...(["release:contract", "test"].includes(npmScript ?? "") ? {
        CERTIFICATION_SEED_ALLOWED: "1",
        CERTIFICATION_TEST_EMAILS: "certification@example.invalid",
        CERTIFICATION_TEST_PHONES: "+15550000001",
      } : {}),
      NODE_ENV: "test",
      TZ: "UTC",
    };
    for (const key of Object.keys(environment)) {
      if (/^(OPENAI|ANTHROPIC|GROQ|BEDROCK|AWS_|VAPI|GHL|QUICKBOOKS|STRIPE|DOCUSIGN|EXA|FIRECRAWL|VOYAGE|ZEP|STEEL|SENTRY)/i.test(key)) delete environment[key];
      if (["POSTGRES_URL", "POSTGRES_URL_NON_POOLING", "SUPABASE_DB_URL"].includes(key)) delete environment[key];
    }
    if (npmScript === "release:contract") {
      const manifest = spawnSync("npm", ["run", "release:manifest"], {
        cwd: root,
        env: environment,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
        maxBuffer: 64 * 1024 * 1024,
      });
      process.stdout.write(manifest.stdout ?? "");
      process.stderr.write(manifest.stderr ?? "");
      if (manifest.error) throw manifest.error;
      if (manifest.status !== 0) throw new Error(`Action manifest generation failed with exit code ${manifest.status}`);
    }
    for (const [label, script] of [["migration", "db:migrate"], ["LangGraph setup", "setup:langgraph"]] as const) {
      const setup = spawnSync("npm", ["run", script], {
        cwd: root,
        env: environment,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
        maxBuffer: 64 * 1024 * 1024,
      });
      process.stdout.write(setup.stdout ?? "");
      process.stderr.write(setup.stderr ?? "");
      if (setup.error) throw setup.error;
      if (setup.status !== 0) throw new Error(`Ephemeral DB ${label} failed with exit code ${setup.status}`);
    }
    const command = npmScript ? "npm" : process.execPath;
    const args = npmScript
      ? ["run", npmScript]
      : [join(root, "node_modules/vitest/vitest.mjs"), "run", ...files, "--reporter=verbose"];
    const result = spawnSync(command, args, {
      cwd: root,
      env: environment,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      maxBuffer: 64 * 1024 * 1024,
    });
    process.stdout.write(result.stdout ?? "");
    process.stderr.write(result.stderr ?? "");
    if (result.error) throw result.error;
    if (result.status !== 0) throw new Error(`Ephemeral DB ${npmScript ?? "test"} run failed with exit code ${result.status}`);
  } finally {
    await postgres.stop().catch(() => undefined);
    await rm(databaseDirectory, { recursive: true, force: true });
  }
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
