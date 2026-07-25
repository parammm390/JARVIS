import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { renderAuthzMatrix } from "../../scripts/generate-authz-matrix";

describe("authorization matrix", () => {
  it("is derived from every API route and records its guard pattern", async () => {
    const rendered = await renderAuthzMatrix();
    const committed = await readFile(join(import.meta.dirname, "..", "..", "docs", "authz-matrix.md"), "utf8");
    expect(rendered).toBe(committed);
    expect(rendered).toContain("`/api/actions`");
    expect(rendered).toContain("webhook signature / provider verification");
    expect(rendered).toContain("ADMIN_SECRET");
  });
});
