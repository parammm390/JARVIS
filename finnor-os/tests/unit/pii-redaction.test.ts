import { describe, expect, it } from "vitest";
import { redactText } from "@finnor/security";

describe("PII text redaction", () => {
  it("redacts real phone and Luhn-valid card values", () => {
    const result = redactText("Call +1 (515) 555-0199 and charge 4111 1111 1111 1111.");
    expect(result.value).toContain("[PHONE_1]");
    expect(result.value).toContain("[CARD_1]");
  });

  it("preserves research year ranges and durable UUID receipt identifiers", () => {
    const uuid = "96717922-4784-4372-8211-657f15c733f2";
    const result = redactText(`Forecast 2025-2032; receipt ${uuid}.`);
    expect(result.value).toBe(`Forecast 2025-2032; receipt ${uuid}.`);
    expect([...result.tokens.keys()]).toEqual([]);
  });
});
