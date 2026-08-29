import { afterEach, describe, expect, it } from "vitest";
import {
  createInteractiveIntakeDeadline,
  InteractiveIntakeDeadlineError,
  requireInteractiveIntakeTime,
} from "../../apps/api/lib/intake-deadline";

const previous = process.env.INTERACTIVE_INTAKE_DEADLINE_MS;

afterEach(() => {
  if (previous === undefined) delete process.env.INTERACTIVE_INTAKE_DEADLINE_MS;
  else process.env.INTERACTIVE_INTAKE_DEADLINE_MS = previous;
});

describe("absolute interactive intake deadline", () => {
  it("creates one channel-specific absolute timestamp", () => {
    delete process.env.INTERACTIVE_INTAKE_DEADLINE_MS;
    expect(createInteractiveIntakeDeadline("voice", 1_000)).toBe(9_000);
    expect(createInteractiveIntakeDeadline("text", 1_000)).toBe(21_000);
  });

  it("clamps configuration and always consumes the same absolute timestamp", () => {
    process.env.INTERACTIVE_INTAKE_DEADLINE_MS = "999999";
    const deadlineAt = createInteractiveIntakeDeadline("text", 10_000);
    expect(deadlineAt).toBe(55_000);
    expect(requireInteractiveIntakeTime(deadlineAt, 25_000)).toBe(30_000);
    expect(requireInteractiveIntakeTime(deadlineAt, 54_999)).toBe(1);
  });

  it("fails visibly once no intake budget remains", () => {
    expect(() => requireInteractiveIntakeTime(2_000, 2_000)).toThrow(InteractiveIntakeDeadlineError);
    try {
      requireInteractiveIntakeTime(2_000, 2_001);
    } catch (error) {
      expect(error).toMatchObject({ status: 504, deadlineAt: 2_000 });
    }
  });
});
