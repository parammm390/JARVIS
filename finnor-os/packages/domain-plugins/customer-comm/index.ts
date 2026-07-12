// customer-comm: answer_customer_question routes through the semantic memory layer
// (the dealer's own embedded SOPs/docs) — still confirmation-gated per policy, because
// the answer goes OUT to a customer. Message sends stay scaffolded.

import type { DomainEnginePlugin } from "../shared/plugin-interface";
import type { DraftAction, ExecutionResult, ValidationResult, DomainPolicy } from "@finnor/shared-types";
import { querySemantic } from "@finnor/memory";
import { withTenant, communicationsLog } from "@finnor/db";
import type { ToolRegistry } from "@finnor/tools";
import { findHousehold } from "../shared/db-helpers";
import { z } from "zod";

export const CustomerQuestionPayloadSchema = z.object({
  question: z.string().min(3).max(2000),
});

const opt = <T extends z.ZodTypeAny>(t: T) => t.nullish().transform((v: unknown) => v ?? undefined);

export const SendMessageSchema = z.object({
  householdId: opt(z.string().uuid()),
  phone: opt(z.string()),
  email: opt(z.string().email()),
  message: z.string().min(1).max(2000),
  channel: z.enum(["email", "sms"]).default("sms"),
});
export const SendFollowUpSchema = z.object({
  householdId: opt(z.string().uuid()),
  phone: opt(z.string()),
  context: opt(z.string().max(500)),
});

export const customerCommPlugin: DomainEnginePlugin = {
  name: "customer-comm",
  actionTypes: ["answer_customer_question", "send_customer_message", "send_follow_up"],
  payloadSchemas: {
    answer_customer_question: CustomerQuestionPayloadSchema,
    send_customer_message: SendMessageSchema,
    send_follow_up: SendFollowUpSchema,
  },
  canHandle(t) {
    return this.actionTypes.includes(t);
  },

  validate(actionType, payload): ValidationResult {
    const schema =
      actionType === "answer_customer_question"
        ? CustomerQuestionPayloadSchema
        : actionType === "send_customer_message"
          ? SendMessageSchema
          : SendFollowUpSchema;
    const p = schema.safeParse(payload);
    return p.success
      ? { valid: true, errors: [] }
      : { valid: false, errors: p.error.issues.map((i) => `payload.${i.path.join(".")}: ${i.message}`) };
  },

  draft(actionType, payload, policy: DomainPolicy): DraftAction {
    if (actionType === "answer_customer_question") {
      const p = CustomerQuestionPayloadSchema.parse(payload);
      return {
        actionType,
        summary: `Answer a customer question from your own documents: "${p.question.slice(0, 160)}"`,
        payload: { ...p, tenantId: policy.tenantId },
        requiresConfirmation: policy.requiresConfirmation,
      };
    }
    if (actionType === "send_customer_message") {
      const p = SendMessageSchema.parse(payload);
      return {
        actionType,
        summary: `Send this ${p.channel} to ${p.email ?? p.phone ?? p.householdId}: "${p.message.slice(0, 140)}"`,
        payload: { ...p, tenantId: policy.tenantId },
        requiresConfirmation: true, // outbound customer comms are always gated
      };
    }
    const p = SendFollowUpSchema.parse(payload);
    return {
      actionType,
      summary: `Send a follow-up to ${p.phone ?? p.householdId}${p.context ? ` about ${p.context}` : ""}.`,
      payload: { ...p, tenantId: policy.tenantId },
      requiresConfirmation: true,
    };
  },

  async execute(draft: DraftAction, tools: ToolRegistry): Promise<ExecutionResult> {
    if (draft.actionType === "send_customer_message" || draft.actionType === "send_follow_up") {
      const tenantId = String(draft.payload.tenantId ?? "");
      const hh = await findHousehold(tenantId, {
        householdId: draft.payload.householdId ? String(draft.payload.householdId) : undefined,
        phone: draft.payload.phone ? String(draft.payload.phone) : undefined,
      });
      const contact = (hh?.contactInfo ?? {}) as Record<string, unknown>;
      const message =
        draft.actionType === "send_customer_message"
          ? String(draft.payload.message)
          : `Hi${contact.name ? ` ${contact.name}` : ""}! Just following up${draft.payload.context ? ` about ${draft.payload.context}` : " on your recent service"} — reply here or call us if you need anything.`;
      const email = String(draft.payload.email ?? contact.email ?? "");
      const wantsEmail = draft.payload.channel === "email" || (!contact.phone && email);

      let channel: string;
      if (wantsEmail && email) {
        const r = await tools.call("send_email", { to: email, subject: "From your water treatment dealer", body: message });
        if (!r.ok) return { status: "integration_unavailable", output: {}, error: r.error };
        channel = "email";
      } else if (hh) {
        const r = await tools.call("ghl_send_sms", { contactId: hh.id, message, tenantId });
        if (!r.ok) return { status: "integration_unavailable", output: {}, error: r.error };
        channel = "sms";
      } else {
        return { status: "failure", output: {}, error: "No customer found and no email given — nowhere to send this." };
      }
      if (hh) {
        await withTenant(tenantId, (db) =>
          db.insert(communicationsLog).values({ householdId: hh.id, channel, direction: "outbound", content: message }),
        ).catch(() => undefined);
      }
      return { status: "success", output: { sent: true, channel }, expected: { sent: true } };
    }
    const tenantId = String(draft.payload.tenantId ?? "");
    const question = String(draft.payload.question ?? "");
    const hits = await querySemantic(tenantId, question, 3);
    if (hits.length === 0) {
      return {
        status: "success",
        output: {
          answer: "I don't have anything in your documents that answers this yet. Upload the relevant SOP or price sheet and I'll use it next time.",
          sources: [],
        },
        expected: { answered: true },
      };
    }
    return {
      status: "success",
      output: {
        answer: hits[0]!.chunk,
        sources: hits.map((h) => ({ doc: h.sourceDocId, similarity: h.similarity })),
      },
      expected: { answered: true },
    };
  },
};

export default customerCommPlugin;
