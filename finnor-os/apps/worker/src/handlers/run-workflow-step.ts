// run_workflow_step job: drives one workflow_steps row through the durable execution
// runtime (@finnor/workflow-runtime). Binding selection (emulator vs. the real
// implementation) is an env-var switch per domain, exactly like commsMode() in
// packages/tools/src/builtin-tools.ts — the binding config is the only thing that
// differs between a test run and production. Step types are dispatched through a
// registry (STEP_HANDLERS) rather than hand-written if-branches, since Phase 4-6's
// vertical workflows add many more step types on top of Phase 2's original two.

import { claimStep, completeStep, failStep, advanceWorkflow, recoverStaleSteps, executeCapability, openReconciliationCase } from "@finnor/workflow-runtime";
import type { CapabilityContract, CapabilityBinding } from "@finnor/workflow-runtime";
import { businessEffects, commands, domainActions, integrationOperations, reconciliationCases, reconcileWorkStatus, workflowRuns, workflowSteps, withTenant } from "@finnor/db";
import { and, eq, sql } from "drizzle-orm";
import { executeAuthorizedEffectStep, FinnorOrchestrator, revalidateAuthorizedEffectEligibility, resumeObjectiveForAction } from "@finnor/orchestration";
import { createWorkOrder, recordPayment } from "@finnor/data-platform";
import { createHash } from "node:crypto";
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

type InternalOperationClaim =
  | { kind: "execute"; operationKey: string }
  | { kind: "replay"; operationKey: string; output: Record<string, unknown> }
  | { kind: "reconcile" };

/** Internal Postgres mutations need the same crash boundary as provider calls. The
 * ledger row is committed before the handler transaction starts. If the process dies
 * after that transaction commits but before acknowledgement, recovery sees `running`
 * and reconciles instead of performing the mutation again. */
async function claimInternalOperation(
  tenantId: string,
  step: typeof workflowSteps.$inferSelect,
): Promise<InternalOperationClaim> {
  const operationKey = `internal:${step.stepType}:${step.id}`;
  const requestHash = createHash("sha256").update(JSON.stringify(step.payload)).digest("hex");
  const claim = await withTenant(tenantId, async (db) => {
    const [inserted] = await db.insert(integrationOperations).values({
      tenantId,
      workflowStepId: step.id,
      businessEffectId: step.businessEffectId,
      operationKey,
      capability: `internal:${step.stepType}`,
      provider: "finnor_postgres",
      requestHash,
      status: "running",
    }).onConflictDoNothing({ target: [integrationOperations.workflowStepId, integrationOperations.operationKey] }).returning();
    if (inserted) return { inserted: true as const };
    const [existing] = await db.select().from(integrationOperations).where(and(
      eq(integrationOperations.tenantId, tenantId),
      eq(integrationOperations.workflowStepId, step.id),
      eq(integrationOperations.operationKey, operationKey),
    )).limit(1);
    return { inserted: false as const, existing };
  });
  if (claim.inserted) return { kind: "execute", operationKey };
  const existing = claim.existing;
  if (!existing || existing.requestHash !== requestHash || existing.businessEffectId !== step.businessEffectId) {
    throw new Error("Internal operation identity conflicts with the authorized workflow step");
  }
  if (existing.status === "succeeded") {
    return { kind: "replay", operationKey, output: (existing.response ?? {}) as Record<string, unknown> };
  }
  if (existing.status === "running" || existing.status === "unknown") {
    const [openCase] = await withTenant(tenantId, (db) => db.select({ id: reconciliationCases.id }).from(reconciliationCases).where(and(
      eq(reconciliationCases.tenantId, tenantId),
      eq(reconciliationCases.relatedStepId, step.id),
      eq(reconciliationCases.status, "open"),
    )).limit(1));
    if (!openCase) await openReconciliationCase(tenantId, {
      caseType: "unknown_delivery",
      relatedStepId: step.id,
      businessEffectId: step.businessEffectId ?? undefined,
      details: { operationKey, capability: `internal:${step.stepType}` },
    });
    await withTenant(tenantId, async (db) => {
      await db.update(integrationOperations).set({ status: "unknown", updatedAt: new Date() }).where(and(
        eq(integrationOperations.tenantId, tenantId),
        eq(integrationOperations.id, existing.id),
        eq(integrationOperations.status, "running"),
      ));
      await db.update(workflowSteps).set({ executionState: "reconciling", leaseExpiresAt: null, updatedAt: new Date() }).where(and(
        eq(workflowSteps.tenantId, tenantId), eq(workflowSteps.id, step.id),
      ));
      if (step.businessEffectId) await db.update(businessEffects).set({ status: "reconciliation_required" }).where(and(
        eq(businessEffects.tenantId, tenantId), eq(businessEffects.id, step.businessEffectId),
      ));
      if (step.domainActionId) await db.update(domainActions).set({ status: "needs_human_review", executionStartedAt: null }).where(and(
        eq(domainActions.tenantId, tenantId), eq(domainActions.id, step.domainActionId),
      ));
    });
    return { kind: "reconcile" };
  }
  await withTenant(tenantId, (db) => db.update(integrationOperations).set({ status: "running", response: null, updatedAt: new Date() }).where(and(
    eq(integrationOperations.tenantId, tenantId),
    eq(integrationOperations.id, existing.id),
    eq(integrationOperations.status, "failed"),
  )));
  return { kind: "execute", operationKey };
}

/** Each consequential workflow step has its own effect commit point. The parent
 * single-action worker already froze/revalidated the EffectSet before creating the
 * child workflow; this check revalidates revocation/cancellation immediately before
 * every later mutation and atomically records that the step may now have an effect. */
async function beginWorkflowStepEffect(tenantId: string, step: typeof workflowSteps.$inferSelect): Promise<boolean> {
  if (!step.domainActionId || !step.businessEffectId) return true;
  const [boundary] = await withTenant(tenantId, (db) => db.select({
    commandEffectId: commands.businessEffectId,
    authorizedEffectHash: commands.authorizedEffectHash,
    effectHash: businessEffects.semanticHash,
    effectActionId: businessEffects.domainActionId,
  }).from(workflowSteps)
    .innerJoin(workflowRuns, and(eq(workflowRuns.tenantId, tenantId), eq(workflowRuns.id, workflowSteps.workflowRunId)))
    .innerJoin(commands, and(eq(commands.tenantId, tenantId), eq(commands.id, workflowRuns.commandId)))
    .innerJoin(businessEffects, and(eq(businessEffects.tenantId, tenantId), eq(businessEffects.id, workflowSteps.businessEffectId)))
    .where(and(eq(workflowSteps.tenantId, tenantId), eq(workflowSteps.id, step.id))).limit(1));
  if (!boundary || boundary.commandEffectId !== step.businessEffectId
      || boundary.authorizedEffectHash !== boundary.effectHash
      || boundary.effectActionId !== step.domainActionId) return false;
  const eligibility = await revalidateAuthorizedEffectEligibility(tenantId, step.domainActionId, step.businessEffectId);
  if (!eligibility.allowed) {
    await withTenant(tenantId, async (db) => {
      await db.update(workflowSteps).set({ executionState: "blocked", status: "failed", terminalReason: eligibility.reason, leaseExpiresAt: null })
        .where(and(eq(workflowSteps.tenantId, tenantId), eq(workflowSteps.id, step.id), eq(workflowSteps.executionState, "claimed")));
      await db.update(domainActions).set({ status: "needs_human_review", executionStartedAt: null })
        .where(and(eq(domainActions.tenantId, tenantId), eq(domainActions.id, step.domainActionId!)));
    });
    return false;
  }
  return withTenant(tenantId, async (db) => {
    const [commit] = await db.update(workflowSteps).set({ executionState: "commit_started", effectCommitAt: new Date(), updatedAt: new Date() })
      .where(and(
        eq(workflowSteps.tenantId, tenantId),
        eq(workflowSteps.id, step.id),
        eq(workflowSteps.status, "leased"),
        eq(workflowSteps.executionState, "claimed"),
        // A cancel transaction that wins first flips the run state, so this
        // predicate makes cancellation-before-commit a hard no-effect guarantee.
        sql`${workflowSteps.workflowRunId} IN (SELECT id FROM ${workflowRuns} WHERE tenant_id=${tenantId}::uuid AND status='running')`,
      )).returning({ id: workflowSteps.id });
    return Boolean(commit);
  });
}

async function resumeBusinessControllers(tenantId: string, domainActionId: string | null): Promise<void> {
  if (!domainActionId) return;
  const [action] = await withTenant(tenantId, (db) => db.select({ workId: domainActions.workId }).from(domainActions)
    .where(and(eq(domainActions.tenantId, tenantId), eq(domainActions.id, domainActionId))).limit(1));
  if (action?.workId) await reconcileWorkStatus(tenantId, action.workId);
  await resumeObjectiveForAction(tenantId, domainActionId).catch(() => false);
  await new FinnorOrchestrator().resumePlanForAction(domainActionId, tenantId).catch(() => false);
}

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
    if (claimed.stepType === "execute_authorized_effect") {
      await executeAuthorizedEffectStep(tenantId, stepId);
      await resumeBusinessControllers(tenantId, claimed.domainActionId);
      return;
    }
    if (!(await beginWorkflowStepEffect(tenantId, claimed))) {
      await failStep(tenantId, stepId, "Execution was cancelled or authority was invalidated before the step effect commit point", "conflict");
      return;
    }
    const internalHandler = INTERNAL_STEP_HANDLERS[claimed.stepType];
    if (internalHandler) {
      const internalClaim = await claimInternalOperation(tenantId, claimed);
      if (internalClaim.kind === "reconcile") return;
      let output = internalClaim.kind === "replay" ? internalClaim.output : undefined;
      if (!output) {
        try {
          output = await internalHandler(tenantId, claimed.payload as Record<string, unknown>);
        } catch (error) {
          await withTenant(tenantId, (db) => db.update(integrationOperations).set({
            status: "failed",
            response: { error: error instanceof Error ? error.message : "Internal mutation failed" },
            updatedAt: new Date(),
          }).where(and(
            eq(integrationOperations.tenantId, tenantId),
            eq(integrationOperations.workflowStepId, stepId),
            eq(integrationOperations.operationKey, internalClaim.operationKey),
          )));
          throw error;
        }
        await withTenant(tenantId, (db) => db.update(integrationOperations).set({ status: "succeeded", response: output, updatedAt: new Date() }).where(and(
          eq(integrationOperations.tenantId, tenantId),
          eq(integrationOperations.workflowStepId, stepId),
          eq(integrationOperations.operationKey, internalClaim.operationKey),
        )));
      }
      await withTenant(tenantId, (db) => db.update(workflowSteps).set({ executionState: "verified" }).where(and(eq(workflowSteps.tenantId, tenantId), eq(workflowSteps.id, stepId))));
      await completeStep(tenantId, stepId, { output });
      await advanceWorkflow(tenantId, claimed.workflowRunId);
      await resumeBusinessControllers(tenantId, claimed.domainActionId);
      return;
    }

    const entry = STEP_HANDLERS[claimed.stepType];
    if (!entry) throw new Error(`No handler for workflow step type "${claimed.stepType}"`);

    const mapped = entry.mapPayload ? entry.mapPayload(claimed.payload as Record<string, unknown>) : claimed.payload as Record<string, unknown>;
    const [origin] = claimed.domainActionId
      ? await withTenant(tenantId, (db) => db.select({
          initiatedBy: domainActions.initiatedBy,
          actionType: domainActions.actionType,
          payload: domainActions.payload,
        }).from(domainActions).where(and(
          eq(domainActions.tenantId, tenantId),
          eq(domainActions.id, claimed.domainActionId!),
        )).limit(1))
      : [];
    const originPayload = origin?.payload && typeof origin.payload === "object" && !Array.isArray(origin.payload)
      ? origin.payload as Record<string, unknown>
      : {};
    // The payload may choose only safe identity/profile handles and purpose. Actor and
    // tenant always come from the persisted, authority-gated action/step boundary.
    const input = {
      ...mapped,
      __identityActorId: origin?.initiatedBy ?? "system:workflow-capability",
      __identityPurpose: typeof originPayload.purpose === "string" ? originPayload.purpose : origin?.actionType ?? claimed.stepType,
      ...(typeof originPayload.communicationIdentityId === "string" ? { __communicationIdentityId: originPayload.communicationIdentityId } : {}),
      ...(typeof originPayload.authProfileRef === "string" ? { __authProfileRef: originPayload.authProfileRef } : {}),
    };
    const result = await executeCapability(tenantId, stepId, entry.contract, await entry.resolveBinding(tenantId), input);
    if (!result.ok) {
      await withTenant(tenantId, (db) => db.update(workflowSteps).set({ executionState: "failed_before_effect" }).where(and(eq(workflowSteps.tenantId, tenantId), eq(workflowSteps.id, stepId))));
      await failStep(tenantId, stepId, result.error);
      return;
    }
    await withTenant(tenantId, (db) => db.update(workflowSteps).set({ executionState: "verified" }).where(and(eq(workflowSteps.tenantId, tenantId), eq(workflowSteps.id, stepId))));
    await completeStep(tenantId, stepId, { output: result.output as Record<string, unknown> });
    await advanceWorkflow(tenantId, claimed.workflowRunId);
    await resumeBusinessControllers(tenantId, claimed.domainActionId);
  } catch (err) {
    await failStep(tenantId, stepId, (err as Error).message);
  }
};
