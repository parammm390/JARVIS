import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

const r = (p: string) => fileURLToPath(new URL(p, import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      "@finnor/shared-types": r("./packages/shared-types/src/index.ts"),
      "@finnor/policy-schema": r("./packages/policy-schema/src/index.ts"),
      "@finnor/db": r("./packages/db/index.ts"),
      "@finnor/memory": r("./packages/memory/src/index.ts"),
      "@finnor/security": r("./packages/security/src/index.ts"),
      "@finnor/tools": r("./packages/tools/src/index.ts"),
      "@finnor/orchestration": r("./packages/orchestration/src/index.ts"),
      "@finnor/plugins-shared": r("./packages/domain-plugins/shared/plugin-interface.ts"),
    },
  },
  test: {
    include: ["tests/**/*.test.ts"],
    testTimeout: 30_000,
    pool: "forks",
    // Integration tests share ONE real database (migrations, jobs table, tenant rows).
    // Running test files in parallel races on shared mutable state (and on catalog-level
    // DDL like ALTER ROLE during migrate()) — serialize files, keep tests within a file
    // concurrent since those were written to be independent of each other.
    fileParallelism: false,
  },
});
