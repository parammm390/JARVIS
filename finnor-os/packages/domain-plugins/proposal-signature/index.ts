// Vertical workflow 2 (Phase 4, docs/jarvis-90-execution-blueprint.md §4.2): water
// test to signed proposal. Technician report / water profile / sizing / price-book
// quote / delivery are already real (technician-reports, quotation plugins — Phase
// 1). This plugin covers the part that was previously missing entirely: signature
// capture. `request_proposal_signature` generates a document + requests a signature
// (Phase 3's documents capability contract) via the durable execution runtime;
// `applySignatureOutcome` (called when the signer responds) is the other half —
// dedups via receiveInboxEvent exactly like a real webhook would, then transitions
// quotes/proposals to accepted/declined/expired. No real e-signature provider exists
// (Phase 3 finding), so the "signer responded" trigger is invoked directly rather than
// from a real inbound webhook route — the mechanism (inbox dedup + reconciliation) is
// identical either way.

import type { DomainEnginePlugin } from "../shared/plugin-interface";
import type { DraftAction, ExecutionResult, ValidationResult, DomainPolicy } from "@finnor/shared-types";
import type { ToolRegistry } from "@finnor/tools";
import { withTenant, proposals, quotes } from "@finnor/db";
import { submitCommand, enqueueStep, receiveInboxEvent } from "@finnor/workflow-runtime";
import { recordBusinessEvent } from "@finnor/data-platform";
import { eq } from "drizzle-orm";
import { z } from "zod";

const opt = <T extends z.ZodTypeAny>(t: T) => t.nullish().transform((v: unknown) => v ?? undefined);

export const RequestProposalSignatureSchema = z.object({
  proposalId: z.string().uuid(),
  signerName: z.string().min(1),
  signerEmail: z.string().email(),
});

const SCHEMAS: Record<string, z.ZodTypeAny> = {
  request_proposal_signature: RequestProposalSignatureSchema,
};

export const proposalSignaturePlugin: DomainEnginePlugin = {
  name: "proposal-signature",
  actionTypes: Object.keys(SCHEMAS),
  payloadSchemas: SCHEMAS,
  canHandle(t) {
    return t in SCHEMAS;
  },

  validate(actionType, payload): ValidationResult {
    const schema = SCHEMAS[actionType];
    if (!schema) return { valid: false, errors: [`unhandled action ${actionType}`] };
    const p = schema.safeParse(payload);
    return p.success
      ? { valid: true, errors: [] }
      : { valid: false, errors: p.error.issues.map((i) => `payload.${i.path.join(".")}: ${i.message}`) };
  },

  draft(actionType, payload, policy: DomainPolicy): DraftAction {
    const p = RequestProposalSignatureSchema.parse(payload);
    return {
      actionType,
      summary: `Send proposal ${p.proposalId.slice(0, 8)} to ${p.signerName} (${p.signerEmail}) for signature.`,
      payload: { ...p, tenantId: policy.tenantId },
      requiresConfirmation: policy.requiresConfirmation,
    };
  },

  async execute(draft: DraftAction, _tools: ToolRegistry): Promise<ExecutionResult> {
    const tenantId = String(draft.payload.tenantId ?? "");
    const proposalId = String(draft.payload.proposalId);

    const proposal = await withTenant(tenantId, async (db) => {
      const [row] = await db.select().from(proposals).where(eq(proposals.id, proposalId));
      return row ?? null;
    });
    if (!proposal) return { status: "failure", output: {}, error: "That proposal doesn't exist.", errorKind: "validation" };

    const idempotencyKey = `proposal-signature:${proposalId}`;
    const submitted = await withTenant(tenantId, (db) =>
      submitCommand(db, {
        tenantId,
        commandType: "request_proposal_signature",
        payload: { proposalId, quoteId: proposal.quoteId },
        workflowType: "water_test_to_signed_proposal",
        idempotencyKey,
        correlationId: draft.correlationId,
        steps: [
          {
            stepType: "generate_document",
            payload: {
              tenantId,
              kind: "proposal_pdf",
              title: `Proposal ${proposalId.slice(0, 8)}`,
              idempotencyKey: `${idempotencyKey}:doc`,
              sourceEntityType: "proposal",
              sourceEntityId: proposalId,
            },
          },
          {
            stepType: "request_signature",
            payload: {
              tenantId,
              proposalId,
              // documentId is filled in from step 1's carried-forward context by
              // run-workflow-step.ts's mapPayload, same mechanism as vertical workflow 1.
              signerName: String(draft.payload.signerName),
              signerEmail: String(draft.payload.signerEmail),
              idempotencyKey: `${idempotencyKey}:sig`,
            },
          },
        ],
      }),
    );

    if (!submitted.alreadyExisted) {
      await enqueueStep(tenantId, submitted.stepIds[0]!, `${idempotencyKey}:doc`);
    }

    return {
      status: "success",
      output: { commandId: submitted.commandId, workflowRunId: submitted.workflowRunId, alreadyStarted: submitted.alreadyExisted },
      expected: { started: true },
    };
  },
};

export default proposalSignaturePlugin;

export type SignatureOutcome = "signed" | "declined" | "expired";

/**
 * Called when the signer responds (in a real e-signature integration, from that
 * provider's webhook). Dedups via receiveInboxEvent exactly like the real Vapi/GHL
 * webhook routes do, then transitions the linked quote/proposal.
 */
export async function applySignatureOutcome(params: {
  tenantId: string;
  quoteId: string;
  proposalId: string;
  signatureRequestId: string;
  outcome: SignatureOutcome;
  matchStepId?: string;
}): Promise<{ applied: boolean; reason?: string }> {
  const received = await receiveInboxEvent({
    tenantId: params.tenantId,
    provider: "e_signature",
    eventId: `${params.signatureRequestId}:${params.outcome}`,
    payload: { quoteId: params.quoteId, proposalId: params.proposalId, outcome: params.outcome },
    matchStepId: params.matchStepId,
  });
  if (received.status === "duplicate") return { applied: false, reason: "duplicate delivery" };

  const quoteStatus = params.outcome === "signed" ? "accepted" : params.outcome === "declined" ? "declined" : "expired";
  await withTenant(params.tenantId, async (db) => {
    await db.update(quotes).set({ status: quoteStatus }).where(eq(quotes.id, params.quoteId));
    if (quoteStatus === "accepted") {
      await db.update(proposals).set({ status: "accepted" }).where(eq(proposals.id, params.proposalId));
    }
    await recordBusinessEvent(db, {
      tenantId: params.tenantId,
      entityType: "quote",
      entityId: params.quoteId,
      eventType: `quote_${quoteStatus}`,
      payload: { proposalId: params.proposalId, signatureRequestId: params.signatureRequestId },
    });
  });

  return { applied: true };
}
