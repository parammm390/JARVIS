// Dedicated, deterministic read-only routing for high-confidence internal questions.
// This module deliberately knows no planner/provider details: an uncertain question
// returns null and the caller continues through the existing safe planner path.

import type { TenantContext } from "@finnor/shared-types";
import { cashCollections as loadCashCollections, type CashCollections } from "@finnor/read-models";

export interface AnswerDisplayFact {
  label: string;
  value: string;
}

export interface AnswerDisplay {
  title: string;
  facts: AnswerDisplayFact[];
}

export interface AnswerEvidence {
  source: string;
  ref: string;
  timestamp: string;
}

export interface AnswerFreshness {
  status: "fresh" | "stale" | "unknown";
  observedAt: string;
}

/** Browser/voice-safe answer contract. It contains only a bounded display
 * projection and citation metadata; raw read-model rows never cross this seam. */
export interface AnswerEnvelope {
  kind: "answer";
  intent: "cash_collections" | "greeting";
  readOnly: true;
  spokenSummary: string;
  display: AnswerDisplay;
  evidence: AnswerEvidence[];
  asOf: string;
  freshness: AnswerFreshness;
}

export type FastReadOnlyClassification =
  | { route: "fast_read"; intent: "cash_collections" }
  | { route: "fast_read"; intent: "greeting" }
  | { route: "planner"; reason: "not_question" | "mutation_or_advice" | "external_or_ambiguous" | "unsupported" };

const QUESTION_PREFIX = /^(?:how|what|which|where|when|is|are|do|does|did|can|could|tell me|show me|give me)\b/i;
const MUTATION_OR_ADVICE = /\b(?:create|send|record|update|change|delete|remove|approve|reject|schedule|book|call|text|email|pay|charge|reorder|restock|flag|mark|start|launch|assign|execute|run|prepare|draft|write|edit|improve|recommend|recommendation|advice|should|make)\b/i;
const EXTERNAL_OR_AMBIGUOUS = /\b(?:quickbooks|stripe|google|meta|vapi|integration|connected account|why|forecast|predict|trend)\b/i;
const CASH_COLLECTIONS = /\b(?:cash\s+collections?|collections?|payments?\s+collected|(?:cash|payments?)\s+collected|collected\s+(?:cash|payments?))\b/i;
const GREETING = /^(?:hi|hello|hey|hiya|good\s+(?:morning|afternoon|evening))[!.?,\s]*$/i;

/** Pure, fail-closed classification. It never returns an action type and therefore
 * cannot authorize a write, even if a caller accidentally treats the result as a
 * routing hint elsewhere. */
export function classifyFastReadOnlyQuestion(instruction: string): FastReadOnlyClassification {
  const normalized = instruction.trim().replace(/\s+/g, " ");
  if (!normalized || normalized.length > 500) return { route: "planner", reason: "not_question" };
  if (GREETING.test(normalized)) return { route: "fast_read", intent: "greeting" };
  if (!QUESTION_PREFIX.test(normalized) && !/\?\s*$/.test(normalized)) return { route: "planner", reason: "not_question" };
  if (MUTATION_OR_ADVICE.test(normalized)) return { route: "planner", reason: "mutation_or_advice" };
  if (EXTERNAL_OR_AMBIGUOUS.test(normalized)) return { route: "planner", reason: "external_or_ambiguous" };
  if (CASH_COLLECTIONS.test(normalized)) return { route: "fast_read", intent: "cash_collections" };
  return { route: "planner", reason: "unsupported" };
}

export interface FastReadOnlyRouter {
  classify(instruction: string): FastReadOnlyClassification;
  route(instruction: string, ctx: Pick<TenantContext, "tenantId">): Promise<AnswerEnvelope | null>;
}

export interface FastReadOnlyRouterDeps {
  cashCollections?: (tenantId: string) => Promise<CashCollections>;
  now?: () => Date;
}

function money(value: number): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(value);
}

function countFor(snapshot: CashCollections, status: string): { count: number; totalUsd: number } {
  const row = snapshot.invoicesByStatus.find((item) => item.status.toLowerCase() === status);
  return { count: row?.count ?? 0, totalUsd: row?.totalUsd ?? 0 };
}

function plural(value: number, singular: string, pluralForm = `${singular}s`): string {
  return `${value} ${value === 1 ? singular : pluralForm}`;
}

export function answerCashCollections(snapshot: CashCollections, asOf: string): AnswerEnvelope {
  const paid = countFor(snapshot, "paid");
  const overdue = countFor(snapshot, "overdue");
  const links = snapshot.paymentLinksAwaitingPayment;
  const spokenSummary =
    `Cash collections are ${money(snapshot.totalCollected)} collected to date. ` +
    `There are ${plural(paid.count, "paid invoice")} and ${plural(overdue.count, "overdue invoice")} totaling ${money(overdue.totalUsd)} overdue.` +
    ` ${plural(links, "payment link")} ${links === 1 ? "is" : "are"} awaiting payment.`;

  return {
    kind: "answer",
    intent: "cash_collections",
    readOnly: true,
    spokenSummary,
    display: {
      title: "Cash collections",
      facts: [
        { label: "Collected to date", value: money(snapshot.totalCollected) },
        { label: "Paid invoices", value: String(paid.count) },
        { label: "Overdue invoices", value: String(overdue.count) },
        { label: "Overdue amount", value: money(overdue.totalUsd) },
        { label: "Payment links awaiting payment", value: String(links) },
      ],
    },
    evidence: [{ source: "cash_collections_read_model", ref: "current", timestamp: asOf }],
    asOf,
    freshness: { status: "fresh", observedAt: asOf },
  };
}

export function answerGreeting(asOf: string): AnswerEnvelope {
  return {
    kind: "answer",
    intent: "greeting",
    readOnly: true,
    spokenSummary: "Hi — I’m here and ready to help.",
    display: { title: "JARVIS is ready", facts: [] },
    evidence: [{ source: "jarvis_assistant", ref: "ready", timestamp: asOf }],
    asOf,
    freshness: { status: "fresh", observedAt: asOf },
  };
}

export function createFastReadOnlyRouter(deps: FastReadOnlyRouterDeps = {}): FastReadOnlyRouter {
  const loadCash = deps.cashCollections ?? loadCashCollections;
  const now = deps.now ?? (() => new Date());
  return {
    classify: classifyFastReadOnlyQuestion,
    async route(instruction, ctx) {
      const classification = classifyFastReadOnlyQuestion(instruction);
      if (classification.route !== "fast_read") return null;
      const asOf = now().toISOString();
      if (classification.intent === "greeting") return answerGreeting(asOf);
      // The only tenant selector is the authenticated request context. The
      // instruction text and classifier have no tenant/action/policy fields.
      const snapshot = await loadCash(ctx.tenantId);
      return answerCashCollections(snapshot, asOf);
    },
  };
}

export const defaultFastReadOnlyRouter = createFastReadOnlyRouter();
