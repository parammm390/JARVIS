import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function filesBelow(directory: string): string[] {
  return readdirSync(directory).flatMap((entry) => {
    const path = join(directory, entry);
    return statSync(path).isDirectory() ? filesBelow(path) : path.endsWith(".ts") ? [path] : [];
  });
}

describe("pure offline import and execution boundary", () => {
  it("imports no DB, Authority, Work runtime, provider, computer runner, network, persistence, or P4/P5 execution package", () => {
    const productionSources = filesBelow(join(root, "src")).filter((path) => !path.endsWith(".test.ts"));
    const source = productionSources.map((path) => readFileSync(path, "utf8")).join("\n");
    expect(source).not.toMatch(/from ["']@finnor\/(?:db|authority|workflow-runtime|orchestration|computer|tools|program-search|speculative-runtime)["']/);
    expect(source).not.toMatch(/from ["'](?:pg|drizzle-orm|ioredis|node:https|node:http|undici|axios)["']/);
    expect(source).not.toMatch(/process\.env|fetch\(|(?:db|pool|client)\.(?:query|insert|update|delete)\(/);
  });

  it("exports no ProcedureCandidate execution, authority grant, Work mutation, or certification function", async () => {
    const exports = await import("./index");
    const forbidden = Object.keys(exports).filter((key) => /executeProcedure|authorizeProcedure|certifyProcedure|mutateWork|persistProcedure/i.test(key));
    expect(forbidden).toEqual([]);
  });
});
