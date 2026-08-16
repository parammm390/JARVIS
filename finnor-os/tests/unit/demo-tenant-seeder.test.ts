import { describe, expect, it } from "vitest";
import {
  DEFAULT_DEMO_LEAD_COUNT,
  DEMO_AS_OF_ISO,
  assertDemoSeedEnvironment,
  generateDemoSeedData,
  validateDemoSeedData,
  validateDemoTenantConfig,
} from "../../scripts/seed-demo-tenant";

const DEMO_TENANT_ID = "11111111-1111-4111-8111-111111111111";
const DEMO_TENANT_NAME = "Suncoast Demo Water Co";

function config() {
  return { tenantId: DEMO_TENANT_ID, tenantName: DEMO_TENANT_NAME };
}

describe("high-fidelity demo tenant seed", () => {
  it("refuses production and remote databases unless remote demo seeding is explicitly enabled", () => {
    expect(() => assertDemoSeedEnvironment({ FINNOR_ENVIRONMENT: "production", DATABASE_URL: "postgres://localhost/finnor" })).toThrow(/disabled in production/i);
    expect(() => assertDemoSeedEnvironment({ DATABASE_URL: "postgres://remote.example/finnor" })).toThrow(/remote demo seeding is disabled/i);
    expect(() => assertDemoSeedEnvironment({ DATABASE_URL: "postgres://remote.example/finnor", FINNOR_ALLOW_REMOTE_DEMO_SEED: "1" })).not.toThrow();
    expect(() => assertDemoSeedEnvironment({ DATABASE_URL: "postgres://localhost/finnor" })).not.toThrow();
  });

  it("fails closed without a clearly identified, unprotected demo tenant", () => {
    expect(() => validateDemoTenantConfig({ tenantId: "", tenantName: "" })).toThrow(/explicit demo tenant/i);
    expect(() => validateDemoTenantConfig({ tenantId: "not-a-uuid", tenantName: DEMO_TENANT_NAME })).toThrow(/valid explicit demo tenant id/i);
    expect(() => validateDemoTenantConfig({ tenantId: "00000000-0000-4000-8000-000000000001", tenantName: "Seed Demo Tenant" })).toThrow(/protected|default/i);
    expect(() => validateDemoTenantConfig({ tenantId: DEMO_TENANT_ID, tenantName: "Suncoast Water Company" })).toThrow(/clearly identify/i);
    expect(() => validateDemoTenantConfig({ tenantId: DEMO_TENANT_ID, tenantName: "Production Demo Water Co" })).toThrow(/production-like/i);
  });

  it("generates a deterministic one-thousand-lead operating company", () => {
    const first = generateDemoSeedData(config());
    const second = generateDemoSeedData(config());
    const validation = validateDemoSeedData(first);

    expect(first).toEqual(second);
    expect(first.asOf.toISOString()).toBe(DEMO_AS_OF_ISO);
    expect(first.leads).toHaveLength(DEFAULT_DEMO_LEAD_COUNT);
    expect(first.households).toHaveLength(DEFAULT_DEMO_LEAD_COUNT);
    expect(new Set(first.leads.map((lead) => lead.id)).size).toBe(DEFAULT_DEMO_LEAD_COUNT);
    expect(new Set(first.leads.map((lead) => lead.externalId)).size).toBe(DEFAULT_DEMO_LEAD_COUNT);
    expect(validation.valid).toBe(true);
    expect(validation.errors).toEqual([]);
    expect(validation.leadStatuses).toEqual({ new: 290, contacted: 230, qualified: 190, converted: 210, disqualified: 80 });
  });

  it("keeps every generated entity in the requested tenant and preserves relational links", () => {
    const data = generateDemoSeedData(config());
    const validation = validateDemoSeedData(data);
    const householdIds = new Set(data.households.map((row) => row.id));
    const opportunityIds = new Set(data.opportunities.map((row) => row.id));
    const quoteIds = new Set(data.quotes.map((row) => row.id));
    const invoiceIds = new Set(data.invoices.map((row) => row.id));
    const userIds = new Set(data.users.map((row) => row.id));
    const authorityRoleIds = new Set(data.employeeRoles.map((row) => row.id));

    expect(validation.valid).toBe(true);
    expect(data.contacts.length).toBeGreaterThan(data.leads.length);
    expect(data.contactMethods.length).toBeGreaterThan(data.contacts.length);
    expect(data.opportunities.length).toBeGreaterThan(600);
    expect(data.quotes.length).toBeGreaterThan(450);
    expect(data.workOrders.length).toBeGreaterThan(200);
    expect(data.appointments.length).toBeGreaterThan(500);
    expect(data.payments.every((payment) => invoiceIds.has(payment.invoiceId))).toBe(true);
    expect(data.quotes.every((quote) => !quote.opportunityId || opportunityIds.has(quote.opportunityId))).toBe(true);
    expect(data.workOrders.every((workOrder) => workOrder.quoteId != null && quoteIds.has(workOrder.quoteId))).toBe(true);
    expect(data.leads.every((lead) => lead.tenantId === DEMO_TENANT_ID && lead.householdId != null && householdIds.has(lead.householdId))).toBe(true);
    expect(data.employeeRoleAssignments.every((assignment) => userIds.has(assignment.employeeId) && authorityRoleIds.has(assignment.roleId))).toBe(true);
    expect(data.employeeRoleAssignments.some((assignment) => (assignment.resourceScope as { kind?: string } | null)?.kind === "assigned" && assignment.active === false)).toBe(true);
    expect(data.domainPolicies.length).toBeGreaterThanOrEqual(10);
    expect(data.authorityApprovalRequests.some((request) => request.status === "pending")).toBe(true);
    expect(data.domainActions.some((action) => action.status === "failed")).toBe(true);
    expect(data.domainActions.some((action) => action.status === "blocked_integration_unavailable")).toBe(true);
    expect(data.workflowStates.some((workflow) => workflow.state === "recovery")).toBe(true);
    expect(data.invoices.some((invoice) => invoice.status === "overdue")).toBe(true);
    expect(data.payments.some((payment) => payment.status === "failed")).toBe(true);
    expect(data.maintenanceAgreements.some((agreement) => agreement.status === "renewal_window")).toBe(true);
    expect(data.maintenanceAgreements.some((agreement) => agreement.status === "lapsed")).toBe(true);
    expect(data.inventoryItems.some((item) => item.quantity! < item.reorderThreshold!)).toBe(true);
  });

  it("namespaces stable ids by tenant so two demo tenants cannot collide", () => {
    const first = generateDemoSeedData(config());
    const second = generateDemoSeedData({ tenantId: "22222222-2222-4222-8222-222222222222", tenantName: DEMO_TENANT_NAME });

    expect(first.leads[0]!.id).not.toBe(second.leads[0]!.id);
    expect(first.households[0]!.id).not.toBe(second.households[0]!.id);
    expect(first.domainActions[0]!.id).not.toBe(second.domainActions[0]!.id);
    expect(first.leads[0]!.tenantId).toBe(DEMO_TENANT_ID);
    expect(second.leads[0]!.tenantId).toBe("22222222-2222-4222-8222-222222222222");
  });
});
