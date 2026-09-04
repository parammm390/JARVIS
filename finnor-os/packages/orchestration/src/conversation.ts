import type { MemorySnapshot, TenantContext } from "@finnor/shared-types";
import { redactStructured } from "@finnor/security";
import { resolveProviderForPurpose, type LLMChannel, type LLMProvider } from "./llm";
import type { AnswerEnvelope } from "./fast-read-lane";
import { plannerShortTermContext } from "./planner-memory";

const GREETING = /^(?:hi|hello|hey|hiya|yo|good\s+(?:morning|afternoon|evening))[!.?,\s]*$/i;
const SOCIAL_TURN = /^(?:thanks?|thank\s+you|how\s+are\s+you|who\s+are\s+you|are\s+you\s+there|help)[!.?,\s]*$/i;
const GREETING_PREFIX = /^(?:hi|hello|hey|hiya|yo)(?:\s+jarvis)?[.!?,\s]+/i;
// A greeting can carry a bounded session/status acknowledgement (for example
// the nonce-scoped Product Truth check) without becoming durable business work.
// Consequential verbs/entities remain explicitly excluded so "hello, send an
// invoice" still takes the planner path.
const GREETING_FOLLOWUP = /^(?:confirm|check|verify|this\s+exact|are\s+you\s+(?:there|connected)|are\s+we\s+connected|let\s+me\s+know)\b/i;
const GREETING_FOLLOWUP_BUSINESS = /\b(?:send|text|email|message|call|assign|update|set|mark|reschedule|cancel|create|record|research|look\s+up|find|invoice|payment|customer|client|company|business|work|task|job|money|cash|approval|approve|execute|run|schedule|appointment|provider|integration|workflow|objective)\b/i;
// Keep capability questions on the conversational lane even when the user uses
// the common filler word "all" (for example, "hey what all can you do?").
// This is intentionally phrase-specific: a broad `what can you` match would
// steal real business questions such as "what can you tell me about our leads?"
// from the canonical/planner read path.
const CAPABILITY_TURN = /^(?:what(?:\s+all)?\s+can\s+you\s+(?:do|handle)(?:\s+for\s+me)?|what(?:\s+all)?\s+can\s+you\s+help\s+me\s+accomplish|what(?:\s+all)?\s+do\s+you\s+(?:do|handle|support)|how\s+can\s+you\s+help(?:\s+me)?|what\s+can\s+i\s+ask(?:\s+you)?|what\s+are\s+you\s+able\s+to\s+do|help\s+me\s+accomplish)\b/i;

function capabilityText(instruction: string): string {
  // Users commonly prefix a capability question with a greeting. Strip only
  // that bounded conversational prefix; do not loosen the business-question
  // classifier for arbitrary leading prose.
  return instruction.replace(/^(?:hi|hello|hey|hiya|yo)[,!?\s]+/i, "").trim();
}

function isGreetingStatusFollowup(instruction: string): boolean {
  const match = instruction.match(GREETING_PREFIX);
  if (!match) return false;
  const remainder = instruction.slice(match[0].length).trim();
  return remainder.length > 0
    && remainder.length <= 180
    && GREETING_FOLLOWUP.test(remainder)
    && !GREETING_FOLLOWUP_BUSINESS.test(remainder);
}

/** Casual and capability turns deserve a real conversational response, not a
 * synthetic action card or an empty plan. Business questions and instructions
 * continue through the planner so they can reach the real read/action stack. */
export function isConversationalTurn(instruction: string): boolean {
  const normalized = instruction.trim().replace(/\s+/g, " ");
  if (!normalized || normalized.length > 500) return false;
  return GREETING.test(normalized)
    || isGreetingStatusFollowup(normalized)
    || SOCIAL_TURN.test(normalized)
    || CAPABILITY_TURN.test(capabilityText(normalized));
}

export interface ConversationAnswerOptions {
  channel?: LLMChannel;
  signal?: AbortSignal;
  deadlineAt?: number;
  deadlineMs?: number;
  capabilityActionTypes: readonly string[];
}

export interface ConversationResponder {
  answer(
    instruction: string,
    ctx: TenantContext,
    memory: MemorySnapshot,
    opts: ConversationAnswerOptions,
  ): Promise<AnswerEnvelope>;
}

export class LLMConversationResponder implements ConversationResponder {
  private readonly providers = new Map<LLMChannel, LLMProvider>();

  constructor(private readonly provider?: LLMProvider, private readonly now: () => Date = () => new Date()) {}

  async answer(
    instruction: string,
    ctx: TenantContext,
    memory: MemorySnapshot,
    opts: ConversationAnswerOptions,
  ): Promise<AnswerEnvelope> {
    const channel = opts.channel ?? "text";
    const provider = this.provider ?? this.providers.get(channel) ?? resolveProviderForPurpose("answer", channel);
    if (!this.provider) this.providers.set(channel, provider);

    const user = JSON.stringify(redactStructured({
      instruction,
      capabilities: opts.capabilityActionTypes,
      recentSession: plannerShortTermContext(instruction, memory.shortTerm),
    }));
    const spokenSummary = (await provider.complete({
      system: [
        "You are JARVIS, the conversational command interface for Finnor, a business operating system for water-treatment dealers.",
        "Respond naturally and directly. A greeting should feel warm and useful, not like a status acknowledgement.",
        "For capability questions, summarize the supplied registered capabilities as business outcomes: research, customer operations, field scheduling, money, marketing, approvals, execution, evidence, and recovery when supported by the supplied action names.",
        "Do not claim that an action ran or that a business fact is true unless it appears in recentSession. Never invent customer, payment, schedule, or integration data.",
        "If the request is unclear or cannot safely be acted on, ask one concise, useful follow-up question.",
        "Never reveal hidden reasoning or chain-of-thought. Return only the user-facing response, normally two to five sentences.",
      ].join("\n"),
      user,
      tenantId: ctx.tenantId,
      traceId: ctx.correlationId,
      purpose: "answer",
      channel,
      signal: opts.signal,
      deadlineAt: opts.deadlineAt,
      deadlineMs: opts.deadlineMs,
    })).trim();

    if (!spokenSummary) throw new Error("The conversational model returned an empty response");
    const asOf = this.now().toISOString();
    return {
      kind: "answer",
      intent: "conversation",
      readOnly: true,
      spokenSummary,
      display: { title: "JARVIS", facts: [] },
      evidence: [{ source: "conversation_model", ref: provider.selectedProviderName ?? provider.name, timestamp: asOf, kind: "SESSION" }],
      asOf,
      freshness: { status: "fresh", observedAt: asOf },
    };
  }
}
