# P4.T3 discovery — leased/completed impulses and reconciliation

## Source facts

- `WorkflowRun.steps[].status` is the authoritative step status available to the frontend: `pending`, `leased`, `completed`, `failed`, `compensating`, or `compensated`.
- The fast lane observes in-flight runs; the medium lane observes all runs. Both can see the same status transition.
- `pulse-bus.ts` republishes `data-core.ts` events and does not poll independently.

## Required boundary

The theater must follow `leased` only, not `pending`; completion must be a real status transition or a current durable state, and a first observation after refresh must not replay a completion impulse.
