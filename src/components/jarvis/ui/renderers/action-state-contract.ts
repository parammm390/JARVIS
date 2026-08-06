// P1.T8 — every registered action has a designed contract for each terminal and
// approval state. The actual state machine lives in kernel/execution-presentation;
// this registry-level contract prevents a renderer from silently dropping a state.

export const CERTIFIED_ACTION_STATES = ["pending", "approved", "executing", "completed", "failed", "blocked"] as const;
export type CertifiedActionState = (typeof CERTIFIED_ACTION_STATES)[number];
