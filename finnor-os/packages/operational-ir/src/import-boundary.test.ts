import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

interface PackageManifest {
  name?: string;
  dependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
}

const OS_ROOT = join(import.meta.dirname, "../../..");
const PACKAGE_ROOT = join(OS_ROOT, "packages/operational-ir");
const SOURCE_ROOT = join(PACKAGE_ROOT, "src");
const ALLOWED_RUNTIME_DEPENDENCIES = ["@finnor/shared-types", "zod"];
const ALLOWED_PRODUCTION_IMPORTS = new Set(["@finnor/shared-types", "zod", "node:crypto"]);

function filesBelow(root: string, predicate: (path: string) => boolean): string[] {
  const result: string[] = [];
  for (const name of readdirSync(root).sort()) {
    const path = join(root, name);
    const stat = statSync(path);
    if (stat.isDirectory()) result.push(...filesBelow(path, predicate));
    else if (predicate(path)) result.push(path);
  }
  return result;
}

function importSpecifiers(source: string): string[] {
  const values: string[] = [];
  const staticPattern = /(?:import|export)\s+(?:type\s+)?(?:[\s\S]*?\s+from\s+)?["']([^"']+)["'];/g;
  const dynamicPattern = /import\s*\(\s*["']([^"']+)["']\s*\)/g;
  for (const pattern of [staticPattern, dynamicPattern]) {
    for (const match of source.matchAll(pattern)) values.push(match[1]!);
  }
  return values;
}

function packageManifests(): Map<string, PackageManifest> {
  const manifests = new Map<string, PackageManifest>();
  for (const root of [join(OS_ROOT, "apps"), join(OS_ROOT, "packages")]) {
    for (const path of filesBelow(root, (candidate) => candidate.endsWith("package.json"))) {
      if (path.includes(`${join("node_modules", "")}`)) continue;
      const manifest = JSON.parse(readFileSync(path, "utf8")) as PackageManifest;
      if (manifest.name?.startsWith("@finnor/")) manifests.set(manifest.name, manifest);
    }
  }
  return manifests;
}

function internalEdges(manifests: Map<string, PackageManifest>): Map<string, string[]> {
  const names = new Set(manifests.keys());
  const graph = new Map<string, string[]>();
  for (const [name, manifest] of manifests) {
    const declared = {
      ...manifest.dependencies,
      ...manifest.optionalDependencies,
      ...manifest.peerDependencies,
    };
    graph.set(name, Object.keys(declared).filter((dependency) => names.has(dependency)).sort());
  }
  return graph;
}

function graphCycles(graph: Map<string, string[]>): string[][] {
  const cycles: string[][] = [];
  const active: string[] = [];
  const visited = new Set<string>();
  const visit = (node: string) => {
    const activeIndex = active.indexOf(node);
    if (activeIndex >= 0) {
      cycles.push([...active.slice(activeIndex), node]);
      return;
    }
    if (visited.has(node)) return;
    active.push(node);
    for (const dependency of graph.get(node) ?? []) visit(dependency);
    active.pop();
    visited.add(node);
  };
  for (const node of [...graph.keys()].sort()) visit(node);
  return cycles;
}

describe("Operational IR downward dependency boundary", () => {
  it("declares only shared-types and schema validation as runtime dependencies", () => {
    const manifest = JSON.parse(readFileSync(join(PACKAGE_ROOT, "package.json"), "utf8")) as PackageManifest;
    expect(Object.keys(manifest.dependencies ?? {}).sort()).toEqual(ALLOWED_RUNTIME_DEPENDENCIES);
  });

  it("imports no DB, orchestration, authority, runtime, plugin, provider, API, or frontend package", () => {
    const violations: string[] = [];
    for (const path of filesBelow(SOURCE_ROOT, (candidate) => candidate.endsWith(".ts") && !candidate.endsWith(".test.ts"))) {
      const specifiers = importSpecifiers(readFileSync(path, "utf8"));
      for (const specifier of specifiers) {
        if (specifier.startsWith(".")) continue;
        if (!ALLOWED_PRODUCTION_IMPORTS.has(specifier)) violations.push(`${relative(OS_ROOT, path)} -> ${specifier}`);
      }
    }
    expect(violations).toEqual([]);
  });

  it("contains no ambient clock, randomness, network, process environment, or persistence primitive", () => {
    const forbidden = /\b(?:Date\.now|Math\.random|randomUUID|fetch|XMLHttpRequest|setTimeout|setInterval)\b|\bprocess\.env\b/g;
    const violations: string[] = [];
    for (const path of filesBelow(SOURCE_ROOT, (candidate) => candidate.endsWith(".ts") && !candidate.endsWith(".test.ts"))) {
      const source = readFileSync(path, "utf8");
      for (const match of source.matchAll(forbidden)) violations.push(`${relative(OS_ROOT, path)}:${match.index}:${match[0]}`);
    }
    expect(violations).toEqual([]);
  });

  it("keeps shared-types below Operational IR and prevents reverse/transitive cycles", () => {
    const manifests = packageManifests();
    const graph = internalEdges(manifests);
    expect(graph.get("@finnor/operational-ir")).toEqual(["@finnor/shared-types"]);
    expect(graph.get("@finnor/shared-types") ?? []).not.toContain("@finnor/operational-ir");
    expect(graphCycles(graph)).toEqual([]);
  });
});
