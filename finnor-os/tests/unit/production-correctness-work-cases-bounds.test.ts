import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const source = readFileSync(fileURLToPath(new URL("../../packages/read-models/src/work-cases.ts", import.meta.url)), "utf8");
const route = readFileSync(fileURLToPath(new URL("../../apps/api/app/api/read-models/[view]/route.ts", import.meta.url)), "utf8");

describe("production-correctness bounded Work Cases", () => {
  it("pages canonical roots and scopes every historical child family to selected ids", () => {
    const projection = source.slice(source.indexOf("export async function workCasesPage"));
    expect(projection).toContain(".limit(limit + 1)");
    expect(projection).toContain("MAX_CHILD_ROWS_PER_TABLE + 1");
    expect(projection.match(/MAX_CHILD_ROWS_PER_TABLE \+ 1/g)?.length).toBeGreaterThanOrEqual(20);
    expect(projection).toContain("inArray(workEvents.workId, workIds)");
    expect(projection).toContain("inArray(domainActions.workId, workIds)");
    expect(projection).toContain("inArray(workflowRuns.workId, workIds)");
    expect(projection).toContain("inArray(decisionReceipts.workId, workIds)");
    expect(projection).not.toContain("db.select().from(calls).where(eq(calls.tenantId, tenantId))");
  });

  it("keeps the data array compatible while exposing truthful page and truncation metadata", () => {
    expect(route).toContain("data: result.items, page: result.page");
    expect(source).toContain('rootScope: "canonical_work" | "legacy_instruction"');
    expect(source).toContain("childRowsTruncated");
  });
});
