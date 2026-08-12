import type { MemorySnapshot, TenantContext } from "@finnor/shared-types";
import { redactStructured } from "@finnor/security";
import { resolveProviderForPurpose, type LLMChannel, type LLMProvider } from "./llm";
import type { AnswerEnvelope } from "./fast-read-lane";
import { plannerShortTermContext } from "./planner-memory";

const GREETING = /^(?:hi|hello|hey|hiya|yo|good\s+(?:morning|afternoon|evening))[!.?,\s]*$/i;
const SOCIAL_TURN = /^(?:thanks?|thank\s+you|how\s+are\s+you|who\s+are\s+you|are\s+you\s+there|help)[!.?,\s]*$/i;
const CAPABILITY_TURN = /\b(?:what\s+can\s+you|what\s+do\s+you\s+(?:do|handle)|how\s+can\s+you\s+help|what\s+can\s+i\s+ask|what\s+are\s+you\s+able\s+to\s+do|help\s+me\s+accomplish)\b/i;

/** Casual and capability turns deserve a real conversational response, not a
 * synthetic action card or an empty plan. Business questions and instructions
 * continue through the planner so they can reach the real read/action stack. */
export function isConversationalTurn(instruction: string): boolean {
  const normalized = instruction.trim().replace(/\s+/g, " ");
  if (!normalized || normalized.length > 500) return false;
  return GREETING.test(normalized) || SOCIAL_TURN.test(normalized) || CAPABILITY_TURN.test(normalized);
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
      evidence: [{ source: "conversation_model", ref: provider.selectedProviderName ?? provider.name, timestamp: asOf }],
      asOf,
      freshness: { status: "fresh", observedAt: asOf },
    };
  }
}
