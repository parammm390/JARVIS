import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const accounting = readFileSync(
  fileURLToPath(new URL("../../packages/domain-plugins/accounting/index.ts", import.meta.url)),
  "utf8",
);

describe("accounting reminder delivery evidence", () => {
  it("never reports a delivered reminder as successful when canonical history is missing", () => {
    expect(accounting).not.toMatch(/db\.insert\(communicationsLog\)[\s\S]{0,300}\.catch\(\(\) => undefined\)/);
    expect(accounting).toContain("delivered without canonical history");
    expect(accounting).toContain("deliveredUnrecorded: true");
    expect(accounting.match(/errorKind: "needs_human"/g)).toHaveLength(2);
  });
});
