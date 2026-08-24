import { execFileSync } from "node:child_process";
import { sha256 } from "./certification-model";

const ALWAYS_CORE_FILES = new Set([
  "package.json", "package-lock.json", "tsconfig.json", "next.config.mjs", "vitest.config.ts",
  "finnor-os/package.json", "finnor-os/package-lock.json", "finnor-os/tsconfig.json", "finnor-os/vitest.config.ts",
]);

const GENERATED_CLIENT_PREFIXES = [
  "clients/",
  "evidence/clients/",
  "docs/release/generated/client-releases/",
  "finnor-os/clients/",
  "finnor-os/evidence/client-certifications/",
  "finnor-os/docs/client-releases/",
  "finnor-os/.certifications/",
];

const SHARED_CORE_PREFIXES = [
  ".github/workflows/",
  "src/",
  "scripts/release/",
  "finnor-os/apps/",
  "finnor-os/packages/",
  "finnor-os/scripts/",
  "finnor-os/tests/",
  "finnor-os/infra/",
];

export function isSharedCorePath(path: string): boolean {
  const normalized = path.replaceAll("\\", "/").replace(/^\.\//, "");
  if (GENERATED_CLIENT_PREFIXES.some((prefix) => normalized.startsWith(prefix))) return false;
  return ALWAYS_CORE_FILES.has(normalized) || SHARED_CORE_PREFIXES.some((prefix) => normalized.startsWith(prefix));
}

function git(repoRoot: string, args: string[]): string {
  return execFileSync("git", args, { cwd: repoRoot, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
}

export function coreSourceTreeHash(repoRoot: string, canonicalCoreSha: string): string {
  const rows = git(repoRoot, ["ls-tree", "-r", "--full-tree", canonicalCoreSha])
    .trim()
    .split("\n")
    .filter(Boolean)
    .flatMap((row) => {
      const match = row.match(/^\d+\s+\w+\s+([0-9a-f]+)\t(.+)$/);
      if (!match || !isSharedCorePath(match[2]!)) return [];
      return [{ path: match[2]!, blob: match[1]! }];
    })
    .sort((a, b) => a.path.localeCompare(b.path));
  if (rows.length === 0) throw new Error(`No shared FINNOR core files exist at ${canonicalCoreSha}`);
  return sha256(rows);
}

export interface CoreDiffResult {
  canonicalCoreSha: string;
  coreSourceTreeHash: string;
  changedSharedCorePaths: string[];
  changedClientPaths: string[];
  clean: boolean;
}

/**
 * Compares the certification worktree to the canonical core commit. Client-owned
 * generated configuration/evidence may differ; every shared source change is a hard
 * boundary requiring a new canonical core SHA and certification.
 */
export function inspectCoreDiff(repoRoot: string, canonicalCoreSha: string): CoreDiffResult {
  if (!/^[0-9a-f]{40}$/i.test(canonicalCoreSha)) throw new Error("canonicalCoreSha must be a full Git SHA");
  // Keep the comparison bounded in repositories that carry large untracked
  // evidence/database trees. A worktree diff against a commit can otherwise walk
  // every untracked byte before it reports the shared source files we care about.
  // The three tracked queries cover committed-after-canonical, staged, and
  // unstaged changes independently; the untracked query is scoped to shared source
  // roots so a client evidence dump cannot mask a new core file.
  const committed = git(repoRoot, ["diff", "--name-only", "-z", `${canonicalCoreSha}..HEAD`, "--"])
    .split("\0").filter(Boolean);
  const staged = git(repoRoot, ["diff", "--cached", "--name-only", "-z", "--"])
    .split("\0").filter(Boolean);
  const worktree = git(repoRoot, ["diff-files", "--name-only", "-z", "--"])
    .split("\0").filter(Boolean);
  const untrackedRoots = [
    ...SHARED_CORE_PREFIXES.map((prefix) => prefix.replace(/\/$/, "")),
    ...[...ALWAYS_CORE_FILES],
  ];
  const untracked = git(repoRoot, ["ls-files", "--others", "--exclude-standard", "-z", "--", ...untrackedRoots])
    .split("\0").filter(Boolean);
  const paths = [...new Set([...committed, ...staged, ...worktree, ...untracked])].sort();
  const changedSharedCorePaths = paths.filter(isSharedCorePath);
  return {
    canonicalCoreSha: canonicalCoreSha.toLowerCase(),
    coreSourceTreeHash: coreSourceTreeHash(repoRoot, canonicalCoreSha),
    changedSharedCorePaths,
    changedClientPaths: paths.filter((path) => !isSharedCorePath(path)),
    clean: changedSharedCorePaths.length === 0,
  };
}
