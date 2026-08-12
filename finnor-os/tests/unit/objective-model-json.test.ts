import { describe, expect, it } from "vitest";
import { parseObjectiveModelJson } from "@finnor/orchestration";

describe("objective model JSON boundary", () => {
  it("accepts one JSON decision with provider prose or a markdown fence", () => {
    const decision = { kind: "complete", outcome: { observed: true }, reason: "Canonical state is sufficient." };
    expect(parseObjectiveModelJson(`Here is the bounded decision:\n${JSON.stringify(decision)}\nNo action was taken.`)).toEqual(decision);
    expect(parseObjectiveModelJson(`\`\`\`json\n${JSON.stringify(decision)}\n\`\`\``)).toEqual(decision);
  });

  it("rejects multiple JSON decisions and malformed JSON", () => {
    expect(() => parseObjectiveModelJson('{"kind":"complete"}\n{"kind":"action"}')).toThrow(/more than one JSON value/);
    expect(() => parseObjectiveModelJson("not json at all")).toThrow();
  });
});
