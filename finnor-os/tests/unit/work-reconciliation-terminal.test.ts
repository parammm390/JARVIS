import { describe, expect, it } from "vitest";
import { isImmutableWorkStatus, WORK_STATUSES } from "@finnor/db";

describe("Work reconciliation terminal fence", () => {
  it("freezes every terminal Work status until explicit continuation or recovery", () => {
    expect(WORK_STATUSES.filter(isImmutableWorkStatus)).toEqual(["completed", "failed", "cancelled"]);
    expect(isImmutableWorkStatus("executing")).toBe(false);
    expect(isImmutableWorkStatus("recovery")).toBe(false);
  });
});
