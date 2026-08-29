export const DEFAULT_INTERACTIVE_INTAKE_DEADLINE_MS = {
  voice: 8_000,
  text: 20_000,
  console: 20_000,
} as const;

const MIN_INTERACTIVE_INTAKE_DEADLINE_MS = 3_000;
const MAX_INTERACTIVE_INTAKE_DEADLINE_MS = 45_000;

export class InteractiveIntakeDeadlineError extends Error {
  readonly status = 504;

  constructor(readonly deadlineAt: number) {
    super("Interactive instruction deadline exceeded before a safe result was committed");
    this.name = "InteractiveIntakeDeadlineError";
  }
}

function configuredDeadlineMs(channel: keyof typeof DEFAULT_INTERACTIVE_INTAKE_DEADLINE_MS): number {
  const configured = Number(process.env.INTERACTIVE_INTAKE_DEADLINE_MS);
  if (!Number.isFinite(configured)) return DEFAULT_INTERACTIVE_INTAKE_DEADLINE_MS[channel];
  return Math.min(MAX_INTERACTIVE_INTAKE_DEADLINE_MS, Math.max(MIN_INTERACTIVE_INTAKE_DEADLINE_MS, Math.floor(configured)));
}

/** Create exactly one absolute deadline for an accepted interactive intake. */
export function createInteractiveIntakeDeadline(
  channel: keyof typeof DEFAULT_INTERACTIVE_INTAKE_DEADLINE_MS,
  now = Date.now(),
): number {
  return now + configuredDeadlineMs(channel);
}

export function requireInteractiveIntakeTime(deadlineAt: number, now = Date.now()): number {
  const remaining = deadlineAt - now;
  if (!Number.isFinite(deadlineAt) || remaining <= 0) throw new InteractiveIntakeDeadlineError(deadlineAt);
  return remaining;
}
