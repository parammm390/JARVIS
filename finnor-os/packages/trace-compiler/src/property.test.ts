import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { compileProcedureCandidate } from "./compiler";
import { normalizedTraceBytes } from "./normalize";
import { P6_OPTIONS, reminderTrace } from "../fixtures/locked-corpus";

describe("deterministic properties", () => {
  it("is byte-stable across cloned corpora for fixed clock, seed, versions, and salt", () => {
    fc.assert(fc.property(
      fc.integer({ min: 1, max: 1_000_000 }),
      fc.constantFrom<"SMS" | "EMAIL">("SMS", "EMAIL"),
      fc.boolean(),
      (amount, channel, optionalStep) => {
        const config = { suffix: `property-${amount}-${channel}-${optionalStep}`, amount, channel, optionalStep };
        const traceA = reminderTrace(config);
        const traceB = reminderTrace(structuredClone(config));
        expect(normalizedTraceBytes(traceB)).toBe(normalizedTraceBytes(traceA));
        const first = compileProcedureCandidate([traceA], P6_OPTIONS);
        const second = compileProcedureCandidate([traceB], structuredClone(P6_OPTIONS));
        expect(JSON.stringify(second)).toBe(JSON.stringify(first));
      },
    ), { numRuns: 50, seed: P6_OPTIONS.seed });
  });

  it("uses stable semantic tie-breaking regardless of corpus order", () => {
    const a = reminderTrace({ suffix: "order-a", amount: 100 });
    const b = reminderTrace({ suffix: "order-b", amount: 200 });
    const forward = compileProcedureCandidate([a, b], P6_OPTIONS);
    const reverse = compileProcedureCandidate([b, a], P6_OPTIONS);
    expect(JSON.stringify(reverse)).toBe(JSON.stringify(forward));
  });
});
