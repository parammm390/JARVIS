import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, extname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

export const scriptDirectory = dirname(fileURLToPath(import.meta.url));
export const finnorOsRoot = resolve(scriptDirectory, "../..");
export const repositoryRoot = resolve(finnorOsRoot, "..");
export const outputDirectory = join(finnorOsRoot, "architecture/pe0");

export type LocalImport = {
  specifier: string;
  kind: "import" | "export" | "require" | "dynamic-import";
  line: number;
  resolvedPath: string | null;
  external: boolean;
};

export type ParsedSource = {
  symbols: Array<{ name: string; line: number; kind: string }>;
  imports: LocalImport[];
  stringLiterals: Array<{ value: string; line: number; context: string }>;
};

export function git(args: string[], cwd = repositoryRoot): string {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    maxBuffer: 128 * 1024 * 1024,
  }).trimEnd();
}

export function lines(value: string): string[] {
  return value.split("\n").map((line) => line.trim()).filter(Boolean);
}

export function sortedUnique(values: Iterable<string>): string[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

export function stableHash(value: unknown): string {
  const serialized = typeof value === "string" ? value : JSON.stringify(value);
  return createHash("sha256").update(serialized).digest("hex");
}

export async function writeJson(name: string, value: unknown): Promise<void> {
  await mkdir(outputDirectory, { recursive: true });
  await writeFile(join(outputDirectory, name), `${JSON.stringify(value, null, 2)}\n`);
}

export async function readJson<T>(name: string): Promise<T> {
  return JSON.parse(await readFile(join(outputDirectory, name), "utf8")) as T;
}

export function repoPath(absolutePath: string): string {
  return relative(repositoryRoot, absolutePath).replaceAll("\\", "/");
}

export function absoluteRepoPath(path: string): string {
  return join(repositoryRoot, path);
}

export function sourceLine(text: string, pattern: string | RegExp): number | null {
  const expression = typeof pattern === "string"
    ? new RegExp(pattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    : pattern;
  const index = text.split("\n").findIndex((line) => expression.test(line));
  return index < 0 ? null : index + 1;
}

export function boundedSnippet(text: string, line: number, maxLength = 180): string {
  const value = text.split("\n")[Math.max(0, line - 1)]?.trim().replace(/\s+/g, " ") ?? "";
  return value.length <= maxLength ? value : `${value.slice(0, maxLength - 1)}…`;
}

export function artifactId(path: string): string {
  return `file:${stableHash(path).slice(0, 16)}`;
}

const SOURCE_EXTENSIONS = [".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs", ".json", ".css"];

function possibleModuleFiles(base: string): string[] {
  const extension = extname(base);
  const result = extension && SOURCE_EXTENSIONS.includes(extension) ? [base] : SOURCE_EXTENSIONS.map((candidate) => `${base}${candidate}`);
  for (const candidate of SOURCE_EXTENSIONS) result.push(join(base, `index${candidate}`));
  const manifestPath = join(base, "package.json");
  if (existsSync(manifestPath)) {
    try {
      const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as { main?: string };
      if (manifest.main) result.unshift(join(base, manifest.main));
    } catch {
      // Invalid package manifests are checked by the repository's package tooling.
    }
  }
  return result;
}

export type PackageTarget = { directory: string; main: string };

export function buildPackageTargets(tracked: readonly string[]): Map<string, PackageTarget> {
  const result = new Map<string, PackageTarget>();
  for (const path of tracked.filter((candidate) => candidate.endsWith("package.json"))) {
    const absolute = absoluteRepoPath(path);
    try {
      const body = JSON.parse(readFileSync(absolute, "utf8")) as { name?: string; main?: string };
      if (!body.name?.startsWith("@finnor/")) continue;
      result.set(body.name, { directory: dirname(absolute), main: body.main ?? "index.ts" });
    } catch {
      // A malformed manifest is surfaced by the repository's existing package checks.
    }
  }
  return result;
}

export function resolveLocalImport(
  importerPath: string,
  specifier: string,
  packages: ReadonlyMap<string, PackageTarget>,
): string | null {
  const importer = absoluteRepoPath(importerPath);
  const bases: string[] = [];
  if (specifier.startsWith(".")) {
    bases.push(resolve(dirname(importer), specifier));
  } else if (specifier.startsWith("@/")) {
    bases.push(join(repositoryRoot, "src", specifier.slice(2)));
  } else if (specifier.startsWith("@finnor/")) {
    const segments = specifier.split("/");
    const packageName = segments.slice(0, 2).join("/");
    const target = packages.get(packageName);
    if (!target) return null;
    const subpath = segments.slice(2).join("/");
    if (subpath) {
      bases.push(join(target.directory, subpath), join(target.directory, "src", subpath));
    } else {
      bases.push(join(target.directory, target.main), join(target.directory, "src/index"), join(target.directory, "index"));
    }
  } else {
    return null;
  }
  for (const base of bases) {
    for (const candidate of possibleModuleFiles(base)) {
      if (existsSync(candidate)) return repoPath(candidate);
    }
  }
  return null;
}

function scriptKind(path: string): ts.ScriptKind {
  if (path.endsWith(".tsx")) return ts.ScriptKind.TSX;
  if (path.endsWith(".jsx")) return ts.ScriptKind.JSX;
  if (path.endsWith(".js") || path.endsWith(".mjs") || path.endsWith(".cjs")) return ts.ScriptKind.JS;
  return ts.ScriptKind.TS;
}

function declarationName(node: ts.Node): string | null {
  if ((ts.isFunctionDeclaration(node) || ts.isClassDeclaration(node) || ts.isInterfaceDeclaration(node)
    || ts.isTypeAliasDeclaration(node) || ts.isEnumDeclaration(node)) && node.name) return node.name.text;
  if (ts.isVariableStatement(node)) {
    return node.declarationList.declarations.map((declaration) => declaration.name.getText()).join(",");
  }
  return null;
}

function isExported(node: ts.Node): boolean {
  return Boolean((node as ts.HasModifiers).modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword));
}

export function parseSource(path: string, text: string, packages: ReadonlyMap<string, PackageTarget>): ParsedSource {
  const source = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true, scriptKind(path));
  const symbols: ParsedSource["symbols"] = [];
  const rawImports: Array<Omit<LocalImport, "resolvedPath" | "external">> = [];
  const stringLiterals: ParsedSource["stringLiterals"] = [];
  const lineOf = (node: ts.Node) => source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
  const addImport = (specifier: string, kind: LocalImport["kind"], node: ts.Node) => {
    rawImports.push({ specifier, kind, line: lineOf(node) });
  };
  const visit = (node: ts.Node) => {
    if (isExported(node)) {
      const name = declarationName(node);
      if (name) {
        for (const part of name.split(",")) symbols.push({ name: part.trim(), line: lineOf(node), kind: ts.SyntaxKind[node.kind] });
      }
    }
    if (ts.isExportAssignment(node)) symbols.push({ name: "default", line: lineOf(node), kind: "ExportAssignment" });
    if (ts.isExportDeclaration(node)) {
      if (node.exportClause && ts.isNamedExports(node.exportClause)) {
        for (const element of node.exportClause.elements) symbols.push({ name: element.name.text, line: lineOf(element), kind: "ExportSpecifier" });
      }
      if (node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) addImport(node.moduleSpecifier.text, "export", node);
    }
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) addImport(node.moduleSpecifier.text, "import", node);
    if (ts.isCallExpression(node) && node.arguments.length >= 1 && ts.isStringLiteral(node.arguments[0]!)) {
      const expression = node.expression;
      if (ts.isIdentifier(expression) && expression.text === "require") addImport(node.arguments[0]!.text, "require", node);
      if (expression.kind === ts.SyntaxKind.ImportKeyword) addImport(node.arguments[0]!.text, "dynamic-import", node);
    }
    if (ts.isStringLiteralLike(node)) {
      stringLiterals.push({
        value: node.text,
        line: lineOf(node),
        context: boundedSnippet(text, lineOf(node), 220),
      });
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  const imports = rawImports.map((entry) => {
    const localShape = entry.specifier.startsWith(".") || entry.specifier.startsWith("@/") || entry.specifier.startsWith("@finnor/");
    const resolvedPath = resolveLocalImport(path, entry.specifier, packages);
    return { ...entry, resolvedPath, external: !localShape };
  });
  return {
    symbols: symbols.sort((left, right) => left.line - right.line || left.name.localeCompare(right.name)),
    imports,
    stringLiterals,
  };
}

export function trackedFiles(ref = "HEAD"): string[] {
  return lines(git(["ls-tree", "-r", "--name-only", ref]));
}

export function isTextAuditCandidate(path: string): boolean {
  if (
    path.startsWith("finnor-os/scripts/pe0/")
    || path.startsWith("finnor-os/architecture/pe0/")
    || path === "finnor-os/tests/unit/pe0-audit.test.ts"
    || path === ".github/workflows/pe0-certification.yml"
  ) return false;
  const extension = extname(path).toLowerCase();
  const supported = new Set([".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs", ".sql", ".json", ".yaml", ".yml", ".md", ".sh", ".toml"]);
  if (!supported.has(extension) && !path.endsWith(".env.example") && !path.endsWith("Dockerfile")) return false;
  return path.startsWith("finnor-os/apps/")
    || path.startsWith("finnor-os/packages/")
    || path.startsWith("finnor-os/scripts/")
    || path.startsWith("finnor-os/tests/")
    || path.startsWith("finnor-os/architecture/")
    || path.startsWith("finnor-os/corpus/")
    || path === "finnor-os/openapi.json"
    || path === "finnor-os/package.json"
    || path === "finnor-os/.env.example"
    || path === "finnor-os/docker-compose.yml"
    || path.startsWith("src/app/api/")
    || path.startsWith("src/lib/")
    || path.startsWith("scripts/release/")
    || path.startsWith("docs/release/generated/")
    || (/^docs\/release\/[^/]+\.md$/.test(path))
    || path.startsWith("infra/")
    || path.startsWith("supabase/migrations/")
    || path.startsWith(".github/workflows/")
    || path === "package.json"
    || path === ".env.example"
    || path === ".env.local.example";
}

export function packageForPath(path: string, packageTargets: ReadonlyMap<string, PackageTarget>): string {
  const absolute = absoluteRepoPath(path);
  const matches = [...packageTargets.entries()]
    .filter(([, target]) => absolute === target.directory || absolute.startsWith(`${target.directory}/`))
    .sort((left, right) => right[1].directory.length - left[1].directory.length);
  if (matches[0]) return matches[0][0];
  if (path.startsWith("src/")) return "@finnor/frontend";
  if (path.startsWith(".github/")) return "github-actions";
  if (path.startsWith("infra/")) return "production-infrastructure";
  if (path.startsWith("supabase/")) return "legacy-supabase";
  if (path.startsWith("scripts/")) return "root-release-assurance";
  if (path.startsWith("finnor-os/scripts/")) return "@finnor/assurance";
  if (path.startsWith("finnor-os/architecture/")) return "@finnor/architecture-history";
  return "repository-root";
}

export function normalizeModelPath(path: string): string {
  if (path.startsWith("../")) return path.slice(3);
  if (path.startsWith("finnor-os/") || path.startsWith("src/") || path.startsWith("infra/") || path.startsWith(".github/")) return path;
  return `finnor-os/${path}`;
}

export function countBy<T extends string>(values: Iterable<T>): Record<T, number> {
  const result = {} as Record<T, number>;
  for (const value of values) result[value] = (result[value] ?? 0) + 1;
  return result;
}
