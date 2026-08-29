import type {
  DomainAction,
  EmployeeConversationContext,
  OperatingInteractionContext,
} from "@finnor/shared-types";
import type { OperationalQueryDecision } from "./fast-read-lane";
import {
  classifyInstructionRoute,
  finalizeInstructionRoute,
  type InstructionRouteDecision,
} from "./instruction-routing";
import type { UserCapabilityRegistry } from "./user-capability-registry";

export const HUMAN_OPERATING_COMPILER_VERSION = 1 as const;

export interface CompiledHumanOperation {
  version: typeof HUMAN_OPERATING_COMPILER_VERSION;
  route: InstructionRouteDecision["route"];
  capability: string;
  target: {
    scope: "tenant" | "canonical" | "direct" | "ambiguous";
    values: Record<string, unknown>;
  };
  date: {
    scope: "current" | "explicit";
    values: Record<string, unknown>;
  };
  payload: Record<string, unknown>;
  reasonCodes: string[];
}

export interface HumanInstructionCompileInput {
  instruction: string;
  fastReadDecision: OperationalQueryDecision;
  activeContext?: OperatingInteractionContext | Record<string, unknown>;
  conversationContext?: EmployeeConversationContext;
  conversational?: boolean;
}

/** The canonical intake seam. API and orchestrator both call this wrapper, so
 * English routing cannot diverge between the public boundary and execution. */
export function compileHumanInstructionRoute(input: HumanInstructionCompileInput): InstructionRouteDecision {
  return classifyInstructionRoute({
    instruction: input.instruction,
    fastReadDecision: input.fastReadDecision,
    activeContext: input.activeContext,
    conversational: input.conversational,
    clarificationRequired: input.conversationContext?.resolution.status === "clarification_required",
  });
}

function pickPayloadValues(payload: Record<string, unknown>, fields: readonly string[]): Record<string, unknown> {
  return Object.fromEntries(fields.flatMap((field) => payload[field] === undefined ? [] : [[field, payload[field]]]));
}

function contextTargets(input: HumanInstructionCompileInput): Record<string, unknown> {
  const selected = input.activeContext && "selectedEntities" in input.activeContext && Array.isArray(input.activeContext.selectedEntities)
    ? input.activeContext.selectedEntities
    : [];
  const focused = input.activeContext && "focusedEntity" in input.activeContext ? input.activeContext.focusedEntity : undefined;
  const resolved = input.conversationContext?.resolution.resolvedReferences ?? [];
  return {
    ...(selected.length > 0 ? { selectedEntities: selected } : {}),
    ...(focused ? { focusedEntity: focused } : {}),
    ...(resolved.length > 0 ? { resolvedReferences: resolved.map(({ entityType, entityId }) => ({ entityType, entityId })) } : {}),
  };
}

function operationForQuery(
  decision: Extract<OperationalQueryDecision, { route: "fast_read" }>,
  reasonCodes: string[],
  registry: UserCapabilityRegistry,
  input: HumanInstructionCompileInput,
): CompiledHumanOperation {
  const entry = registry.get(`query:${decision.request.intent}`);
  if (!entry) throw new Error(`Operational query capability is not registered: ${decision.request.intent}`);
  const { intent: _intent, ...payload } = decision.request;
  const targetValues = { ...pickPayloadValues(payload, entry.targetFields), ...contextTargets(input) };
  const dateValues = pickPayloadValues(payload, entry.dateFields);
  return {
    version: 1,
    route: "QUERY",
    capability: entry.capability,
    target: { scope: Object.keys(targetValues).length > 0 ? "canonical" : "tenant", values: targetValues },
    date: { scope: Object.keys(dateValues).length > 0 ? "explicit" : "current", values: dateValues },
    payload,
    reasonCodes,
  };
}

/** Final typed operation envelope. It is intentionally derived from registered
 * schemas and grounded DomainActions, never from a second NLP guess. */
export function compileTypedHumanOperation(input: HumanInstructionCompileInput & {
  preliminary: InstructionRouteDecision;
  actions?: DomainAction[];
  registry: UserCapabilityRegistry;
}): CompiledHumanOperation {
  if (input.preliminary.route === "QUERY") {
    const queryDecision = input.preliminary.queryDecision ?? input.fastReadDecision;
    if (queryDecision.route !== "fast_read") throw new Error("QUERY route has no typed operational query");
    return operationForQuery(queryDecision, input.preliminary.reasonCodes, input.registry, input);
  }

  const actions = input.actions ?? [];
  const final = actions.length > 0 ? finalizeInstructionRoute(input.preliminary, actions) : input.preliminary;
  if (final.route === "CLARIFY") {
    const action = actions[0];
    const payload = action?.actionType === "clarification_request"
      ? action.payload
      : {
          question: input.conversationContext?.resolution.clarificationQuestion ?? "Which current target should I use?",
          missingFields: input.conversationContext?.resolution.unresolvedExpressions ?? ["target"],
        };
    return {
      version: 1,
      route: "CLARIFY",
      capability: "clarification_request",
      target: { scope: "ambiguous", values: contextTargets(input) },
      date: { scope: "current", values: {} },
      payload,
      reasonCodes: final.reasonCodes,
    };
  }

  if (final.route === "ATOMIC_ACTION") {
    if (actions.length !== 1) throw new Error("ATOMIC_ACTION requires exactly one typed DomainAction");
    const action = actions[0]!;
    const entry = input.registry.get(`action:${action.actionType}`);
    if (!entry) throw new Error(`Action capability is not registered: ${action.actionType}`);
    if (action.groundedPayload?.some((field) => field.status === "not_found")) {
      throw new Error("Consequential target failed canonical grounding and cannot compile as ATOMIC_ACTION");
    }
    const context = contextTargets(input);
    const directTargets = pickPayloadValues(action.payload, entry.targetFields);
    const targets = { ...context, ...directTargets };
    const dates = pickPayloadValues(action.payload, entry.dateFields);
    return {
      version: 1,
      route: "ATOMIC_ACTION",
      capability: entry.capability,
      target: { scope: Object.keys(context).length > 0 ? "canonical" : Object.keys(directTargets).length > 0 ? "direct" : "tenant", values: targets },
      date: { scope: Object.keys(dates).length > 0 ? "explicit" : "current", values: dates },
      payload: action.payload,
      reasonCodes: final.reasonCodes,
    };
  }

  if (final.route === "OBJECTIVE") return {
    version: 1,
    route: "OBJECTIVE",
    capability: "durable_objective",
    target: { scope: Object.keys(contextTargets(input)).length > 0 ? "canonical" : "tenant", values: contextTargets(input) },
    date: { scope: "current", values: {} },
    payload: { objective: input.instruction },
    reasonCodes: final.reasonCodes,
  };

  return {
    version: 1,
    route: "CONVERSATION",
    capability: "conversation",
    target: { scope: "tenant", values: {} },
    date: { scope: "current", values: {} },
    payload: { message: input.instruction },
    reasonCodes: final.reasonCodes,
  };
}

export function assertCompiledHumanOperation(value: CompiledHumanOperation): void {
  if (!value.route || !value.capability || !value.target || !value.date || !value.payload) {
    throw new Error("Human Operating Compiler output is missing route + capability + target + date + payload");
  }
}
