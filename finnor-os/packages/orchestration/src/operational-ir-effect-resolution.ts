import {
  applicationAccounts,
  authProfiles,
  communicationIdentities,
  tenantIntegrations,
  withTenant,
} from "@finnor/db";
import {
  AUDITED_OPERATION_EFFECT_CATALOG,
  AUDITED_QUERY_EFFECT_CATALOG,
  type EffectDimension,
  type StaticCapabilityResolutionRequest,
  type StaticCapabilityResolutionResponse,
  type StaticEntityResolutionRequest,
  type StaticEntityResolutionResponse,
  type StaticResolutionProvider,
} from "@finnor/operational-ir";
import { and, eq, inArray, sql } from "drizzle-orm";
import { ACTION_HARDENING_SPEC_BY_ACTION } from "../../../scripts/release/action-hardening-spec";

type IntegrationCapability = "scheduling" | "documents" | "inventory" | "crm" | "communications" | "esign" | "accounting" | "payments" | "marketing";
const INTEGRATION_CAPABILITIES = new Set<IntegrationCapability>(["scheduling", "documents", "inventory", "crm", "communications", "esign", "accounting", "payments", "marketing"]);

async function resolveEntity(request: StaticEntityResolutionRequest): Promise<StaticEntityResolutionResponse> {
  const result = await withTenant(request.trustedTenantId, (db) => request.kind === "party"
    ? db.execute<{ tenant_id: string | null }>(sql`SELECT finnor_os.party_ref_tenant(${request.type}, ${request.id}::uuid)::text tenant_id`)
    : db.execute<{ tenant_id: string | null }>(sql`SELECT finnor_os.canonical_entity_tenant(${request.type}, ${request.id}::uuid)::text tenant_id`));
  const tenantId = result.rows[0]?.tenant_id ?? null;
  if (!tenantId) return { status: "MISSING" };
  if (tenantId !== request.trustedTenantId) return { status: "CROSS_TENANT", tenantId };
  return { status: "EXISTS", tenantId, type: request.type };
}

function supportsAll(supported: EffectDimension[], required: EffectDimension[]): boolean {
  return required.every((dimension) => supported.includes(dimension));
}

async function configuredBinding(request: StaticCapabilityResolutionRequest, operation: string): Promise<boolean | "NOT_REQUIRED"> {
  const row = ACTION_HARDENING_SPEC_BY_ACTION.get(operation);
  if (!row?.external || !request.requiresConfiguredBinding) return "NOT_REQUIRED";
  if (operation === "computer_task") {
    if (request.computerApplications.length !== 1) return false;
    const [profile] = await withTenant(request.trustedTenantId, (db) => db.select({ id: authProfiles.id })
      .from(authProfiles)
      .innerJoin(applicationAccounts, and(
        eq(applicationAccounts.tenantId, request.trustedTenantId),
        eq(applicationAccounts.id, authProfiles.applicationAccountId),
        eq(applicationAccounts.application, request.computerApplications[0]!),
        eq(applicationAccounts.status, "active"),
      ))
      .where(and(
        eq(authProfiles.tenantId, request.trustedTenantId),
        eq(authProfiles.status, "active"),
        eq(authProfiles.connectionStatus, "active"),
      ))
      .limit(1));
    return Boolean(profile);
  }
  if (operation === "send_message") {
    const [identity] = await withTenant(request.trustedTenantId, (db) => db.select({ id: communicationIdentities.id })
      .from(communicationIdentities)
      .where(and(eq(communicationIdentities.tenantId, request.trustedTenantId), eq(communicationIdentities.status, "active")))
      .limit(1));
    if (identity) return true;
  }
  const families = row.capabilityFamily.split("/").filter((family): family is IntegrationCapability => INTEGRATION_CAPABILITIES.has(family as IntegrationCapability));
  if (families.length === 0) return "NOT_REQUIRED";
  const [integration] = await withTenant(request.trustedTenantId, (db) => db.select({ id: tenantIntegrations.id })
    .from(tenantIntegrations)
    .where(and(
      eq(tenantIntegrations.tenantId, request.trustedTenantId),
      inArray(tenantIntegrations.capability, families),
    ))
    .limit(1));
  return Boolean(integration);
}

async function resolveCapability(request: StaticCapabilityResolutionRequest): Promise<StaticCapabilityResolutionResponse> {
  if (request.capability.startsWith("query:")) {
    const intent = request.capability.slice("query:".length);
    if (!AUDITED_QUERY_EFFECT_CATALOG[intent]) return { status: "MISSING" };
    const supported: EffectDimension[] = ["READ", "PII", "AUTHORITY", "REVERSIBILITY", "OBSERVATION"];
    return supportsAll(supported, request.requiredDimensions)
      ? { status: "EXISTS", supportedDimensions: supported, configured: "NOT_REQUIRED" }
      : { status: "INCOMPATIBLE", supportedDimensions: supported };
  }
  if (!request.capability.startsWith("action:")) return { status: "MISSING" };
  const operation = request.capability.slice("action:".length);
  const catalog = AUDITED_OPERATION_EFFECT_CATALOG[operation];
  const runtime = ACTION_HARDENING_SPEC_BY_ACTION.get(operation);
  if (!catalog || !runtime) return { status: "MISSING" };
  // Existing CapabilityContract piiAllowlist/redaction semantics can represent PII
  // handling for governed communications, even though PII is not mandatory for
  // every send_message invocation.
  const supported = [...new Set([
    ...catalog.requiredDimensions,
    ...(operation === "send_message" ? ["PII" as const] : []),
    ...(["launch_ad_campaign", "computer_task"].includes(operation) ? ["READ" as const] : []),
  ])] as EffectDimension[];
  if (!supportsAll(supported, request.requiredDimensions)) return { status: "INCOMPATIBLE", supportedDimensions: supported };
  return {
    status: "EXISTS",
    supportedDimensions: supported,
    configured: await configuredBinding(request, operation),
  };
}

/** Tenant identity enters only through StaticResolutionContext, never through IR. */
export const finnorStaticResolutionProvider: StaticResolutionProvider = {
  resolveEntity,
  resolveCapability,
};
