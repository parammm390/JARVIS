import { describe, expect, it } from "vitest";
import { extractNamedExpressions } from "../../packages/orchestration/src/conversation-kernel";

describe("production-correctness entity expression extraction", () => {
  it.each([
    ["email jane smith", "jane smith", "party"],
    ["call JANE SMITH", "JANE SMITH", "party"],
    ["reschedule jane appointment", "jane", "appointment"],
    ["send the acme invoice", "acme", "invoice"],
  ])("extracts capitalization-independent targets from %s", (instruction, name, cue) => {
    expect(extractNamedExpressions(instruction)).toEqual(expect.arrayContaining([
      expect.objectContaining({ name, cue }),
    ]));
  });
});
