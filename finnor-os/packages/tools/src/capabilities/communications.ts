// Communications capability contract (Phase 2 proof domain). Two bindings prove the
// same contract: `emulator` (fault-injecting in-memory double) and `vapi` — the actual
// existing real adapter (placeVapiCall, packages/tools/src/vapi-rest.ts), rebound to
// the identical contract. Communications has no meaningful compensate(): you can't
// unsend a placed call, so this contract's compensation proof is intentionally not
// exercised here — the scheduling contract's release_hold covers proof item 4.

import { z } from "zod";
import type { CapabilityContract, CapabilityBinding, RetryPolicy } from "@finnor/workflow-runtime";
import { placeVapiCall } from "../vapi-rest";
import { withCircuitBreaker } from "../provider-circuit-breaker";
import { claimBudget } from "../provider-budget";
import {
  emulatorSendConfirmation,
  emulatorReconcileCall,
  type SendConfirmationInput,
  type SendConfirmationOutput,
} from "../emulators/communications-emulator";

// Phase 4 (§4.4): real, configurable daily cap on outbound Vapi calls per tenant —
// no per-tenant override mechanism yet (that's a domain_policies field, future work),
// but the cap itself is real and enforced here, not advisory.
const DAILY_VAPI_CALL_CAP = Number(process.env.VAPI_DAILY_CALL_CAP ?? 200);

export type { SendConfirmationInput, SendConfirmationOutput };

export const SendConfirmationInputSchema = z.object({
  tenantId: z.string().uuid(),
  phoneNumber: z.string().min(7),
  message: z.string().min(1),
  idempotencyKey: z.string().min(1),
});

export const SendConfirmationOutputSchema = z.object({
  callId: z.string(),
  status: z.literal("placed"),
});

const RETRY_POLICY: RetryPolicy = { attempts: 3, baseDelayMs: 200, timeoutMs: 8_000 };

export const sendConfirmationContract: CapabilityContract<SendConfirmationInput, SendConfirmationOutput> = {
  domain: "communications",
  capability: "send_confirmation_call",
  version: 1,
  idempotencyKeyFrom: (input) => input.idempotencyKey,
  retryPolicy: RETRY_POLICY,
  requiredPermission: "communications:send_confirmation_call",
  piiAllowlist: ["phoneNumber", "message"],
  // A crash after the call is actually placed but before we recorded it must never be
  // auto-retried — a blind retry could place a second real phone call.
  retryOnUnknown: false,
};

export const emulatorCommunicationsBinding: CapabilityBinding<SendConfirmationInput, SendConfirmationOutput> = {
  name: "emulator",
  call: emulatorSendConfirmation,
  reconcile: emulatorReconcileCall,
  // Communications has no compensate() — you can't unsend a call/SMS. Left undefined
  // deliberately; packages/workflow-runtime/src/compensation.ts's compensateStep()
  // handles a missing compensate() as an explicit failed compensation_case, never a
  // silent no-op.
};

export function isVapiConfigured(): boolean {
  return Boolean(
    process.env.VAPI_API_KEY &&
      process.env.VAPI_PHONE_NUMBER_ID &&
      process.env.VAPI_PHONE_NUMBER_ID !== "PLACEHOLDER_NEEDS_REAL_VALUE" &&
      process.env.VAPI_ASSISTANT_ID,
  );
}

async function vapiSendConfirmation(input: SendConfirmationInput): Promise<SendConfirmationOutput> {
  // Phase 4 (§4.4): real per-tenant daily cap, checked BEFORE the breaker/call — a
  // tenant that's already hit its cap must never place another real call, breaker
  // state notwithstanding.
  const budget = await claimBudget(input.tenantId, "vapi", "call", DAILY_VAPI_CALL_CAP);
  if (!budget.allowed) {
    throw new Error(`degraded: vapi daily call cap reached for tenant (${budget.used}/${budget.cap})`);
  }

  const { callId } = await withCircuitBreaker("vapi", async () => {
    const r = await placeVapiCall({
      customerNumber: input.phoneNumber,
      firstMessage: input.message,
      metadata: { tenantId: input.tenantId, idempotencyKey: input.idempotencyKey },
    });
    if (!r.ok) throw new Error(r.error ?? "Vapi call failed");
    return { callId: String((r.output as Record<string, unknown>).id ?? input.idempotencyKey) };
  });

  return { callId, status: "placed" };
}

export const vapiCommunicationsBinding: CapabilityBinding<SendConfirmationInput, SendConfirmationOutput> = {
  name: "vapi",
  call: vapiSendConfirmation,
};
