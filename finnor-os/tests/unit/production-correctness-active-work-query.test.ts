import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const route = readFileSync(
  fileURLToPath(new URL("../../apps/api/app/api/works/route.ts", import.meta.url)),
  "utf8",
);

describe("active Work discovery correctness", () => {
  it("excludes all immutable terminal states in SQL before the result limit", () => {
    const predicate = route.indexOf('notInArray(works.status, ["completed", "failed", "cancelled"])');
    const limit = route.indexOf(".limit(100)");

    expect(predicate).toBeGreaterThan(-1);
    expect(limit).toBeGreaterThan(predicate);
    expect(route).not.toMatch(/rows\.filter\(/);
  });
});
