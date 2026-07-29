// jarvis-v3 P4.T6 — sandbox honesty (§8 PHASE 4): "Sandbox execution
// (create_payment_link/send_message resolving to sandbox_outbox) renders the
// literal string... — never disguised as a real send." Real, verified source
// (finnor-os/apps/worker/src/handlers/run-workflow-step.ts, packages/tools/src/
// capabilities/{accounting,crm}.ts): `create_payment_link`'s only non-Stripe
// binding is `"emulator"` (a pure in-memory fake — no sandbox_outbox row at
// all, since no real Stripe/payment-link provider is integrated this phase);
// `send_message`'s default/non-GHL binding is `"native"`, which really does
// write to `sandbox_outbox` (packages/tools/src/sandbox.ts's `recordOutbound`).
// Both are "not the real external provider" — that's the fact this literal
// exists to state plainly, regardless of which specific non-real binding ran.

import type { BindingResolution } from "./data-core"

export const SANDBOX_LITERAL = "Sent via sandbox — no carrier hop. Row in sandbox_outbox."

export interface SandboxBindings {
  payments?: BindingResolution
  crm?: BindingResolution
}

const STEP_CAPABILITY: Record<string, { capability: keyof SandboxBindings; realMode: string }> = {
  create_payment_link: { capability: "payments", realMode: "stripe" },
  send_message: { capability: "crm", realMode: "ghl" },
}

/** True only for the two step types this phase's own sandbox exists for, and
 *  only when the resolved binding for that capability genuinely isn't the
 *  real provider. Every other step type (sync_invoice, hold_appointment, …)
 *  returns false — this literal is never guessed onto a step it wasn't
 *  written for. `bindings` undefined (setup/status hasn't loaded yet) also
 *  returns false — never a guess before the real mode is known. */
export function isSandboxStep(stepType: string, bindings: SandboxBindings | undefined): boolean {
  if (!bindings) return false
  const entry = STEP_CAPABILITY[stepType]
  if (!entry) return false
  const resolved = bindings[entry.capability]
  return resolved !== undefined && resolved.mode !== entry.realMode
}
