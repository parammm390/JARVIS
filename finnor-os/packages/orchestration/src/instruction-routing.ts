import type { DomainAction, OperatingInteractionContext } from "@finnor/shared-types";
import type { OperationalQueryDecision } from "./fast-read-lane";
import { isConsequentialAction } from "./compiler";

export const INSTRUCTION_ROUTING_POLICY_VERSION = 1 as const;

export type InstructionExecutionModel = "QUERY" | "ATOMIC_ACTION" | "OBJECTIVE" | "CONVERSATION" | "CLARIFY";

export interface InstructionRouteDecision {
  version: typeof INSTRUCTION_ROUTING_POLICY_VERSION;
  route: InstructionExecutionModel;
  reasonCodes: string[];
  queryDecision?: OperationalQueryDecision;
}

const OBJECTIVE_SIGNALS = [
  /\b(?:and then|then|after|before|once|until|unless|if|when|whenever)\b/i,
  /\b(?:ensure|make sure|own (?:this|it)|take care of|handle|resolve|unstuck|coordinate|arrange|oversee)\b/i,
  /\b(?:wait|reply|respond|response|acknowledg|approval|approve|deadline|follow up later)\b/i,
  /\b(?:delegate|handoff|hand off|team|vendor|supplier|customer)\b.*\b(?:complete|finish|respond|confirm|accept)\b/i,
  /\b(?:recover|retry|replan|fallback|compensat|escalat|outage|failure)\b/i,
  /\b(?:across|multi[- ]?step|workflow|browser|computer)\b/i,
];

const ATOMIC_VERB = /^(?:please\s+)?(?:send|text|email|message|call|assign|update|set|mark|reschedule|cancel|create|record)\b/i;
const DIRECT_TARGET = /(?:\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b|\+\d{8,15}\b|\b[^\s@]+@[^\s@]+\.[^\s@]+\b)/i;
const NAMED_TARGET = /\b(?:to|for|on)\s+(?:the\s+)?[\p{L}\d][\p{L}\d'’&.-]*(?:\s+[\p{L}\d][\p{L}\d'’&.-]*){0,5}\s*$/iu;
const PREPARED_EFFECT = /\b(?:this|that|already[- ]prepared|exact)\b.*\b(?:message|task|field|visit|invoice|payment|record)\b/i;
const QUESTION_SHAPE = /^(?:(?:please\s+)?(?:how|what|which|where|when|who|is|are|do|does|did|can|could|would)\b|(?:please\s+)?(?:tell me|show(?:\s+me)?|pull\s+up|find|get|give me|list|summarize|explain)\b)|\?\s*$/i;
const QUESTION_OBJECTIVE_LANGUAGE = [
  /\b(?:and then|then|after|before|once|until|unless|if|whenever)\b/i,
  ...OBJECTIVE_SIGNALS.slice(1),
];

/**
 * A small, auditable compiler for the subset of ATOMIC_ACTION instructions whose
 * complete payload is present in the instruction itself.  The route classifier
 * deliberately remains broader (it can use a selected canonical entity), but a
 * direct endpoint plus an explicit message/marker is safe to compile without an
 * LLM.  Keeping this deterministic prevents planner sampling from turning the
 * same one-effect request into an empty or multi-action Objective.
 */
export interface DeterministicAtomicCandidate {
  action_type: string;
  payload: Record<string, unknown>;
}

const DIRECT_EMAIL = /\b[^\s@]+@[^\s@]+\.[^\s@]+\b/gi;
const DIRECT_PHONE = /\+\d{8,15}\b/g;

function directTargetAfterTo(value: string): { target: string; channel: "email" | "sms"; tail: string } | null {
  const candidates = [
    ...[...value.matchAll(DIRECT_EMAIL)].map((match) => ({ target: match[0], channel: "email" as const, index: match.index ?? 0 })),
    ...[...value.matchAll(DIRECT_PHONE)].map((match) => ({ target: match[0], channel: "sms" as const, index: match.index ?? 0 })),
  ].sort((a, b) => a.index - b.index);
  if (candidates.length !== 1) return null;
  const candidate = candidates[0]!;
  const before = value.slice(0, candidate.index).trim();
  if (!/\b(?:to|for)\s*$/i.test(before)) return null;
  const tail = value.slice(candidate.index + candidate.target.length).replace(/^\s*[:,-]?\s*/, "").trim();
  if (!tail) return null;
  return { target: candidate.target, channel: candidate.channel, tail };
}

/**
 * Compile only unambiguous direct-target forms.  Returning null is intentional:
 * context-bound/named targets and incomplete wording continue through the normal
 * planner and its existing fail-closed typed-plan finalizer.
 */
export function compileDeterministicAtomicAction(instruction: string): DeterministicAtomicCandidate | null {
  const value = instruction.replace(/\s+/g, " ").trim();
  if (!strictAtomicCandidate(value)) return null;
  const direct = directTargetAfterTo(value);
  if (!direct) return null;

  if (/^(?:please\s+)?(?:send|text|email|message)\b/i.test(value)) {
    return {
      action_type: "send_customer_message",
      payload: direct.channel === "email"
        ? { email: direct.target, channel: "email", message: direct.tail }
        : { phone: direct.target, channel: "sms", message: direct.tail },
    };
  }

  // “Update the CRM record ... with [marker/note]” is the canonical internal CRM
  // write used by the Product Truth journey.  It is represented as an interaction
  // log (never as an invented generic record mutation), and remains behind the
  // normal typed action/authority boundary.
  const crm = value.match(/^(?:please\s+)?update\s+(?:the\s+)?crm\s+(?:record|entry)\s+for\s+[^\s@]+@[^\s@]+\.[^\s@]+\s+(with|to)\s+(.+)$/i);
  if (crm && direct.channel === "email") {
    return {
      action_type: "log_interaction",
      payload: { email: direct.target, channel: "email", direction: "outbound", content: `${crm[1]} ${crm[2]}` },
    };
  }
  return null;
}

const BUSINESS_QUESTION = /\b(?:business|company|customer|client|household|contact|lead|opportunit|quote|proposal|invoice|payment|money|cash|revenue|inventory|stock|sku|schedule|appointment|visit|work(?:\s+order)?|task|job|technician|employee|manager|team|supplier|vendor|agent|campaign|review|service|installation|maintenance|water|equipment|policy|approval|workflow|delegation)\b/i;

function isLightweightInformationalQuestion(instruction: string, decision: OperationalQueryDecision): boolean {
  if (decision.route === "planner" && (decision.reason === "mutation_or_advice" || decision.reason === "external_or_ambiguous")) return false;
  const value = instruction.replace(/\s+/g, " ").trim();
  return QUESTION_SHAPE.test(value)
    && !BUSINESS_QUESTION.test(value)
    && !QUESTION_OBJECTIVE_LANGUAGE.some((signal) => signal.test(value));
}

function exactContextTarget(context: OperatingInteractionContext | Record<string, unknown> | undefined): boolean {
  if (!context || typeof context !== "object" || Array.isArray(context)) return false;
  const row = context as Record<string, unknown>;
  const selected = Array.isArray(row.selectedEntities) ? row.selectedEntities : [];
  return selected.length === 1 || Boolean(row.focusedEntity) || typeof row.householdId === "string";
}

function strictAtomicCandidate(instruction: string, context?: OperatingInteractionContext | Record<string, unknown>): boolean {
  const value = instruction.replace(/\s+/g, " ").trim();
  if (!ATOMIC_VERB.test(value)) return false;
  if (OBJECTIVE_SIGNALS.some((signal) => signal.test(value))) return false;
  if (/\s(?:and|&)\s/i.test(value) || /[;\n]/.test(value)) return false;
  return exactContextTarget(context) || DIRECT_TARGET.test(value) || NAMED_TARGET.test(value) || PREPARED_EFFECT.test(value);
}

/** The one business-level intake policy. The Operational Query Plane interpreter
 * supplies the typed read candidate; this policy owns the final execution model. */
export function classifyInstructionRoute(input: {
  instruction: string;
  fastReadDecision: OperationalQueryDecision;
  activeContext?: OperatingInteractionContext | Record<string, unknown>;
  conversational?: boolean;
  /** Set only by the deterministic, tenant-scoped reference/sender resolver. */
  clarificationRequired?: boolean;
}): InstructionRouteDecision {
  if (input.fastReadDecision.route === "fast_read") {
    return { version: 1, route: "QUERY", reasonCodes: ["deterministic_canonical_read"], queryDecision: input.fastReadDecision };
  }
  if (input.clarificationRequired) {
    return { version: 1, route: "CLARIFY", reasonCodes: ["consequential_target_or_sender_unresolved"] };
  }
  if (input.conversational) return { version: 1, route: "CONVERSATION", reasonCodes: ["non_business_conversation"] };
  // A plain informational question outside the typed business-read grammar is
  // still not an objective. Keep it on the lightweight answer lane; business
  // terms, mutations, and external/research requests remain fail-closed.
  if (isLightweightInformationalQuestion(input.instruction, input.fastReadDecision)) {
    return { version: 1, route: "CONVERSATION", reasonCodes: ["lightweight_informational_question"] };
  }
  if (strictAtomicCandidate(input.instruction, input.activeContext)) {
    return { version: 1, route: "ATOMIC_ACTION", reasonCodes: ["strict_single_action_candidate"] };
  }
  const reasonCodes = OBJECTIVE_SIGNALS.filter((signal) => signal.test(input.instruction)).map((_, index) => `objective_signal_${index + 1}`);
  return { version: 1, route: "OBJECTIVE", reasonCodes: reasonCodes.length ? reasonCodes : ["meaningful_business_work_default"] };
}

const CONTINUATION_ACTION = /(?:workflow|delegate|handoff|hand_off|computer_task|clarification|manual_step)/i;

/** A strict atomic candidate is revalidated against the actual typed plan. This is
 * still the same routing policy, and fails toward Objective when the plan reveals a
 * dependency, workflow, read action, or other continuation requirement. */
export function finalizeInstructionRoute(
  preliminary: InstructionRouteDecision,
  actions: DomainAction[],
): InstructionRouteDecision {
  if (actions.length === 1 && actions[0]?.actionType === "clarification_request") {
    return { version: 1, route: "CLARIFY", reasonCodes: ["typed_plan_requires_clarification"] };
  }
  if (preliminary.route !== "ATOMIC_ACTION") return preliminary;
  const action = actions[0];
  const dependencyCount = Array.isArray((action as (DomainAction & { dependsOn?: unknown[] }) | undefined)?.dependsOn)
    ? ((action as (DomainAction & { dependsOn?: unknown[] }) | undefined)?.dependsOn?.length ?? 0)
    : 0;
  const atomic = actions.length === 1
    && Boolean(action)
    && dependencyCount === 0
    && action!.compiledGraph?.kind === "single_action"
    && !CONTINUATION_ACTION.test(action!.actionType)
    && isConsequentialAction(action!.actionType, action!.payload);
  return atomic
    ? { ...preliminary, reasonCodes: [...preliminary.reasonCodes, "one_independent_effect_set"] }
    : { version: 1, route: "OBJECTIVE", reasonCodes: ["atomic_candidate_rejected_by_typed_plan"] };
}
