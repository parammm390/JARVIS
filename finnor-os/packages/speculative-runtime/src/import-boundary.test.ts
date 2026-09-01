import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

interface Manifest {
  name?: string;
  dependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
}

const OS_ROOT = join(import.meta.dirname, "../../..");
const PACKAGE_ROOT = join(OS_ROOT, "packages/speculative-runtime");
const SOURCE_ROOT = join(PACKAGE_ROOT, "src");
const ALLOWED_DEPENDENCIES = ["@finnor/epistemic-runtime", "@finnor/operational-ir", "@finnor/shared-types"];
const ALLOWED_IMPORTS = new Set([...ALLOWED_DEPENDENCIES, "node:crypto"]);

function files(root: string, predicate: (path: string) => boolean): string[] {
  return readdirSync(root).sort().flatMap((name) => {
    const path = join(root, name);
    return statSync(path).isDirectory() ? files(path, predicate) : predicate(path) ? [path] : [];
  });
}

function imports(source: string): string[] {
  const values: string[] = [];
  const staticPattern = /(?:import|export)\s+(?:type\s+)?(?:[\s\S]*?\s+from\s+)?["']([^"']+)["'];/g;
  const dynamicPattern = /import\s*\(\s*["']([^"']+)["']\s*\)/g;
  for (const pattern of [staticPattern, dynamicPattern]) for (const match of source.matchAll(pattern)) values.push(match[1]!);
  return values;
}

function packageGraph(): Map<string, string[]> {
  const manifests = files(join(OS_ROOT, "packages"), (path) => path.endsWith("package.json"))
    .map((path) => JSON.parse(readFileSync(path, "utf8")) as Manifest)
    .filter((manifest) => manifest.name?.startsWith("@finnor/"));
  const names = new Set(manifests.flatMap((manifest) => manifest.name ? [manifest.name] : []));
  return new Map(manifests.map((manifest) => {
    const declared = { ...manifest.dependencies, ...manifest.optionalDependencies, ...manifest.peerDependencies };
    return [manifest.name!, Object.keys(declared).filter((name) => names.has(name)).sort()];
  }));
}

function cycles(graph: Map<string, string[]>): string[][] {
  const result: string[][] = [];
  const complete = new Set<string>();
  const active: string[] = [];
  const visit = (node: string): void => {
    const index = active.indexOf(node);
    if (index >= 0) { result.push([...active.slice(index), node]); return; }
    if (complete.has(node)) return;
    active.push(node);
    for (const next of graph.get(node) ?? []) visit(next);
    active.pop();
    complete.add(node);
  };
  for (const node of [...graph.keys()].sort()) visit(node);
  return result;
}

describe("P5 fail-closed package boundary", () => {
  it("declares only P1/P2, P3, and shared contracts as runtime dependencies", () => {
    const manifest = JSON.parse(readFileSync(join(PACKAGE_ROOT, "package.json"), "utf8")) as Manifest;
    expect(Object.keys(manifest.dependencies ?? {}).sort()).toEqual(ALLOWED_DEPENDENCIES);
  });

  it("imports no DB, P4, orchestration, Authority, Work, provider, computer, API, or UI runtime", () => {
    const violations = files(SOURCE_ROOT, (path) => path.endsWith(".ts") && !path.endsWith(".test.ts") && !path.endsWith("test-support.ts")).flatMap((path) =>
      imports(readFileSync(path, "utf8")).filter((specifier) => !specifier.startsWith(".") && !ALLOWED_IMPORTS.has(specifier))
        .map((specifier) => `${relative(OS_ROOT, path)} -> ${specifier}`));
    expect(violations).toEqual([]);
  });

  it("contains no ambient clock, randomness, network, environment, process, or persistence primitive", () => {
    const forbidden = /\b(?:Date\.now|performance\.now|new Date|Math\.random|randomUUID|fetch|XMLHttpRequest|setTimeout|setInterval|execFile|spawn)\b|\bprocess\.env\b/g;
    const violations = files(SOURCE_ROOT, (path) => path.endsWith(".ts") && !path.endsWith(".test.ts") && !path.endsWith("test-support.ts")).flatMap((path) =>
      [...readFileSync(path, "utf8").matchAll(forbidden)].map((match) => `${relative(OS_ROOT, path)}:${match[0]}`));
    expect(violations).toEqual([]);
  });

  it("adds no package cycle and has no reverse dependency from lower layers", () => {
    const graph = packageGraph();
    expect(graph.get("@finnor/speculative-runtime")).toEqual(ALLOWED_DEPENDENCIES);
    for (const dependency of ALLOWED_DEPENDENCIES) expect(graph.get(dependency) ?? []).not.toContain("@finnor/speculative-runtime");
    expect(cycles(graph)).toEqual([]);
  });
});
