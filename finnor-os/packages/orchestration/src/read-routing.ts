const READ_QUESTION = /^(?:how|what|which|where|when|who|is|are|do|does|did|can|could|tell me|show me|give me|summarize|explain)\b|\?\s*$/i;
const BUSINESS_READ = /\b(?:business|revenue|cash|invoice|payment|customer|household|lead|inventory|stock|schedule|visit|appointment|technician|campaign|ads?|marketing|approval|workflow|work|service|water|equipment|integration)\b/i;
const RESEARCH_READ = /\b(?:research|search(?: the)? web|look up|online|latest|current (?:news|benchmark|market|source|industry)|competitor|market|reviews?|weather|benchmarks?|sources?|source-backed|cite|citations?)\b/i;
const MUTATION_REQUEST = /\b(?:create|send|record|update|change|delete|remove|approve|reject|schedule|book|call|text|email|pay|charge|reorder|restock|launch|assign|execute|run|start|reschedule)\b/i;

export interface SafeReadFallback {
  action_type: "answer_business_question" | "search_web";
  payload: Record<string, unknown>;
  reasoning: string;
}

/** If a provider returns malformed JSON or filters down to no registered action,
 * preserve safe read behavior without guessing a write. Research is routed to the
 * real web stack; internal business questions go to the grounded overview action. */
export function safeReadFallbackForInstruction(instruction: string, actionTypes: readonly string[]): SafeReadFallback | null {
  const normalized = instruction.trim().replace(/\s+/g, " ");
  if (!normalized || MUTATION_REQUEST.test(normalized)) return null;
  if (RESEARCH_READ.test(normalized) && actionTypes.includes("search_web")) {
    return { action_type: "search_web", payload: { query: normalized }, reasoning: "Safe read fallback after the model returned no usable plan." };
  }
  if ((READ_QUESTION.test(normalized) || BUSINESS_READ.test(normalized)) && actionTypes.includes("answer_business_question")) {
    return { action_type: "answer_business_question", payload: { question: normalized }, reasoning: "Grounded business-question fallback after the model returned no usable plan." };
  }
  return null;
}

/** The planner model occasionally treats an external-research question as a
 * generic business-data question. That bypasses Exa entirely and lets the
 * overview model answer from tenant context, which is exactly the wrong contract
 * for requests containing "latest", "benchmark", "source", or "cite". A safe,
 * read-only research intent may therefore replace only the generic answer action;
 * it never rewrites a mutation or a narrower domain action. */
export function enforceExternalResearchRoute(
  instruction: string,
  actions: Array<{ action_type: string; payload: Record<string, unknown>; reasoning?: string; depends_on?: number[] }>,
  actionTypes: readonly string[],
) {
  const normalized = instruction.trim().replace(/\s+/g, " ");
  if (
    !normalized ||
    MUTATION_REQUEST.test(normalized) ||
    !RESEARCH_READ.test(normalized) ||
    !actionTypes.includes("search_web") ||
    actions.length !== 1 ||
    actions[0]?.action_type !== "answer_business_question"
  ) return actions;
  return [{
    action_type: "search_web",
    payload: { query: normalized },
    reasoning: "External/current/source-backed question routed through the registered web research stack.",
  }];
}

const SCHEDULING_MUTATION = /\b(?:schedule|book|reschedule)\b[\s\S]{0,100}\b(?:appointment|visit|water\s+test|service)\b|\b(?:appointment|visit|water\s+test|service)\b[\s\S]{0,100}\b(?:schedule|book|reschedule)\b/i;
const READ_ONLY_ANSWER_ACTIONS = new Set(["answer_business_question", "search_web"]);

export interface SchedulingClarificationFallback {
  action_type: "clarification_request";
  payload: { question: string; missingFields: string[]; context: string };
  reasoning: string;
}

export interface ClarificationContinuationAction {
  action_type: "start_water_test_workflow" | "clarification_request";
  payload: Record<string, unknown>;
  reasoning: string;
}

/**
 * Compile the one safe, fully-grounded continuation that can be completed without
 * another planner call: a water-test appointment for the already-resolved
 * household. The household id and phone come from the authenticated tenant
 * memory, never from the user's terse answer. If either is absent, preserve the
 * continuation as a narrower clarification rather than guessing an identity.
 */
export function clarificationContinuationAction(
  instruction: string,
  planningInstruction: string,
  memory: MemorySnapshot,
  actionTypes: readonly string[],
): ClarificationContinuationAction | null {
  if (planningInstruction === instruction || !actionTypes.includes("start_water_test_workflow")) return null;
  const scheduledAt = instruction.match(/\bscheduledAt\s*:\s*([^;\n]+)/i)?.[1]?.trim();
  const serviceType = instruction.match(/\bserviceType\s*:\s*([^;\n]+)/i)?.[1]?.trim();
  if (!scheduledAt || !serviceType || !/water\s*test/i.test(serviceType)) return null;
  const longTerm = memory.longTerm && typeof memory.longTerm === "object" ? memory.longTerm as Record<string, unknown> : null;
  const household = longTerm?.household && typeof longTerm.household === "object" ? longTerm.household as Record<string, unknown> : null;
  const householdId = typeof household?.id === "string" ? household.id : null;
  const contactInfo = household?.contactInfo && typeof household.contactInfo === "object" ? household.contactInfo as Record<string, unknown> : null;
  const phoneNumber = typeof contactInfo?.phone === "string" ? contactInfo.phone : typeof contactInfo?.phoneNumber === "string" ? contactInfo.phoneNumber : null;
  const customerLabel = typeof contactInfo?.name === "string" ? contactInfo.name : "this customer";
  if (!householdId || !phoneNumber) {
    return {
      action_type: "clarification_request",
      payload: {
        question: !householdId
          ? "Which household should I use for this water-test appointment?"
          : `What phone number should I use to confirm the water-test appointment with ${customerLabel}?`,
        missingFields: [!householdId ? "householdId" : "phoneNumber"],
        context: `Continuation of: ${planningInstruction.slice(0, 900)}`,
      },
      reasoning: "The supplied appointment details are clear, but a real customer identifier is still required before drafting the booking.",
    };
  }
  return {
    action_type: "start_water_test_workflow",
    payload: { householdId, scheduledAt, phoneNumber },
    reasoning: "Completed the water-test scheduling continuation from the authenticated household record and the supplied date/time.",
  };
}

/**
 * A scheduling mutation cannot be safely guessed when the planning provider is
 * unavailable. Keep this fallback deliberately write-free: it creates the same
 * first-class clarification card the normal planner route would create, so a
 * transient LLM/provider failure never becomes a generic 500 or a fabricated
 * appointment.
 */
export function schedulingClarificationFallbackForInstruction(
  instruction: string,
  actionTypes: readonly string[],
): SchedulingClarificationFallback | null {
  const normalized = instruction.trim().replace(/\s+/g, " ");
  if (!normalized || !SCHEDULING_MUTATION.test(normalized) || !actionTypes.includes("clarification_request")) return null;
  return {
    action_type: "clarification_request",
    payload: {
      question: "What date and time should I use, and what service should this appointment cover?",
      missingFields: ["scheduledAt", "serviceType"],
      context: `Scheduling request: ${normalized.slice(0, 700)}`,
    },
    reasoning: "The scheduling provider was unavailable, so JARVIS preserved the request as a safe clarification instead of guessing a booking.",
  };
}

/** A scheduling command must never terminate as an informational answer merely
 * because the model was biased by a prior read turn. Preserve any real scheduling
 * or clarification action the planner produced. If it produced only read answers
 * (or nothing), fail safely into a durable question instead of inventing a booking. */
export function enforceSchedulingMutationRoute(
  instruction: string,
  actions: Array<{ action_type: string; payload: Record<string, unknown>; reasoning?: string; depends_on?: number[] }>,
  actionTypes: readonly string[],
) {
  const normalized = instruction.trim().replace(/\s+/g, " ");
  if (!SCHEDULING_MUTATION.test(normalized)) return actions;
  if (actions.some((action) => !READ_ONLY_ANSWER_ACTIONS.has(action.action_type))) return actions;
  if (!actionTypes.includes("clarification_request")) return [];
  return [schedulingClarificationFallbackForInstruction(normalized, actionTypes)!];
}
import type { MemorySnapshot } from "@finnor/shared-types";
