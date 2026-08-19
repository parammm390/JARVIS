// B2.T5: the planner consumes the same tenant integration rows and durable circuit
// state that execution uses.  This keeps an unavailable provider from becoming a
// pending action that is guaranteed to fail later.

import { tenantIntegrations, withTenant } from "@finnor/db";
import { circuitSnapshot, resolveCapabilityBindingsForTenant, type CapabilityBindingsReport } from "@finnor/tools";
import { eq } from "drizzle-orm";

type Capability = keyof CapabilityBindingsReport;

const CAPABILITIES = [
  "scheduling",
  "documents",
  "inventory",
  "crm",
  "communications",
  "esign",
  "accounting",
  "payments",
  "marketing",
] as const satisfies readonly Capability[];

export interface PlanningCapabilityHealth {
  capability: Capability;
  binding: string;
  source: "tenant" | "env" | "default";
  health: "ok" | "degraded" | "down" | "unknown";
  circuit: "closed" | "open";
  unavailable: boolean;
  reason: string | null;
}

export type PlanningHealthContext = Record<Capability, PlanningCapabilityHealth>;

/**
 * Health is advisory to the model and authoritative for the deterministic
 * post-plan safeguard below.  A tenant-row health=down or an open durable circuit
 * blocks a provider-backed action; "degraded" remains visible context but does not
 * pretend that a circuit is open.
 */
export async function buildPlanningHealthContext(tenantId: string): Promise<PlanningHealthContext> {
  const [bindings, integrationRows] = await Promise.all([
    resolveCapabilityBindingsForTenant(tenantId),
    withTenant(tenantId, (db) => db.select().from(tenantIntegrations).where(eq(tenantIntegrations.tenantId, tenantId))),
  ]);
  const providerNames = [...new Set(CAPABILITIES.map((capability) => bindings[capability].mode))];
  const circuits = await Promise.all(providerNames.map((provider) => circuitSnapshot(provider, tenantId)));
  const integrationByCapability = new Map(integrationRows.map((row) => [row.capability, row]));
  const circuitByProvider = new Map(circuits.map((row) => [row.provider, row]));

  return Object.fromEntries(
    CAPABILITIES.map((capability) => {
      const resolution = bindings[capability];
      const integration = integrationByCapability.get(capability);
      const circuit = circuitByProvider.get(resolution.mode);
      const circuitOpen = circuit?.state === "open";
      const health = integration?.health ?? "unknown";
      const down = health === "down";
      const reason = circuitOpen
        ? `${resolution.mode} circuit breaker is open after repeated real-call failures.`
        : down
          ? `Integration health is down${integration?.lastError ? `: ${integration.lastError}` : "."}`
          : null;
      return [
        capability,
        {
          capability,
          binding: resolution.mode,
          source: resolution.source,
          health,
          circuit: circuitOpen ? "open" : "closed",
          unavailable: circuitOpen || down,
          reason,
        } satisfies PlanningCapabilityHealth,
      ];
    }),
  ) as PlanningHealthContext;
}

/** Exact provider-backed paths in the current plugins.  We deliberately do not
 * infer a capability for actions that only write Finnor's native data model. */
function requiredCapabilities(actionType: string, payload: Record<string, unknown>): Capability[] {
  switch (actionType) {
    case "bulk_notify_existing_customers":
      return payload.channel === "call" ? ["communications"] : ["crm"];
    case "send_proposal":
      return payload.channel === "sms" ? ["crm"] : [];
    case "send_customer_message":
    case "send_follow_up":
      return payload.channel === "email" ? [] : ["crm"];
    case "send_payment_reminder":
      return payload.channel === "call" ? ["communications"] : payload.channel === "email" ? [] : ["crm"];
    case "call_overdue_invoices":
      return ["communications"];
    case "summarize_ad_performance":
    case "launch_ad_campaign":
      return ["marketing"];
    case "create_review_request":
      // The configured policy selects email or SMS after planning.  CRM is the
      // only possible provider-backed SMS path, so fail closed while it is down.
      return ["crm"];
    default:
      return [];
  }
}

export interface ManualStepSuggestion {
  actionType: "manual_step_suggestion";
  payload: {
    originalActionType: string;
    originalPayload: Record<string, unknown>;
    unavailableCapabilities: Capability[];
    reason: string;
  };
}

/** Deterministic final guard: model prompt compliance is useful, but it is never
 * the thing that enforces an open circuit. */
export function manualStepForUnavailableIntegration(
  actionType: string,
  payload: Record<string, unknown>,
  health: PlanningHealthContext,
): ManualStepSuggestion | null {
  const unavailable = requiredCapabilities(actionType, payload).filter((capability) => health[capability].unavailable);
  if (unavailable.length === 0) return null;
  const details = unavailable.map((capability) => `${capability}: ${health[capability].reason ?? "integration unavailable"}`);
  return {
    actionType: "manual_step_suggestion",
    payload: {
      originalActionType: actionType,
      originalPayload: payload,
      unavailableCapabilities: unavailable,
      reason: `Cannot safely run ${actionType.replaceAll("_", " ")} because ${details.join("; ")}`,
    },
  };
}
