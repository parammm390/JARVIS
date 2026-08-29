import { OPERATIONAL_QUERY_INTENTS, type CanonicalOperationalQueryIntent } from "@finnor/shared-types";
import type { InstructionExecutionModel } from "./instruction-routing";
import type { PluginRegistry, RegisteredActionDefinition } from "./plugin-registry";

export type UserCapabilityKind = "ACTION" | "QUERY";

export interface UserCapability {
  id: string;
  kind: UserCapabilityKind;
  capability: string;
  label: string;
  canonicalRoute: InstructionExecutionModel;
  reachableRoutes: InstructionExecutionModel[];
  payloadFields: string[];
  requiredPayloadFields: string[];
  targetFields: string[];
  dateFields: string[];
  exampleUtterance: string;
  sourceOwner: string;
}

const QUERY_FIELDS: Record<CanonicalOperationalQueryIntent, readonly string[]> = {
  customer_lookup: ["householdId", "query", "name", "address", "contact", "phone", "page", "asOf"],
  customer_cohort: ["cohort", "minDaysInactive", "asOf", "page"],
  schedule_range: ["range", "localDateRange", "page"],
  money_summary: ["range", "start", "end", "page"],
  work_list: ["section", "openOnly", "statuses", "recordId", "page"],
  inventory_status: ["sku", "lowStockOnly", "includeOpenProcurement", "page"],
  agent_activity: ["range", "localDateRange", "page"],
  business_state: ["page"],
  company_context: ["anchor", "householdId", "query"],
  party_lookup: ["ref", "query", "page"],
  party_context: ["ref", "query", "page"],
  team_roster: ["teamRef", "query", "page"],
  party_availability: ["ref", "query", "localDateRange", "includeCapacity", "page"],
};

const QUERY_REQUIRED_FIELDS: Partial<Record<CanonicalOperationalQueryIntent, readonly string[]>> = {
  customer_cohort: ["cohort", "minDaysInactive"],
};

const TARGET_FIELD = /(?:Id|Ids|Ref|Refs)$/;
const DIRECT_TARGET_FIELD = /^(?:to|phone|contactPhone|email|address|recipient|recipients|participants|target)$/;
const DATE_FIELD = /(?:Date|Time|At|Deadline|DueAt|Range|WindowDays)$|^(?:date|deadline|range|windowDays)$/;

function label(value: string): string {
  return value.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function targetFields(fields: readonly string[]): string[] {
  return fields.filter((field) => TARGET_FIELD.test(field) || DIRECT_TARGET_FIELD.test(field));
}

function dateFields(fields: readonly string[]): string[] {
  return fields.filter((field) => DATE_FIELD.test(field));
}

function actionCapability(definition: RegisteredActionDefinition): UserCapability {
  const clarification = definition.actionType === "clarification_request";
  return {
    id: `action:${definition.actionType}`,
    kind: "ACTION",
    capability: definition.actionType,
    label: label(definition.actionType),
    canonicalRoute: clarification ? "CLARIFY" : "ATOMIC_ACTION",
    reachableRoutes: clarification ? ["CLARIFY"] : ["ATOMIC_ACTION", "OBJECTIVE"],
    payloadFields: definition.payloadFields,
    requiredPayloadFields: definition.requiredPayloadFields,
    targetFields: targetFields(definition.payloadFields),
    dateFields: dateFields(definition.payloadFields),
    exampleUtterance: `${label(definition.actionType)} using the exact people, records, dates, and values I provide.`,
    sourceOwner: `plugin:${definition.plugin}`,
  };
}

function queryCapability(intent: CanonicalOperationalQueryIntent): UserCapability {
  const fields = [...QUERY_FIELDS[intent]];
  return {
    id: `query:${intent}`,
    kind: "QUERY",
    capability: intent,
    label: label(intent),
    canonicalRoute: "QUERY",
    reachableRoutes: ["QUERY"],
    payloadFields: fields,
    requiredPayloadFields: [...(QUERY_REQUIRED_FIELDS[intent] ?? [])],
    targetFields: targetFields(fields),
    dateFields: dateFields(fields),
    exampleUtterance: `Show me ${label(intent).toLowerCase()} from current company data.`,
    sourceOwner: "canonical-operational-query-plane",
  };
}

export class UserCapabilityRegistry {
  private readonly byId: ReadonlyMap<string, UserCapability>;

  constructor(private readonly rows: readonly UserCapability[]) {
    const ids = new Set<string>();
    const capabilities = new Set<string>();
    for (const row of rows) {
      if (ids.has(row.id)) throw new Error(`Duplicate user capability id: ${row.id}`);
      if (capabilities.has(row.capability)) throw new Error(`Duplicate user capability: ${row.capability}`);
      ids.add(row.id);
      capabilities.add(row.capability);
    }
    this.byId = new Map(rows.map((row) => [row.id, row]));
  }

  all(): UserCapability[] {
    return this.rows.map((row) => ({ ...row, reachableRoutes: [...row.reachableRoutes], payloadFields: [...row.payloadFields], requiredPayloadFields: [...row.requiredPayloadFields], targetFields: [...row.targetFields], dateFields: [...row.dateFields] }));
  }

  actions(): UserCapability[] {
    return this.all().filter((row) => row.kind === "ACTION");
  }

  queries(): UserCapability[] {
    return this.all().filter((row) => row.kind === "QUERY");
  }

  get(id: string): UserCapability | undefined {
    const row = this.byId.get(id);
    return row ? { ...row, reachableRoutes: [...row.reachableRoutes], payloadFields: [...row.payloadFields], requiredPayloadFields: [...row.requiredPayloadFields], targetFields: [...row.targetFields], dateFields: [...row.dateFields] } : undefined;
  }

  /** Bounded catalog inserted into the planner contract. Query capabilities are
   * marked as already handled by the deterministic read lane, never emitted as
   * action_type values. */
  plannerCatalog(): string {
    const actions = this.rows.filter((row) => row.kind === "ACTION").map((row) => row.capability).join(", ");
    const queries = this.rows.filter((row) => row.kind === "QUERY").map((row) => row.capability).join(", ");
    return `ACTION capabilities: ${actions}\nQUERY capabilities (pre-planner only): ${queries}`;
  }
}

export function createUserCapabilityRegistry(plugins: PluginRegistry): UserCapabilityRegistry {
  return new UserCapabilityRegistry([
    ...plugins.actionDefinitions().map(actionCapability),
    ...OPERATIONAL_QUERY_INTENTS.map(queryCapability),
  ]);
}
