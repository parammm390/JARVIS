// customer-comm: answer_customer_question routes through the semantic memory layer
// (the dealer's own embedded SOPs/docs) — still confirmation-gated per policy, because
// the answer goes OUT to a customer. Message sends stay scaffolded.

import type { DomainEnginePlugin } from "../shared/plugin-interface";
import type { DraftAction, ExecutionResult, ValidationResult, DomainPolicy } from "@finnor/shared-types";
import { hybridRetrieve, type StructuredFact } from "@finnor/memory";
import { withTenant, communicationsLog } from "@finnor/db";
import { getOrCreateConversation, persistMessage } from "@finnor/data-platform";
import { household360 } from "@finnor/read-models";
import { resolveProvider } from "@finnor/tools";
import type { ToolRegistry } from "@finnor/tools";
import { findHousehold } from "../shared/db-helpers";
import { z } from "zod";

const opt = <T extends z.ZodTypeAny>(t: T) => t.nullish().transform((v: unknown) => v ?? undefined);

export const CustomerQuestionPayloadSchema = z.object({
  question: z.string().min(3).max(2000),
  // §5.3: optional — when the caller already knows which household is asking (a
  // returning customer's call/text), the household's own real history grounds the
  // answer as a structured fact ahead of semantic memory. Absent for an unidentified
  // asker (e.g. a first-time web form question) — semantic memory alone still applies.
  householdId: opt(z.string().uuid()),
});

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
        // Kept alongside the canonical write below — packages/memory/src/long-term.ts
        // still reads communications_log for household history.
        await withTenant(tenantId, (db) =>
          db.insert(communicationsLog).values({ householdId: hh.id, channel, direction: "outbound", content: message }),
        ).catch(() => undefined);
        await withTenant(tenantId, async (db) => {
          const { conversationId } = await getOrCreateConversation(db, {
            tenantId,
            householdId: hh.id,
            channel: channel === "email" ? "email" : "sms",
          });
          await persistMessage(db, { tenantId, conversationId, direction: "outbound", channel, content: message });
        }).catch(() => undefined);
      }
      return { status: "success", output: { sent: true, channel }, expected: { sent: true } };
    }
    const tenantId = String(draft.payload.tenantId ?? "");
    const question = String(draft.payload.question ?? "");
    const householdId = draft.payload.householdId ? String(draft.payload.householdId) : undefined;

    const structured: StructuredFact[] = [];
    if (householdId) {
      const profile = await household360(tenantId, householdId).catch(() => null);
      if (profile) structured.push({ source: "household360", ref: householdId, data: profile });
    }
    const retrieval = await hybridRetrieve({ tenantId, query: question, structured });

    if (retrieval.semanticHits.length === 0 && structured.length === 0) {
      return {
        status: "success",
        output: {
          answer: "I don't have anything in your documents that answers this yet. Upload the relevant SOP or price sheet and I'll use it next time.",
          citations: [],
        },
        expected: { answered: true },
      };
    }

    let answer: string;
    try {
      const provider = resolveProvider();
      answer = (
        await provider.complete({
          system:
            "You answer a customer's question for a water treatment dealer. Use the structured facts (their own " +
            "service history, if given) as ground truth; semantic document snippets are supporting context, never " +
            "a substitute for a structured fact when both exist. Never invent a number, date, or promise not " +
            "present in the given data. One or two short, warm sentences, no preamble.",
          user: JSON.stringify({ question, facts: retrieval.facts, semanticSnippets: retrieval.semanticHits.map((h) => h.chunk) }),
        })
      ).trim();
    } catch {
      // LLM synthesis failed — degrade to the old behavior (top raw chunk) rather than
      // returning nothing; still real, still cited, just not natural-language-composed.
      answer = retrieval.semanticHits[0]?.chunk ?? "I found related information but could not summarize it right now.";
    }

    return {
      status: "success",
      output: { answer, citations: retrieval.citations },
      expected: { answered: true },
    };
  },
};

export default customerCommPlugin;
