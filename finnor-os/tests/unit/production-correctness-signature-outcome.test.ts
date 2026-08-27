import { describe, expect, it } from "vitest";
import { signatureOutcomeStatus } from "../../packages/domain-plugins/proposal-signature/index";

describe("production-correctness signature outcome", () => {
  it.each([
    ["signed", "accepted"],
    ["declined", "declined"],
    ["expired", "expired"],
  ] as const)("maps %s to the shared quote/proposal terminal status %s", (outcome, expected) => {
    expect(signatureOutcomeStatus(outcome)).toBe(expected);
  });
});
