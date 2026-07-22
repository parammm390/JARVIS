// run_workflow_step job: drives one workflow_steps row through the durable execution
// runtime (@finnor/workflow-runtime). Binding selection (emulator vs. the real
// implementation) is an env-var switch per domain, exactly like commsMode() in
// packages/tools/src/builtin-tools.ts — the binding config is the only thing that
// differs between a test run and production. Step types are dispatched through a
// registry (STEP_HANDLERS) rather than hand-written if-branches, since Phase 4-6's
// vertical workflows add many more step types on top of Phase 2's original two.

import { claimStep, completeStep, failStep, advanceWorkflow, recoverStaleSteps, executeCapability } from "@finnor/workflow-runtime";
import type { CapabilityContract, CapabilityBinding } from "@finnor/workflow-runtime";
import { withTenant } from "@finnor/db";
import { createWorkOrder, recordPayment } from "@finnor/data-platform";
import {
  holdAppointmentContract,
  emulatorSchedulingBinding,
  nativeSchedulingBinding,
  confirmAppointmentContract,
  confirmAppointmentEmulatorBinding,
  confirmAppointmentNativeBinding,
  sendConfirmationContract,
  emulatorCommunicationsBinding,
  vapiCommunicationsBinding,
  generateDocumentContract,
  generateDocumentEmulatorBinding,
  generateDocumentNativeBinding,
  requestSignatureContract,
  requestSignatureEmulatorBinding,
  requestSignatureDocusignBinding,
  reserveStockContract,
  reserveStockEmulatorBinding,
  reserveStockNativeBinding,
  receiveProcurementContract,
  receiveProcurementEmulatorBinding,
  receiveProcurementNativeBinding,
  syncInvoiceContract,
  syncInvoiceEmulatorBinding,
  syncInvoiceQuickbooksBinding,
  createPaymentLinkContract,
  createPaymentLinkEmulatorBinding,
  stripeCreatePaymentLinkBinding,
  upsertContactContract,
  upsertContactEmulatorBinding,
  upsertContactNativeBinding,
  upsertContactGhlBinding,
  sendMessageContract,
  sendMessageEmulatorBinding,
  sendMessageNativeBinding,
  sendMessageGhlBinding,
  launchAdCampaignContract,
  launchAdCampaignEmulatorBinding,
  launchAdCampaignDryRunBinding,
  resolveCapabilityBindingsForTenant,
} from "@finnor/tools";
import type { JobHandler } from "../queue";

// Binding *selection logic* (mode + source — tenant-row override first (A3.T1), then
// native-by-default for Finnor-owned caps since A1.T2, emulator-by-default for external
// caps) lives in one place — @finnor/tools' resolveCapabilityBindingsForTenant() —
// shared with apps/api's /api/setup/status report so the two can never drift apart.
// This file only maps a resolved mode string to the actual CapabilityBinding object to
// call, per-tenant since a tenant_integrations row is scoped to one tenant.
async function schedulingBinding(tenantId: string): Promise<CapabilityBinding<unknown, unknown>> {
  const bindings = await resolveCapabilityBindingsForTenant(tenantId);
  return (bindings.scheduling.mode === "emulator" ? emulatorSchedulingBinding : nativeSchedulingBinding) as CapabilityBinding<unknown, unknown>;
}
async function confirmBinding(tenantId: string): Promise<CapabilityBinding<unknown, unknown>> {
  const bindings = await resolveCapabilityBindingsForTenant(tenantId);
  return (bindings.scheduling.mode === "emulator" ? confirmAppointmentEmulatorBinding : confirmAppointmentNativeBinding) as CapabilityBinding<
    unknown,
    unknown
  >;
}
async function communicationsBinding(tenantId: string): Promise<CapabilityBinding<unknown, unknown>> {
  const bindings = await resolveCapabilityBindingsForTenant(tenantId);
  return (bindings.communications.mode === "vapi" ? vapiCommunicationsBinding : emulatorCommunicationsBinding) as CapabilityBinding<unknown, unknown>;
}
async function documentsBinding(tenantId: string): Promise<CapabilityBinding<unknown, unknown>> {
  const bindings = await resolveCapabilityBindingsForTenant(tenantId);
  return (bindings.documents.mode === "emulator" ? generateDocumentEmulatorBinding : generateDocumentNativeBinding) as CapabilityBinding<unknown, unknown>;
}
async function esignBinding(tenantId: string): Promise<CapabilityBinding<unknown, unknown>> {
  const bindings = await resolveCapabilityBindingsForTenant(tenantId);
  return (bindings.esign.mode === "docusign" ? requestSignatureDocusignBinding : requestSignatureEmulatorBinding) as CapabilityBinding<unknown, unknown>;
}
async function inventoryReserveBinding(tenantId: string): Promise<CapabilityBinding<unknown, unknown>> {
  const bindings = await resolveCapabilityBindingsForTenant(tenantId);
  return (bindings.inventory.mode === "emulator" ? reserveStockEmulatorBinding : reserveStockNativeBinding) as CapabilityBinding<unknown, unknown>;
}
async function inventoryReceiveBinding(tenantId: string): Promise<CapabilityBinding<unknown, unknown>> {
  const bindings = await resolveCapabilityBindingsForTenant(tenantId);
  return (bindings.inventory.mode === "emulator" ? receiveProcurementEmulatorBinding : receiveProcurementNativeBinding) as CapabilityBinding<
    unknown,
    unknown
  >;
}
async function accountingSyncBinding(tenantId: string): Promise<CapabilityBinding<unknown, unknown>> {
  const bindings = await resolveCapabilityBindingsForTenant(tenantId);
  return (bindings.accounting.mode === "quickbooks" ? syncInvoiceQuickbooksBinding : syncInvoiceEmulatorBinding) as CapabilityBinding<unknown, unknown>;
}
async function paymentLinkBinding(tenantId: string): Promise<CapabilityBinding<unknown, unknown>> {
  const bindings = await resolveCapabilityBindingsForTenant(tenantId);
  return (bindings.payments.mode === "stripe" ? stripeCreatePaymentLinkBinding : createPaymentLinkEmulatorBinding) as CapabilityBinding<unknown, unknown>;
}
async function crmUpsertContactBinding(tenantId: string): Promise<CapabilityBinding<unknown, unknown>> {
  const mode = (await resolveCapabilityBindingsForTenant(tenantId)).crm.mode;
  return (mode === "ghl" ? upsertContactGhlBinding : mode === "emulator" ? upsertContactEmulatorBinding : upsertContactNativeBinding) as CapabilityBinding<
    unknown,
    unknown
  >;
}
async function crmSendMessageBinding(tenantId: string): Promise<CapabilityBinding<unknown, unknown>> {
  const mode = (await resolveCapabilityBindingsForTenant(tenantId)).crm.mode;
  return (mode === "ghl" ? sendMessageGhlBinding : mode === "emulator" ? sendMessageEmulatorBinding : sendMessageNativeBinding) as CapabilityBinding<
    unknown,
    unknown
  >;
}
async function marketingLaunchBinding(tenantId: string): Promise<CapabilityBinding<unknown, unknown>> {
  const bindings = await resolveCapabilityBindingsForTenant(tenantId);
  return (bindings.marketing.mode === "dry_run" ? launchAdCampaignDryRunBinding : launchAdCampaignEmulatorBinding) as CapabilityBinding<unknown, unknown>;
}

interface StepHandlerEntry {
  contract: CapabilityContract<unknown, unknown>;
  resolveBinding: (tenantId: string) => Promise<CapabilityBinding<unknown, unknown>>;
  /** Transforms the step's stored payload (which carries forward prior completed
   *  steps' output under `payload.context.<stepType>` — see advanceWorkflow()) into
   *  the exact shape this capability's input schema expects. Omit when the step's own
   *  payload already matches (the common case). */
  mapPayload?: (payload: Record<string, unknown>) => Record<string, unknown>;
}

const STEP_HANDLERS: Record<string, StepHandlerEntry> = {
  hold_appointment: { contract: holdAppointmentContract as CapabilityContract<unknown, unknown>, resolveBinding: schedulingBinding },
  confirm_appointment: {
    contract: confirmAppointmentContract as CapabilityContract<unknown, unknown>,
    resolveBinding: confirmBinding,
    mapPayload: (payload) => {
      const context = (payload.context as Record<string, { holdId?: string }> | undefined) ?? {};
      return {
        tenantId: payload.tenantId,
        idempotencyKey: payload.idempotencyKey,
        holdId: context.hold_appointment?.holdId,
      };
    },
  },
  send_confirmation_call: { contract: sendConfirmationContract as CapabilityContract<unknown, unknown>, resolveBinding: communicationsBinding },
  generate_document: { contract: generateDocumentContract as CapabilityContract<unknown, unknown>, resolveBinding: documentsBinding },
  request_signature: {
    contract: requestSignatureContract as CapabilityContract<unknown, unknown>,
    resolveBinding: esignBinding,
    mapPayload: (payload) => {
      const context = (payload.context as Record<string, { documentId?: string }> | undefined) ?? {};
      return {
        tenantId: payload.tenantId,
        idempotencyKey: payload.idempotencyKey,
        signerName: payload.signerName,
        signerEmail: payload.signerEmail,
        documentId: context.generate_document?.documentId,
        proposalId: payload.proposalId,
      };
    },
  },
  reserve_stock: { contract: reserveStockContract as CapabilityContract<unknown, unknown>, resolveBinding: inventoryReserveBinding },
  receive_procurement: { contract: receiveProcurementContract as CapabilityContract<unknown, unknown>, resolveBinding: inventoryReceiveBinding },
  sync_invoice: { contract: syncInvoiceContract as CapabilityContract<unknown, unknown>, resolveBinding: accountingSyncBinding },
  create_payment_link: {
    contract: createPaymentLinkContract as CapabilityContract<unknown, unknown>,
    resolveBinding: paymentLinkBinding,
  },
  upsert_contact: { contract: upsertContactContract as CapabilityContract<unknown, unknown>, resolveBinding: crmUpsertContactBinding },
  send_message: {
    contract: sendMessageContract as CapabilityContract<unknown, unknown>,
    resolveBinding: crmSendMessageBinding,
    // Supports a `{{paymentLinkUrl}}` token in `message`/`messageTemplate`, filled in
    // from an earlier create_payment_link step's carried-forward context — e.g. the
    // invoice-to-cash workflow's "deliver the payment link" step.
    mapPayload: (payload) => {
      const context = (payload.context as Record<string, { paymentLinkUrl?: string }> | undefined) ?? {};
      let message = String(payload.message ?? payload.messageTemplate ?? "");
      if (context.create_payment_link?.paymentLinkUrl) {
        message = message.replaceAll("{{paymentLinkUrl}}", context.create_payment_link.paymentLinkUrl);
      }
      return { tenantId: payload.tenantId, contactId: payload.contactId, message, channel: payload.channel, idempotencyKey: payload.idempotencyKey };
    },
  },
  launch_ad_campaign: { contract: launchAdCampaignContract as CapabilityContract<unknown, unknown>, resolveBinding: marketingLaunchBinding },
};

/**
 * Steps with no external capability to call — a pure internal DB write (creating a
 * work order, recording a payment already collected) still needs the SAME lease/
 * idempotency/evidence machinery as a capability step (so it survives a crash and
 * carries its output forward via `context`), it just has nothing to claim an
 * integration_operations row for. Handled separately from STEP_HANDLERS rather than
 * forcing a fake CapabilityContract onto something with no external side effect.
 */
const INTERNAL_STEP_HANDLERS: Record<string, (tenantId: string, payload: Record<string, unknown>) => Promise<Record<string, unknown>>> = {
  create_work_order: async (tenantId, payload) => {
    return withTenant(tenantId, (db) =>
      createWorkOrder(db, {
        tenantId,
        householdId: String(payload.householdId),
        type: (payload.workOrderType as "install" | "repair" | "warranty" | "other") ?? "install",
        quoteId: payload.quoteId ? String(payload.quoteId) : undefined,
        depositAmountUsd: payload.depositAmountUsd !== undefined ? Number(payload.depositAmountUsd) : undefined,
      }),
    ) as unknown as Record<string, unknown>;
  },
  record_deposit_payment: async (tenantId, payload) => {
    return withTenant(tenantId, (db) =>
      recordPayment(db, {
        tenantId,
        invoiceId: String(payload.invoiceId),
        amountUsd: Number(payload.amountUsd),
        method: "card",
        provenance: { sourceSystem: "workflow:signed_proposal_to_installation" },
      }),
    ) as unknown as Record<string, unknown>;
  },
};

export const runWorkflowStep: JobHandler = async (payload) => {
  const tenantId = String(payload.tenantId ?? "");
  const stepId = String(payload.workflowStepId ?? "");
  if (!tenantId || !stepId) throw new Error("run_workflow_step requires tenantId and workflowStepId");

  // Same lease-recovery discipline as recoverExpiredRunningJobs() at the top of
  // JobQueue.tick() — reclaim any step this tenant left stuck before claiming this one.
  await recoverStaleSteps(tenantId);

  const claimed = await claimStep(tenantId, stepId);
  if (!claimed) return; // already leased/completed elsewhere — duplicate delivery, safe no-op

  try {
    const internalHandler = INTERNAL_STEP_HANDLERS[claimed.stepType];
    if (internalHandler) {
      const output = await internalHandler(tenantId, claimed.payload as Record<string, unknown>);
      await completeStep(tenantId, stepId, { output });
      await advanceWorkflow(tenantId, claimed.workflowRunId);
      return;
    }

    const entry = STEP_HANDLERS[claimed.stepType];
    if (!entry) throw new Error(`No handler for workflow step type "${claimed.stepType}"`);

    const input = entry.mapPayload ? entry.mapPayload(claimed.payload as Record<string, unknown>) : claimed.payload;
    const result = await executeCapability(tenantId, stepId, entry.contract, await entry.resolveBinding(tenantId), input);
    if (!result.ok) {
      await failStep(tenantId, stepId, result.error);
      return;
    }
    await completeStep(tenantId, stepId, { output: result.output as Record<string, unknown> });
    await advanceWorkflow(tenantId, claimed.workflowRunId);
  } catch (err) {
    await failStep(tenantId, stepId, (err as Error).message);
  }
};
