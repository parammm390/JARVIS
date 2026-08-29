// Opt-in, high-fidelity demo tenant seed.
//
// This is intentionally separate from the permanent Dealer Zero and small local
// test seeds. It never chooses a tenant for the caller, never falls back to a
// default tenant, and refuses production execution. Every generated row has a
// stable UUID and a stable source key, so re-running this script is safe.

import "dotenv/config";
import {
  actionLog,
  adminDb,
  appointments,
  approvalChainSteps,
  approvalChains,
  authorityApprovalRequestSteps,
  authorityApprovalRequests,
  authorityDecisions,
  authorityStates,
  businessEvents,
  calls,
  closePool,
  contactMethods,
  contacts,
  conversations,
  domainActions,
  domainPolicies,
  domainPolicyRevisions,
  employeeRoleAssignments,
  employeeRoles,
  equipment,
  households,
  inventoryItems,
  invoices,
  leads,
  maintenanceAgreements,
  messages,
  opportunities,
  payments,
  priceBookItems,
  procurementOrders,
  proposals,
  quoteLineItems,
  quotes,
  roleAuthorityGrants,
  rolePermissions,
  scanFindings,
  serviceVisits,
  tasks,
  technicianCapacity,
  technicianDispatchProfiles,
  technicians,
  tenantSettings,
  tenantOperatingProfiles,
  tenants,
  userOperatingProfiles,
  users,
  warehouses,
  warehouseStock,
  workOrders,
  workflowStates,
  withTenant,
  type Db,
} from "@finnor/db";
import { and, eq } from "drizzle-orm";
import { createHash } from "node:crypto";
import { DEALER_ZERO_TENANT_ID } from "@finnor/shared-types";
import { SEED_TENANT_ID } from "../packages/db/seed";

export const DEMO_SEED_SOURCE = "finnor_demo_seed_v1";
export const DEFAULT_DEMO_LEAD_COUNT = 1_000;
export const DEMO_AS_OF_ISO = "2026-08-01T12:00:00.000Z";
export const DEFAULT_DEMO_TIMEZONE = "America/New_York";

const DAY_MS = 24 * 60 * 60 * 1_000;
const PROTECTED_TENANT_IDS = new Set([SEED_TENANT_ID, DEALER_ZERO_TENANT_ID]);
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DEMO_NAME_RE = /\b(demo|test|sandbox|fixture|synthetic)\b/i;
const RESERVED_NAME_RE = /\b(prod|production|live|primary|default|dealer\s*zero)\b/i;

export function assertDemoSeedEnvironment(env: Partial<NodeJS.ProcessEnv> = process.env): void {
  const environment = [env.FINNOR_ENVIRONMENT, env.VERCEL_ENV, env.NODE_ENV].filter(Boolean).join(" ").toLowerCase();
  if (/\b(?:production|prod)\b/.test(environment)) throw new Error("Demo seed is disabled in production environments");
  const databaseUrl = env.DATABASE_URL ?? env.POSTGRES_URL_NON_POOLING ?? env.POSTGRES_URL;
  if (!databaseUrl) return;
  let hostname: string;
  try {
    hostname = new URL(databaseUrl).hostname.toLowerCase();
  } catch {
    throw new Error("Demo seed database URL is invalid");
  }
  const local = hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";
  if (!local && env.FINNOR_ALLOW_REMOTE_DEMO_SEED !== "1") {
    throw new Error("Remote demo seeding is disabled; set FINNOR_ALLOW_REMOTE_DEMO_SEED=1 only for a verified isolated non-production database");
  }
}

const FIRST_NAMES = [
  "Alicia", "Andre", "Brooke", "Caleb", "Carla", "Carmen", "Chad", "Clara", "Colin", "Daisy",
  "Damon", "Daphne", "Devin", "Elena", "Elliot", "Erica", "Felix", "Gabriela", "Gavin", "Grace",
  "Hannah", "Harper", "Isaac", "Jada", "Jalen", "Jasmine", "Jonah", "Jorge", "Josie", "Kara",
  "Keegan", "Kiara", "Landon", "Leah", "Lena", "Leo", "Liam", "Lina", "Maya", "Megan",
  "Nadia", "Nate", "Noah", "Nora", "Omar", "Paige", "Parker", "Priya", "Quinn", "Rafael",
  "Rachel", "Riley", "Rosalie", "Sabrina", "Samir", "Sasha", "Sean", "Serena", "Sofia", "Tara",
  "Theo", "Tiffany", "Travis", "Valerie", "Victor", "Wesley", "Yara", "Zachary",
];

const LAST_NAMES = [
  "Alvarez", "Bennett", "Bishop", "Bowen", "Carver", "Chambers", "Coleman", "Conley", "Cortez", "Dalton",
  "Dawson", "Delgado", "Ellison", "Estrada", "Fischer", "Foley", "Foster", "Gaines", "Garcia", "Gibson",
  "Goodwin", "Hale", "Hampton", "Hendricks", "Holloway", "Holt", "Kaufman", "Keller", "Kim", "Larsen",
  "Luna", "Maldonado", "Manning", "Marsh", "Mercer", "Merritt", "Mills", "Monroe", "Navarro", "Nguyen",
  "Nolan", "Ochoa", "Okafor", "Ortega", "Patel", "Patterson", "Phelps", "Quintero", "Reeves", "Rhodes",
  "Rivers", "Sampson", "Serrano", "Singleton", "Sloan", "Sosa", "Stanton", "Steele", "Torres", "Valdez",
  "Vance", "Vega", "Villarreal", "Walsh", "Whitaker", "Wilcox", "Wiley", "Winters", "Yates", "Zuniga",
];

const STREETS = [
  "Bay Laurel Dr", "Cypress Hammock Way", "Egret Landing Ct", "Gulf Breeze Ave", "Harbor Pine Ln",
  "Heron Walk Rd", "Lakeside Palms Dr", "Magnolia Hammock Rd", "Mangrove Point Blvd", "Orange Grove Ct",
  "Palmetto Ridge Dr", "Pelican Cove Ln", "Pine Island Way", "Royal Palm Terrace", "Sabal Creek Rd",
  "Sandpiper Run", "Seabreeze Meadow Dr", "Suncoast View Ave", "Tampa Bay Oaks Ln", "Waterline Park Ct",
];

const CITIES = ["Tampa, FL", "Clearwater, FL", "St. Petersburg, FL", "Brandon, FL", "Riverview, FL", "Wesley Chapel, FL", "Sarasota, FL", "Lakeland, FL"];

const TECHNICIAN_SPECS = [
  { name: "Maya Rodriguez", specialty: "RO and water quality", phone: "+18135550101", hours: "Mon-Fri 07:30-16:00" },
  { name: "Ethan Brooks", specialty: "softener installation", phone: "+18135550102", hours: "Mon-Fri 08:00-17:00" },
  { name: "Priya Nair", specialty: "well-water systems", phone: "+18135550103", hours: "Tue-Sat 07:00-15:30" },
  { name: "Marcus Hill", specialty: "repairs and warranty", phone: "+18135550104", hours: "Mon-Sat 09:00-18:00" },
  { name: "Sofia Chen", specialty: "whole-house filtration", phone: "+18135550105", hours: "Mon-Fri 08:30-17:30" },
  { name: "Luis Romero", specialty: "commercial service", phone: "+18135550106", hours: "Mon-Fri 06:30-15:00" },
];

const PRODUCT_SPECS = [
  { sku: "SOFT-32K", label: "32,000 Grain Water Softener", price: 1_199, cost: 645 },
  { sku: "SOFT-48K", label: "48,000 Grain Water Softener", price: 1_549, cost: 825 },
  { sku: "RO-STD", label: "Standard 4-Stage Reverse Osmosis System", price: 899, cost: 470 },
  { sku: "RO-PRM", label: "Premium 6-Stage RO with Remineralizer", price: 1_349, cost: 720 },
  { sku: "IRON-FILT", label: "Iron and Sulfur Removal System", price: 1_299, cost: 690 },
  { sku: "UV-STER", label: "UV Water Sterilization System", price: 749, cost: 410 },
  { sku: "FILT-WH-CARB", label: "Whole-House Carbon Filter", price: 649, cost: 350 },
  { sku: "MEMB-RO", label: "50 GPD RO Membrane Replacement", price: 65, cost: 36 },
  { sku: "FILT-SED", label: "Sediment Filter Cartridge", price: 18, cost: 10 },
  { sku: "SALT-BAG", label: "Water Softener Salt, 40 lb", price: 9, cost: 5 },
];

type TechnicianRow = typeof technicians.$inferInsert;
type UserRow = typeof users.$inferInsert;
type EmployeeRoleRow = typeof employeeRoles.$inferInsert;
type ApprovalChainRow = typeof approvalChains.$inferInsert;
type ApprovalChainStepRow = typeof approvalChainSteps.$inferInsert;
type RoleAssignmentRow = typeof employeeRoleAssignments.$inferInsert;
type RoleGrantRow = typeof roleAuthorityGrants.$inferInsert;
type RolePermissionRow = typeof rolePermissions.$inferInsert;
type HouseholdRow = typeof households.$inferInsert;
type ContactRow = typeof contacts.$inferInsert;
type ContactMethodRow = typeof contactMethods.$inferInsert;
type LeadRow = typeof leads.$inferInsert;
type OpportunityRow = typeof opportunities.$inferInsert;
type EquipmentRow = typeof equipment.$inferInsert;
type ServiceVisitRow = typeof serviceVisits.$inferInsert;
type MaintenanceAgreementRow = typeof maintenanceAgreements.$inferInsert;
type InventoryRow = typeof inventoryItems.$inferInsert;
type WarehouseRow = typeof warehouses.$inferInsert;
type WarehouseStockRow = typeof warehouseStock.$inferInsert;
type ProcurementOrderRow = typeof procurementOrders.$inferInsert;
type PriceBookRow = typeof priceBookItems.$inferInsert;
type QuoteRow = typeof quotes.$inferInsert;
type QuoteLineRow = typeof quoteLineItems.$inferInsert;
type ProposalRow = typeof proposals.$inferInsert;
type WorkOrderRow = typeof workOrders.$inferInsert;
type AppointmentRow = typeof appointments.$inferInsert;
type TaskRow = typeof tasks.$inferInsert;
type InvoiceRow = typeof invoices.$inferInsert;
type PaymentRow = typeof payments.$inferInsert;
type ConversationRow = typeof conversations.$inferInsert;
type CallRow = typeof calls.$inferInsert;
type MessageRow = typeof messages.$inferInsert;
type WorkflowStateRow = typeof workflowStates.$inferInsert;
type BusinessEventRow = typeof businessEvents.$inferInsert;
type PolicyRow = typeof domainPolicies.$inferInsert;
type PolicyRevisionRow = typeof domainPolicyRevisions.$inferInsert;
type DomainActionRow = typeof domainActions.$inferInsert;
type AuthorityDecisionRow = typeof authorityDecisions.$inferInsert;
type ApprovalRequestRow = typeof authorityApprovalRequests.$inferInsert;
type ApprovalRequestStepRow = typeof authorityApprovalRequestSteps.$inferInsert;
type ActionLogRow = typeof actionLog.$inferInsert;
type ScanFindingRow = typeof scanFindings.$inferInsert;

export interface DemoTenantConfig {
  tenantId: string;
  tenantName: string;
  timezone?: string;
  leadCount?: number;
  asOf?: Date;
}

export interface ValidatedDemoTenantConfig {
  tenantId: string;
  tenantName: string;
  timezone: string;
  leadCount: number;
  asOf: Date;
}

export interface DemoSeedData {
  tenantId: string;
  asOf: Date;
  technicians: TechnicianRow[];
  users: UserRow[];
  employeeRoles: EmployeeRoleRow[];
  approvalChains: ApprovalChainRow[];
  approvalChainSteps: ApprovalChainStepRow[];
  employeeRoleAssignments: RoleAssignmentRow[];
  roleAuthorityGrants: RoleGrantRow[];
  rolePermissions: RolePermissionRow[];
  households: HouseholdRow[];
  contacts: ContactRow[];
  contactMethods: ContactMethodRow[];
  leads: LeadRow[];
  opportunities: OpportunityRow[];
  equipment: EquipmentRow[];
  serviceVisits: ServiceVisitRow[];
  maintenanceAgreements: MaintenanceAgreementRow[];
  inventoryItems: InventoryRow[];
  warehouses: WarehouseRow[];
  warehouseStock: WarehouseStockRow[];
  procurementOrders: ProcurementOrderRow[];
  priceBookItems: PriceBookRow[];
  quotes: QuoteRow[];
  quoteLineItems: QuoteLineRow[];
  proposals: ProposalRow[];
  workOrders: WorkOrderRow[];
  appointments: AppointmentRow[];
  tasks: TaskRow[];
  invoices: InvoiceRow[];
  payments: PaymentRow[];
  conversations: ConversationRow[];
  calls: CallRow[];
  messages: MessageRow[];
  workflowStates: WorkflowStateRow[];
  businessEvents: BusinessEventRow[];
  domainPolicies: PolicyRow[];
  domainPolicyRevisions: PolicyRevisionRow[];
  domainActions: DomainActionRow[];
  authorityDecisions: AuthorityDecisionRow[];
  authorityApprovalRequests: ApprovalRequestRow[];
  authorityApprovalRequestSteps: ApprovalRequestStepRow[];
  actionLog: ActionLogRow[];
  scanFindings: ScanFindingRow[];
}

export interface DemoSeedValidation {
  valid: boolean;
  errors: string[];
  counts: Record<string, number>;
  leadStatuses: Record<string, number>;
}

export interface SeedDemoTenantResult {
  tenantId: string;
  tenantName: string;
  counts: Record<string, number>;
  validation: DemoSeedValidation;
}

function stableUuid(tenantId: string, kind: string, indexOrKey: string | number): string {
  const digest = createHash("sha256").update(`${DEMO_SEED_SOURCE}|${tenantId}|${kind}|${indexOrKey}`).digest();
  const bytes = Buffer.from(digest.subarray(0, 16));
  bytes[6] = (bytes[6]! & 0x0f) | 0x50;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function stableNumber(tenantId: string, kind: string, indexOrKey: string | number, min: number, max: number): number {
  const digest = createHash("sha256").update(`${DEMO_SEED_SOURCE}|number|${tenantId}|${kind}|${indexOrKey}`).digest();
  const value = digest.readUInt32BE(0) / 0xffffffff;
  return Math.floor(min + value * (max - min + 1));
}

function money(value: number): string {
  return value.toFixed(2);
}

function dateOffset(asOf: Date, days: number, hours = 12): Date {
  const date = new Date(asOf.getTime() + days * DAY_MS);
  date.setUTCHours(hours, 0, 0, 0);
  return date;
}

function unique<T>(values: T[]): T[] {
  return [...new Set(values)];
}

function leadStatusForIndex(index: number): "new" | "contacted" | "qualified" | "disqualified" | "converted" {
  const bucket = index % 100;
  if (bucket < 29) return "new";
  if (bucket < 52) return "contacted";
  if (bucket < 71) return "qualified";
  if (bucket < 92) return "converted";
  return "disqualified";
}

function opportunityStageFor(index: number, status: string): "open" | "quote_sent" | "won" | "lost" {
  if (status === "converted") return "won";
  if (status === "disqualified") return "lost";
  if (status === "qualified") return index % 3 === 0 ? "quote_sent" : "open";
  return index % 2 === 0 ? "open" : "lost";
}

function quoteStatusFor(index: number, stage: string): "draft" | "sent" | "accepted" | "declined" | "expired" {
  if (stage === "won") return "accepted";
  if (stage === "quote_sent") return "sent";
  if (stage === "lost") return index % 2 === 0 ? "declined" : "expired";
  return index % 5 === 0 ? "draft" : "sent";
}

function requireTimeZone(timezone: string): void {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: timezone }).format();
  } catch {
    throw new Error(`Invalid IANA timezone: ${timezone}`);
  }
}

export function validateDemoTenantConfig(config: DemoTenantConfig): ValidatedDemoTenantConfig {
  const tenantId = config.tenantId?.trim().toLowerCase();
  const tenantName = config.tenantName?.trim();
  if (!tenantId || !UUID_RE.test(tenantId)) throw new Error("A valid explicit demo tenant id is required");
  if (PROTECTED_TENANT_IDS.has(tenantId)) throw new Error("Refusing to seed a protected/default tenant");
  if (!tenantName || tenantName.length < 3) throw new Error("An explicit demo tenant name is required");
  if (!DEMO_NAME_RE.test(tenantName) || RESERVED_NAME_RE.test(tenantName)) {
    throw new Error("Tenant name must clearly identify a demo/test/sandbox tenant and cannot look production-like");
  }
  const timezone = config.timezone?.trim() || DEFAULT_DEMO_TIMEZONE;
  requireTimeZone(timezone);
  const leadCount = config.leadCount ?? DEFAULT_DEMO_LEAD_COUNT;
  if (!Number.isInteger(leadCount) || leadCount < 100 || leadCount > 5_000) {
    throw new Error("Demo lead count must be an integer between 100 and 5000");
  }
  const asOf = new Date(config.asOf?.getTime() ?? DEMO_AS_OF_ISO);
  if (Number.isNaN(asOf.getTime())) throw new Error("Demo seed as-of date is invalid");
  return { tenantId, tenantName, timezone, leadCount, asOf };
}

function technicianRows(tenantId: string): TechnicianRow[] {
  return TECHNICIAN_SPECS.map((spec, index) => ({
    id: stableUuid(tenantId, "technician", index),
    tenantId,
    name: spec.name,
    contactInfo: { phone: spec.phone, specialty: spec.specialty, demoSeed: DEMO_SEED_SOURCE },
    availability: { hours: spec.hours, serviceRadiusMiles: 45, languages: index % 3 === 0 ? ["English", "Spanish"] : ["English"] },
  }));
}

function userRows(tenantId: string, techs: TechnicianRow[]): UserRow[] {
  const specs = [
    { role: "owner" as const, name: "Jordan Ellis", phone: "+18135550001", key: "owner", technicianId: null },
    { role: "dispatcher" as const, name: "Taylor Morgan", phone: "+18135550002", key: "dispatcher-1", technicianId: null },
    { role: "dispatcher" as const, name: "Casey Nguyen", phone: "+18135550003", key: "dispatcher-2", technicianId: null },
    ...techs.map((tech, index) => ({ role: "technician" as const, name: tech.name, phone: TECHNICIAN_SPECS[index]!.phone, key: `technician-${index}`, technicianId: tech.id })),
  ];
  const tenantTag = tenantId.slice(0, 8);
  return specs.map((spec, index) => ({
    id: stableUuid(tenantId, "user", spec.key),
    tenantId,
    email: `demo.${spec.key}.${tenantTag}@finnor.local`,
    role: spec.role,
    displayName: spec.name,
    phoneNumber: spec.phone,
    status: index === specs.length - 1 ? "suspended" : "active",
    technicianId: spec.technicianId,
  }));
}

function authorityRows(tenantId: string, usersRows: UserRow[]): Pick<DemoSeedData, "employeeRoles" | "approvalChains" | "approvalChainSteps" | "employeeRoleAssignments" | "roleAuthorityGrants" | "rolePermissions"> & { authorityStates: { tenantId: string; revision: number } } {
  const ownerRoleId = stableUuid(tenantId, "employee-role", "owner");
  const dispatcherRoleId = stableUuid(tenantId, "employee-role", "dispatcher");
  const technicianRoleId = stableUuid(tenantId, "employee-role", "technician");
  const managerRoleId = stableUuid(tenantId, "employee-role", "service-manager");
  const financeChainId = stableUuid(tenantId, "approval-chain", "finance");
  const customerCommsChainId = stableUuid(tenantId, "approval-chain", "customer-comms");
  const ownerId = usersRows.find((row) => row.role === "owner")!.id!;
  const dispatcherIds = usersRows.filter((row) => row.role === "dispatcher").map((row) => row.id!);
  const technicianIds = usersRows.filter((row) => row.role === "technician").map((row) => row.id!);

  const roles: EmployeeRoleRow[] = [
    { id: ownerRoleId, tenantId, key: "owner", name: "Owner", description: "Full operating authority", legacyRole: "owner" },
    { id: dispatcherRoleId, tenantId, key: "dispatcher", name: "Dispatcher", description: "Scheduling and customer communications", legacyRole: "dispatcher" },
    { id: technicianRoleId, tenantId, key: "technician", name: "Technician", description: "Assigned field service execution", legacyRole: "technician" },
    { id: managerRoleId, tenantId, key: "service-manager", name: "Service Manager", description: "Service quality and escalations", legacyRole: "owner" },
  ];
  const chains: ApprovalChainRow[] = [
    { id: financeChainId, tenantId, key: "finance", name: "Finance approval", active: true },
    { id: customerCommsChainId, tenantId, key: "customer-comms", name: "Customer communication approval", active: true },
  ];
  const chainSteps: ApprovalChainStepRow[] = [
    { id: stableUuid(tenantId, "approval-chain-step", "finance-1"), tenantId, approvalChainId: financeChainId, sequence: 1, approverCapability: "approve:$action", minApprovals: 1 },
    { id: stableUuid(tenantId, "approval-chain-step", "customer-comms-1"), tenantId, approvalChainId: customerCommsChainId, sequence: 1, approverCapability: "approve:$action", minApprovals: 1 },
  ];
  const assignments: RoleAssignmentRow[] = [
    { id: stableUuid(tenantId, "role-assignment", "owner"), tenantId, employeeId: ownerId, roleId: ownerRoleId, resourceScope: { kind: "tenant" }, active: true },
    ...dispatcherIds.map((employeeId, index) => ({ id: stableUuid(tenantId, "role-assignment", `dispatcher-${index}`), tenantId, employeeId, roleId: dispatcherRoleId, resourceScope: { kind: "tenant" }, active: true })),
    ...technicianIds.map((employeeId, index) => ({ id: stableUuid(tenantId, "role-assignment", `technician-${index}`), tenantId, employeeId, roleId: technicianRoleId, resourceScope: { kind: "assigned" }, active: index !== technicianIds.length - 1 })),
  ];
  const grants: RoleGrantRow[] = [
    { id: stableUuid(tenantId, "role-grant", "owner-query"), tenantId, roleId: ownerRoleId, capability: "query:*", resourceType: "*", effect: "allow", maxRisk: "high", approvalRequired: false },
    { id: stableUuid(tenantId, "role-grant", "owner-invoice"), tenantId, roleId: ownerRoleId, capability: "action:create_invoice", resourceType: "invoice", effect: "allow", maxAmountUsd: "25000.00", maxRisk: "high", approvalRequired: true, approvalChainId: financeChainId },
    { id: stableUuid(tenantId, "role-grant", "dispatcher-schedule"), tenantId, roleId: dispatcherRoleId, capability: "action:schedule_water_test", resourceType: "appointment", effect: "allow", maxRisk: "medium", approvalRequired: false },
    { id: stableUuid(tenantId, "role-grant", "dispatcher-message"), tenantId, roleId: dispatcherRoleId, capability: "action:send_customer_message", resourceType: "household", effect: "allow", maxRisk: "high", approvalRequired: true, approvalChainId: customerCommsChainId },
    { id: stableUuid(tenantId, "role-grant", "technician-query"), tenantId, roleId: technicianRoleId, capability: "query:customer_lookup", resourceType: "household", effect: "allow", maxRisk: "low", approvalRequired: false },
    { id: stableUuid(tenantId, "role-grant", "manager-recovery"), tenantId, roleId: managerRoleId, capability: "action:resolve_service_issue", resourceType: "work_order", effect: "allow", maxRisk: "high", approvalRequired: true, approvalChainId: customerCommsChainId },
  ];
  const permissions: RolePermissionRow[] = [
    { id: stableUuid(tenantId, "role-permission", "owner-any"), tenantId, role: "owner", actionType: "*", canApprove: true },
    { id: stableUuid(tenantId, "role-permission", "dispatcher-schedule"), tenantId, role: "dispatcher", actionType: "schedule_water_test", canApprove: true },
    { id: stableUuid(tenantId, "role-permission", "dispatcher-message"), tenantId, role: "dispatcher", actionType: "send_customer_message", canApprove: false },
    { id: stableUuid(tenantId, "role-permission", "technician-any"), tenantId, role: "technician", actionType: "*", canApprove: false },
  ];
  return {
    authorityStates: { tenantId, revision: 1 },
    employeeRoles: roles,
    approvalChains: chains,
    approvalChainSteps: chainSteps,
    employeeRoleAssignments: assignments,
    roleAuthorityGrants: grants,
    rolePermissions: permissions,
  };
}

function policyRows(tenantId: string, asOf: Date): { policies: PolicyRow[]; revisions: PolicyRevisionRow[]; byAction: Map<string, PolicyRow> } {
  const definitions: Array<{ actionType: string; requiresConfirmation: boolean; policy: Record<string, unknown>; template?: string }> = [
    { actionType: "check_stock_level", requiresConfirmation: false, policy: { source: "native_inventory", freshnessMinutes: 5 } },
    { actionType: "send_customer_message", requiresConfirmation: true, policy: { consentRequired: true, channels: ["sms", "email", "call"] }, template: "Send this message to {{customer}}?" },
    { actionType: "create_invoice", requiresConfirmation: true, policy: { maxAutoAmountUsd: 25000, requireHousehold: true }, template: "Create the {{amount}} invoice for {{customer}}?" },
    { actionType: "record_payment", requiresConfirmation: true, policy: { requireInvoiceMatch: true }, template: "Record this payment against {{invoice}}?" },
    { actionType: "generate_quote", requiresConfirmation: true, policy: { priceBookRequired: true }, template: "Generate a quote for {{customer}}?" },
    { actionType: "schedule_water_test", requiresConfirmation: true, policy: { defaultDurationMinutes: 45, serviceRadiusMiles: 45 }, template: "Schedule a water test for {{customer}}?" },
    { actionType: "log_visit_report", requiresConfirmation: false, policy: { requiredFields: ["notes", "technician"] } },
    { actionType: "search_web", requiresConfirmation: false, policy: { evidenceRequired: true, canonicalDataPrecedence: true } },
    { actionType: "answer_business_question", requiresConfirmation: false, policy: { sourceHierarchy: ["canonical", "memory", "web"] } },
    { actionType: "request_proposal_signature", requiresConfirmation: true, policy: { documentRequired: true }, template: "Request a signature from {{customer}}?" },
  ];
  const policies = definitions.map((definition, index) => ({
    id: stableUuid(tenantId, "domain-policy", definition.actionType),
    tenantId,
    actionType: definition.actionType,
    policy: definition.policy,
    requiresConfirmation: definition.requiresConfirmation,
    confirmationTemplate: definition.template ?? null,
    version: 1,
    effectiveFrom: dateOffset(asOf, -90 + index),
  }));
  const revisions = policies.map((policy) => ({
    id: stableUuid(tenantId, "domain-policy-revision", policy.actionType),
    tenantId,
    policyId: policy.id!,
    actionType: policy.actionType,
    version: 1,
    policy: policy.policy,
    requiresConfirmation: policy.requiresConfirmation,
    confirmationTemplate: policy.confirmationTemplate,
    modelProvider: null,
    confirmationTimeoutHours: policy.requiresConfirmation ? 24 : null,
    effectiveFrom: policy.effectiveFrom!,
  }));
  return { policies, revisions, byAction: new Map(policies.map((policy) => [policy.actionType, policy])) };
}

export function generateDemoSeedData(config: DemoTenantConfig): DemoSeedData {
  const validated = validateDemoTenantConfig(config);
  const { tenantId, leadCount, asOf } = validated;
  const techRows = technicianRows(tenantId);
  const usersRows = userRows(tenantId, techRows);
  const authority = authorityRows(tenantId, usersRows);
  const ownerId = usersRows.find((row) => row.role === "owner")!.id!;
  const dispatcherId = usersRows.find((row) => row.role === "dispatcher")!.id!;
  const techIds = techRows.map((row) => row.id!);
  const householdsRows: HouseholdRow[] = [];
  const contactsRows: ContactRow[] = [];
  const methodsRows: ContactMethodRow[] = [];
  const leadsRows: LeadRow[] = [];
  const opportunityRows: OpportunityRow[] = [];
  const opportunityByLead = new Map<number, OpportunityRow>();
  const primaryContactByLead = new Map<number, string>();
  const primaryMethodByLead = new Map<number, string>();

  for (let index = 0; index < leadCount; index++) {
    const first = FIRST_NAMES[index % FIRST_NAMES.length]!;
    const last = LAST_NAMES[Math.floor(index / FIRST_NAMES.length) % LAST_NAMES.length]!;
    const name = `${first} ${last}`;
    const phone = `+1813555${String(1_000 + index).padStart(4, "0")}`;
    const email = `${first.toLowerCase()}.${last.toLowerCase()}.${String(index + 1).padStart(4, "0")}@demo-suncoast-water.example`;
    const householdId = stableUuid(tenantId, "household", index);
    const contactId = stableUuid(tenantId, "contact", `primary-${index}`);
    const phoneMethodId = stableUuid(tenantId, "contact-method", `phone-${index}`);
    const emailMethodId = stableUuid(tenantId, "contact-method", `email-${index}`);
    const leadId = stableUuid(tenantId, "lead", index);
    const status = leadStatusForIndex(index);
    const city = CITIES[index % CITIES.length]!;
    const address = `${100 + index} ${STREETS[index % STREETS.length]!}, ${city}`;
    const wellWater = index % 3 !== 1;
    const marketingConsent = index % 7 !== 0;
    const createdAt = dateOffset(asOf, -stableNumber(tenantId, "lead-age", index, 1, 420), 13);
    householdsRows.push({
      id: householdId,
      tenantId,
      address,
      contactInfo: { name, phone, email, source: DEMO_SEED_SOURCE },
      waterProfile: {
        source: wellWater ? "well" : "municipal",
        hardness_gpg: 6 + (index * 7) % 20,
        iron_ppm: Number((0.05 + ((index * 13) % 90) / 100).toFixed(2)),
        ph: Number((6.8 + ((index * 11) % 18) / 10).toFixed(1)),
        nitrate_ppm: Number(((index * 5) % 16).toFixed(1)),
      },
      marketingConsent,
      latitude: 27.65 + ((index * 17) % 280) / 10_000,
      longitude: -82.55 - ((index * 19) % 280) / 10_000,
      createdAt,
    });
    contactsRows.push({ id: contactId, tenantId, householdId, name, role: "primary", sourceSystem: DEMO_SEED_SOURCE, externalId: `contact-primary-${index}`, createdBy: "demo-seed", createdAt });
    methodsRows.push(
      { id: phoneMethodId, tenantId, contactId, methodType: "phone", value: phone, consent: marketingConsent, consentRecordedAt: marketingConsent ? createdAt : null, createdAt },
      { id: emailMethodId, tenantId, contactId, methodType: "email", value: email, consent: marketingConsent, consentRecordedAt: marketingConsent ? createdAt : null, createdAt },
    );
    primaryContactByLead.set(index, contactId);
    primaryMethodByLead.set(index, phoneMethodId);
    if (index % 4 === 0) {
      const secondaryContactId = stableUuid(tenantId, "contact", `secondary-${index}`);
      const secondaryPhone = `+1813555${String(8_000 + index).padStart(4, "0")}`;
      contactsRows.push({ id: secondaryContactId, tenantId, householdId, name: `Partner of ${first} ${last}`, role: "secondary", sourceSystem: DEMO_SEED_SOURCE, externalId: `contact-secondary-${index}`, createdBy: "demo-seed", createdAt });
      methodsRows.push({ id: stableUuid(tenantId, "contact-method", `secondary-phone-${index}`), tenantId, contactId: secondaryContactId, methodType: "phone", value: secondaryPhone, consent: index % 8 !== 0, consentRecordedAt: index % 8 !== 0 ? createdAt : null, createdAt });
    }
    leadsRows.push({
      id: leadId,
      tenantId,
      householdId,
      contactMethodId: phoneMethodId,
      name,
      phone,
      email,
      address,
      status,
      disqualifyReason: status === "disqualified" ? ["Outside service radius", "Duplicate inquiry", "Budget deferred"][index % 3] : null,
      source: ["referral", "web", "home_show", "partner", "inbound_call", "google_local"][index % 6],
      notes: status === "qualified" ? "Requested a water-quality review and equipment recommendation." : status === "converted" ? "Converted to an install opportunity; keep service history current." : null,
      sourceSystem: DEMO_SEED_SOURCE,
      externalId: `lead-${String(index + 1).padStart(5, "0")}`,
      createdBy: "demo-seed",
      createdAt,
    });
    if (status !== "new" || index % 17 === 0) {
      const opportunityId = stableUuid(tenantId, "opportunity", index);
      const pipelineStage = opportunityStageFor(index, status);
      const opportunity: OpportunityRow = {
        id: opportunityId,
        tenantId,
        leadId,
        householdId,
        pipelineStage,
        expectedValueUsd: money(850 + ((index * 137) % 5_500)),
        wonAt: pipelineStage === "won" ? dateOffset(asOf, -stableNumber(tenantId, "won-age", index, 2, 180)) : null,
        lostAt: pipelineStage === "lost" ? dateOffset(asOf, -stableNumber(tenantId, "lost-age", index, 1, 150)) : null,
        lostReason: pipelineStage === "lost" ? ["Price", "No response", "Chose another dealer", "Service area mismatch"][index % 4] : null,
        sourceSystem: DEMO_SEED_SOURCE,
        externalId: `opportunity-${String(index + 1).padStart(5, "0")}`,
        createdBy: "demo-seed",
        createdAt,
      };
      opportunityRows.push(opportunity);
      opportunityByLead.set(index, opportunity);
    }
  }

  const equipmentRows: EquipmentRow[] = [];
  const serviceVisitRows: ServiceVisitRow[] = [];
  const maintenanceRows: MaintenanceAgreementRow[] = [];
  for (let index = 0; index < leadCount; index++) {
    const lead = leadsRows[index]!;
    const shouldHaveSystem = lead.status === "converted" || lead.status === "qualified" || index % 11 === 0;
    if (!shouldHaveSystem) continue;
    const equipmentCount = index % 5 === 0 ? 2 : 1;
    for (let slot = 0; slot < equipmentCount; slot++) {
      const equipmentId = stableUuid(tenantId, "equipment", `${index}-${slot}`);
      const spec = PRODUCT_SPECS[(index + slot * 3) % 7]!;
      const installDate = dateOffset(asOf, -stableNumber(tenantId, "equipment-age", `${index}-${slot}`, 45, 1_600));
      equipmentRows.push({
        id: equipmentId,
        tenantId,
        householdId: lead.householdId!,
        type: ["water_softener", "reverse_osmosis", "whole_house_filter", "uv_sterilizer"][((index + slot) % 4)]!,
        model: spec.label,
        installDate,
        source: index % 11 === 0 ? "competitor" : "finnor",
      });
      if (index % 3 === 0 || slot > 0) {
        const visitId = stableUuid(tenantId, "service-visit", `${index}-${slot}`);
        const completed = index % 13 !== 0;
        const scheduledAt = completed ? dateOffset(asOf, -stableNumber(tenantId, "visit-age", `${index}-${slot}`, 3, 540), 14) : dateOffset(asOf, stableNumber(tenantId, "visit-future", `${index}-${slot}`, 1, 21), 15);
        serviceVisitRows.push({
          id: visitId,
          tenantId,
          householdId: lead.householdId!,
          technicianId: techIds[(index + slot) % techIds.length]!,
          type: slot === 0 ? "maintenance" : "repair",
          scheduledAt,
          completedAt: completed ? scheduledAt : null,
          notes: completed ? "Readings recorded; filters and brine draw checked." : "Customer confirmed the visit window; technician assignment pending.",
        });
      }
      if (slot === 0 && index % 3 === 0) {
        const maintenanceIndex = maintenanceRows.length;
        const maintenanceStatus: MaintenanceAgreementRow["status"] = (["active", "renewal_window", "renewal_sent", "renewed", "lapsed"] as const)[maintenanceIndex % 5]!;
        const renewalDate = maintenanceStatus === "lapsed" ? dateOffset(asOf, -45 - (index % 120)) : dateOffset(asOf, (index % 4 === 0 ? -10 : 30 + (index % 180)));
        maintenanceRows.push({
          id: stableUuid(tenantId, "maintenance-agreement", index),
          tenantId,
          householdId: lead.householdId!,
          cadence: index % 4 === 0 ? "semi_annual" : "annual",
          terms: { plan: index % 4 === 0 ? "priority" : "standard", price_usd: index % 4 === 0 ? 349 : 249, equipmentId },
          status: maintenanceStatus,
          renewalDate,
          firstReminderSentAt: maintenanceStatus === "renewal_sent" || maintenanceStatus === "renewed" ? dateOffset(asOf, -22) : null,
          secondReminderSentAt: maintenanceStatus === "renewed" ? dateOffset(asOf, -8) : null,
        });
      }
    }
  }

  const inventoryRows: InventoryRow[] = PRODUCT_SPECS.map((product, index) => ({
    id: stableUuid(tenantId, "inventory", product.sku),
    tenantId,
    sku: product.sku,
    name: product.label,
    quantity: index % 4 === 0 ? 2 + index : 14 + index * 3,
    reorderThreshold: index % 4 === 0 ? 8 + index : 6,
    unitCostUsd: money(product.cost),
  }));
  const warehouseRows: WarehouseRow[] = [
    { id: stableUuid(tenantId, "warehouse", "tampa"), tenantId, name: "Tampa Main Stockroom", address: "4100 Suncoast Commerce Dr, Tampa, FL", isDefault: true },
    { id: stableUuid(tenantId, "warehouse", "sarasota"), tenantId, name: "Sarasota Service Depot", address: "2200 Gulf Gate Pkwy, Sarasota, FL", isDefault: false },
  ];
  const warehouseStockRows: WarehouseStockRow[] = [];
  const procurementRows: ProcurementOrderRow[] = [];
  for (const [warehouseIndex, warehouse] of warehouseRows.entries()) {
    for (const [productIndex, product] of PRODUCT_SPECS.entries()) {
      warehouseStockRows.push({
        id: stableUuid(tenantId, "warehouse-stock", `${warehouseIndex}-${product.sku}`),
        tenantId,
        warehouseId: warehouse.id!,
        sku: product.sku,
        quantity: warehouseIndex === 0 ? 6 + productIndex * 2 : 2 + (productIndex % 4),
        unitOfMeasure: product.sku === "SALT-BAG" ? "bag" : "each",
        reorderThreshold: warehouseIndex === 0 ? 8 : 4,
      });
      if ((productIndex + warehouseIndex) % 4 === 0) {
        const received = (productIndex + warehouseIndex) % 8 === 0;
        procurementRows.push({
          id: stableUuid(tenantId, "procurement", `${warehouseIndex}-${product.sku}`),
          tenantId,
          warehouseId: warehouse.id!,
          sku: product.sku,
          quantityOrdered: 12 + productIndex,
          status: received ? "received" : productIndex % 3 === 0 ? "ordered" : "draft",
          expectedAt: dateOffset(asOf, received ? -18 : 14 + productIndex),
          receivedAt: received ? dateOffset(asOf, -12) : null,
          sourceSystem: DEMO_SEED_SOURCE,
          externalId: `procurement-${warehouseIndex}-${product.sku}`,
          createdBy: "demo-seed",
          createdAt: dateOffset(asOf, -35),
        });
      }
    }
  }
  const priceBookRows: PriceBookRow[] = PRODUCT_SPECS.map((product) => ({
    id: stableUuid(tenantId, "price-book", product.sku),
    tenantId,
    sku: product.sku,
    label: product.label,
    priceUsd: money(product.price),
    unitOfMeasure: product.sku === "SALT-BAG" ? "bag" : "each",
    sourceSystem: DEMO_SEED_SOURCE,
    externalId: `price-${product.sku}`,
    createdBy: "demo-seed",
    createdAt: dateOffset(asOf, -120),
    updatedAt: dateOffset(asOf, -3),
  }));

  const quoteRows: QuoteRow[] = [];
  const quoteLineRows: QuoteLineRow[] = [];
  const proposalRows: ProposalRow[] = [];
  const workOrderRows: WorkOrderRow[] = [];
  for (const [index, opportunity] of opportunityRows.entries()) {
    const leadIndex = Number(opportunity.externalId!.split("-").at(-1)) - 1;
    if (!Number.isInteger(leadIndex) || (opportunity.pipelineStage === "open" && leadIndex % 5 !== 0)) continue;
    const quoteId = stableUuid(tenantId, "quote", leadIndex);
    const quoteStatus = quoteStatusFor(leadIndex, opportunity.pipelineStage!);
    const primaryProduct = PRODUCT_SPECS[(leadIndex + index) % 7]!;
    const labor = 350 + (leadIndex % 5) * 75;
    const total = primaryProduct.price + labor;
    const quote: QuoteRow = {
      id: quoteId,
      tenantId,
      householdId: opportunity.householdId,
      leadId: opportunity.leadId,
      opportunityId: opportunity.id,
      status: quoteStatus,
      totalUsd: money(total),
      validUntil: quoteStatus === "expired" ? dateOffset(asOf, -30) : dateOffset(asOf, 30 + leadIndex % 30),
      sourceSystem: DEMO_SEED_SOURCE,
      externalId: `quote-${String(leadIndex + 1).padStart(5, "0")}`,
      createdBy: "demo-seed",
      createdAt: dateOffset(asOf, -30 - (leadIndex % 90)),
    };
    quoteRows.push(quote);
    quoteLineRows.push(
      { id: stableUuid(tenantId, "quote-line", `${leadIndex}-equipment`), tenantId, quoteId, sku: primaryProduct.sku, label: primaryProduct.label, quantity: 1, unitPriceUsd: money(primaryProduct.price), createdAt: quote.createdAt },
      { id: stableUuid(tenantId, "quote-line", `${leadIndex}-labor`), tenantId, quoteId, sku: null, label: "Installation and commissioning labor", quantity: 1, unitPriceUsd: money(labor), createdAt: quote.createdAt },
    );
    if (quoteStatus !== "draft") {
      proposalRows.push({
        id: stableUuid(tenantId, "proposal", leadIndex),
        tenantId,
        householdId: opportunity.householdId!,
        quoteId,
        content: { headline: `${primaryProduct.label} recommendation`, notes: "Includes startup commissioning, customer walkthrough, and first service reminder.", totalUsd: total },
        status: quoteStatus === "accepted" ? "accepted" : quoteStatus === "sent" ? "sent" : quoteStatus,
        sentAt: dateOffset(asOf, -10 - (leadIndex % 20)),
      });
    }
    if (quoteStatus === "accepted" || (quoteStatus === "sent" && leadIndex % 4 === 0)) {
      const workOrderStatus: WorkOrderRow["status"] = quoteStatus === "accepted" ? ((["completed", "in_progress", "scheduled", "canceled"] as const)[leadIndex % 4]!) : "scheduled";
      const type: WorkOrderRow["type"] = leadIndex % 6 === 0 ? "repair" : leadIndex % 10 === 0 ? "warranty" : "install";
      workOrderRows.push({
        id: stableUuid(tenantId, "work-order", leadIndex),
        tenantId,
        householdId: opportunity.householdId!,
        quoteId,
        type,
        status: workOrderStatus,
        technicianId: techIds[leadIndex % techIds.length]!,
        depositAmountUsd: money(Math.round(total * 0.25)),
        stockReservation: { sku: primaryProduct.sku, quantity: 1, state: workOrderStatus === "canceled" ? "released" : workOrderStatus === "completed" ? "consumed" : "reserved" },
        scheduledAt: workOrderStatus === "completed" ? dateOffset(asOf, -20 - (leadIndex % 80), 14) : dateOffset(asOf, 3 + (leadIndex % 25), 14),
        completedAt: workOrderStatus === "completed" ? dateOffset(asOf, -18 - (leadIndex % 80), 16) : null,
        sourceSystem: DEMO_SEED_SOURCE,
        externalId: `work-order-${String(leadIndex + 1).padStart(5, "0")}`,
        createdBy: "demo-seed",
        createdAt: quote.createdAt,
      });
    }
  }

  const appointmentRows: AppointmentRow[] = [];
  for (const [index, workOrder] of workOrderRows.entries()) {
    const status: AppointmentRow["status"] = (["completed", "confirmed", "hold", "canceled", "no_show"] as const)[index % 5]!;
    const scheduledAt = status === "completed" || status === "no_show" || status === "canceled" ? dateOffset(asOf, -2 - (index % 100), 14) : dateOffset(asOf, 1 + (index % 21), 15);
    appointmentRows.push({
      id: stableUuid(tenantId, "appointment", `work-${index}`),
      tenantId,
      subjectType: "work_order",
      subjectId: workOrder.id!,
      technicianId: workOrder.technicianId,
      status,
      scheduledAt,
      durationMinutes: workOrder.type === "repair" ? 90 : 120,
      holdExpiresAt: status === "hold" ? dateOffset(asOf, -1, 18) : null,
      notes: status === "no_show" ? "Customer did not answer; reschedule task opened." : status === "canceled" ? "Canceled after customer selected another installation window." : "Technician route and arrival window confirmed.",
      sourceSystem: DEMO_SEED_SOURCE,
      externalId: `appointment-work-${index}`,
      createdBy: "demo-seed",
      createdAt: dateOffset(asOf, -25),
    });
  }
  for (let index = 0; index < leadCount; index += 3) {
    const lead = leadsRows[index]!;
    const status: AppointmentRow["status"] = (["confirmed", "completed", "hold", "no_show"] as const)[index % 4]!;
    appointmentRows.push({
      id: stableUuid(tenantId, "appointment", `water-test-${index}`),
      tenantId,
      subjectType: "household",
      subjectId: lead.householdId!,
      technicianId: techIds[index % techIds.length]!,
      status,
      scheduledAt: status === "completed" || status === "no_show" ? dateOffset(asOf, -4 - (index % 90), 13) : dateOffset(asOf, 2 + (index % 16), 13),
      durationMinutes: 45,
      holdExpiresAt: status === "hold" ? dateOffset(asOf, -2, 18) : null,
      notes: status === "no_show" ? "No-show; outreach task queued." : "Water test appointment with field readings and photo capture.",
      sourceSystem: DEMO_SEED_SOURCE,
      externalId: `appointment-water-test-${index}`,
      createdBy: "demo-seed",
      createdAt: dateOffset(asOf, -18),
    });
  }

  const invoiceRows: InvoiceRow[] = [];
  const paymentRows: PaymentRow[] = [];
  for (const [index, workOrder] of workOrderRows.entries()) {
    const status: InvoiceRow["status"] = (["paid", "overdue", "sent", "draft", "void"] as const)[index % 5]!;
    const amount = 1_000 + (index % 8) * 275;
    const invoiceId = stableUuid(tenantId, "invoice", index);
    const dueDate = status === "overdue" ? dateOffset(asOf, -5 - (index % 60)) : dateOffset(asOf, 12 + (index % 30));
    invoiceRows.push({ id: invoiceId, tenantId, householdId: workOrder.householdId, amountUsd: money(amount), status, memo: `${workOrder.type} work order ${workOrder.externalId}`, dueDate, createdAt: dateOffset(asOf, -35 - (index % 90)) });
    if (status === "paid") {
      paymentRows.push({ id: stableUuid(tenantId, "payment", `${index}-succeeded`), tenantId, invoiceId, amountUsd: money(amount), method: ["card", "ach", "check"][index % 3] as PaymentRow["method"], status: "succeeded", receivedAt: dateOffset(asOf, -10 - (index % 80)), sourceSystem: DEMO_SEED_SOURCE, externalId: `payment-${index}-succeeded`, createdBy: "demo-seed", createdAt: dateOffset(asOf, -10 - (index % 80)) });
    } else if (status === "overdue") {
      paymentRows.push({ id: stableUuid(tenantId, "payment", `${index}-failed`), tenantId, invoiceId, amountUsd: money(amount), method: "card", status: "failed", receivedAt: dateOffset(asOf, -3), sourceSystem: DEMO_SEED_SOURCE, externalId: `payment-${index}-failed`, createdBy: "demo-seed", createdAt: dateOffset(asOf, -3) });
      if (index % 3 === 0) paymentRows.push({ id: stableUuid(tenantId, "payment", `${index}-retry`), tenantId, invoiceId, amountUsd: money(amount), method: "ach", status: "pending", receivedAt: dateOffset(asOf, -1), sourceSystem: DEMO_SEED_SOURCE, externalId: `payment-${index}-retry`, createdBy: "demo-seed", createdAt: dateOffset(asOf, -1) });
    } else if (status === "sent") {
      paymentRows.push({ id: stableUuid(tenantId, "payment", `${index}-pending`), tenantId, invoiceId, amountUsd: money(amount), method: "ach", status: "pending", receivedAt: dateOffset(asOf, -1), sourceSystem: DEMO_SEED_SOURCE, externalId: `payment-${index}-pending`, createdBy: "demo-seed", createdAt: dateOffset(asOf, -1) });
    }
  }

  const taskRows: TaskRow[] = leadsRows.filter((lead, index) => lead.status !== "converted" || index % 7 === 0).map((lead, index) => ({
    id: stableUuid(tenantId, "task", index),
    tenantId,
    subjectType: "lead",
    subjectId: lead.id!,
    title: lead.status === "new" ? "First contact attempt" : lead.status === "disqualified" ? "Record disqualification reason" : "Follow up on water treatment recommendation",
    dueAt: index % 5 === 0 ? dateOffset(asOf, -1 - (index % 20), 16) : dateOffset(asOf, 2 + (index % 14), 16),
    assigneeType: index % 4 === 0 ? "technician" : "user",
    assigneeId: index % 4 === 0 ? techIds[index % techIds.length]! : usersRows[index % usersRows.length]!.id!,
    status: index % 11 === 0 ? "done" : index % 17 === 0 ? "cancelled" : "open",
    priority: index % 9 === 0 ? "high" : index % 4 === 0 ? "low" : "normal",
    sourceSystem: DEMO_SEED_SOURCE,
    externalId: `task-${index}`,
    createdBy: "demo-seed",
    createdAt: dateOffset(asOf, -20),
  }));

  const communicationRows: Array<{
    id: string;
    tenantId: string;
    householdId: string;
    channel: string;
    direction: "inbound" | "outbound";
    content: string;
    timestamp: Date;
  }> = [];
  for (let index = 0; index < leadCount; index++) {
    const lead = leadsRows[index]!;
    const daysAgo = 2 + (index % 260);
    communicationRows.push({ id: stableUuid(tenantId, "communication", `${index}-primary`), tenantId, householdId: lead.householdId!, channel: ["sms", "email", "call"][index % 3]!, direction: index % 4 === 0 ? "inbound" : "outbound", content: index % 4 === 0 ? "Customer asked whether the water test can include iron and hardness readings." : "Follow-up sent with the next available service window and preparation notes.", timestamp: dateOffset(asOf, -daysAgo, 10) });
    if (index % 7 === 0) communicationRows.push({ id: stableUuid(tenantId, "communication", `${index}-secondary`), tenantId, householdId: lead.householdId!, channel: "sms", direction: "inbound", content: index % 14 === 0 ? "Please call back next week; we are comparing two proposals." : "Confirmed the appointment window.", timestamp: dateOffset(asOf, -Math.max(1, daysAgo - 1), 15) });
  }
  const conversationRows: ConversationRow[] = [];
  const callRows: CallRow[] = [];
  const messageRows: MessageRow[] = [];
  for (let index = 0; index < leadCount; index += 4) {
    const lead = leadsRows[index]!;
    const conversationId = stableUuid(tenantId, "conversation", index);
    const channel: ConversationRow["channel"] = index % 3 === 0 ? "sms" : index % 3 === 1 ? "email" : "voice";
    conversationRows.push({ id: conversationId, tenantId, householdId: lead.householdId, contactId: primaryContactByLead.get(index), channel, status: index % 8 === 0 ? "closed" : "open", lastActivityAt: dateOffset(asOf, -(index % 45), 16), sourceSystem: DEMO_SEED_SOURCE, externalId: `conversation-${index}`, createdBy: "demo-seed", createdAt: dateOffset(asOf, -45 - (index % 40)) });
    messageRows.push(
      { id: stableUuid(tenantId, "message", `${index}-inbound`), tenantId, conversationId, direction: "inbound", channel, content: "We are interested in improving the taste and hardness of our water.", sentAt: dateOffset(asOf, -3 - (index % 30), 10), sourceSystem: DEMO_SEED_SOURCE, externalId: `message-${index}-inbound`, createdBy: "demo-seed", createdAt: dateOffset(asOf, -3 - (index % 30), 10) },
      { id: stableUuid(tenantId, "message", `${index}-outbound`), tenantId, conversationId, direction: "outbound", channel, content: "Thanks — we can review your water profile and recommend the right system.", sentAt: dateOffset(asOf, -2 - (index % 30), 14), sourceSystem: DEMO_SEED_SOURCE, externalId: `message-${index}-outbound`, createdBy: "demo-seed", createdAt: dateOffset(asOf, -2 - (index % 30), 14) },
    );
    if (channel === "voice" || index % 5 === 0) {
      callRows.push({ id: stableUuid(tenantId, "call", index), tenantId, conversationId, direction: index % 2 === 0 ? "inbound" : "outbound", fromNumber: index % 2 === 0 ? `+1813555${String(1_000 + index).padStart(4, "0")}` : "+18135550002", toNumber: index % 2 === 0 ? "+18135550002" : `+1813555${String(1_000 + index).padStart(4, "0")}`, transcript: "Customer discussed hardness, iron, and timing for a home water test.", recordingUrl: null, startedAt: dateOffset(asOf, -4 - (index % 30), 13), endedAt: dateOffset(asOf, -4 - (index % 30), 13), endedReason: index % 6 === 0 ? "customer_hangup" : "completed", raw: { demoSeed: DEMO_SEED_SOURCE }, sourceSystem: DEMO_SEED_SOURCE, externalId: `call-${index}`, createdBy: "demo-seed", createdAt: dateOffset(asOf, -4 - (index % 30), 13) });
    }
  }
  // Former communications_log fixtures are canonical messages from birth. A
  // dedicated conversation preserves each historical thread's customer/channel and
  // the old communication UUID becomes the message UUID exposed by the read view.
  for (const communication of communicationRows) {
    const conversationId = stableUuid(tenantId, "communication-conversation", communication.id);
    const channel: ConversationRow["channel"] = communication.channel === "call"
      ? "voice"
      : communication.channel === "email"
        ? "email"
        : communication.channel === "webchat"
          ? "webchat"
          : "sms";
    conversationRows.push({
      id: conversationId,
      tenantId,
      householdId: communication.householdId,
      contactId: null,
      channel,
      status: "closed",
      lastActivityAt: communication.timestamp,
      sourceSystem: DEMO_SEED_SOURCE,
      externalId: `communication-conversation:${communication.id}`,
      createdBy: "demo-seed",
      createdAt: communication.timestamp,
    });
    messageRows.push({
      id: communication.id,
      tenantId,
      conversationId,
      direction: communication.direction,
      channel: communication.channel,
      content: communication.content,
      sentAt: communication.timestamp,
      sourceSystem: DEMO_SEED_SOURCE,
      externalId: `communication:${communication.id}`,
      createdBy: "demo-seed",
      createdAt: communication.timestamp,
    });
  }

  const { policies, revisions, byAction } = policyRows(tenantId, asOf);
  const financeChainId = authority.approvalChains.find((chain) => chain.key === "finance")!.id!;
  const customerCommsChainId = authority.approvalChains.find((chain) => chain.key === "customer-comms")!.id!;
  const approvalHousehold = householdsRows[12]!.id!;
  const approvalActionId = stableUuid(tenantId, "domain-action", "pending-approval");
  const failedActionId = stableUuid(tenantId, "domain-action", "provider-failed");
  const blockedActionId = stableUuid(tenantId, "domain-action", "integration-blocked");
  const completedActionId = stableUuid(tenantId, "domain-action", "completed");
  const approvedActionId = stableUuid(tenantId, "domain-action", "approved");
  const approvalDecisionId = stableUuid(tenantId, "authority-decision", "pending-approval");
  const approvalRequestId = stableUuid(tenantId, "approval-request", "pending-approval");
  const actionRows: DomainActionRow[] = [
    { id: approvalActionId, tenantId, actionType: "send_customer_message", payload: { householdId: approvalHousehold, channel: "sms", message: "Your annual service reminder is ready." }, policyId: byAction.get("send_customer_message")!.id, policyVersion: 1, status: "pending", summary: "Annual service reminder awaiting owner approval", createdAt: dateOffset(asOf, -2), initiatedBy: dispatcherId, authorityRevision: 1, authorityContext: { role: "dispatcher", demoSeed: DEMO_SEED_SOURCE }, authorityDecisionId: null },
    { id: approvedActionId, tenantId, actionType: "schedule_water_test", payload: { householdId: householdsRows[24]!.id, scheduledAt: dateOffset(asOf, 4).toISOString() }, policyId: byAction.get("schedule_water_test")!.id, policyVersion: 1, status: "approved", summary: "Water test approved and ready for dispatch", createdAt: dateOffset(asOf, -1), initiatedBy: dispatcherId, authorityRevision: 1, authorityContext: { role: "dispatcher", demoSeed: DEMO_SEED_SOURCE }, authorityDecisionId: null },
    { id: completedActionId, tenantId, actionType: "record_payment", payload: { invoiceId: invoiceRows[0]?.id, amountUsd: invoiceRows[0]?.amountUsd }, policyId: byAction.get("record_payment")!.id, policyVersion: 1, status: "completed", summary: "Payment reconciled to invoice", createdAt: dateOffset(asOf, -7), initiatedBy: ownerId, authorityRevision: 1, authorityContext: { role: "owner", demoSeed: DEMO_SEED_SOURCE }, authorityDecisionId: null },
    { id: failedActionId, tenantId, actionType: "send_customer_message", payload: { householdId: householdsRows[31]!.id, channel: "sms", message: "Your technician is on the way." }, policyId: byAction.get("send_customer_message")!.id, policyVersion: 1, status: "failed", summary: "SMS provider timed out after retry budget", createdAt: dateOffset(asOf, -3), initiatedBy: dispatcherId, authorityRevision: 1, authorityContext: { role: "dispatcher", recovery: { state: "retry_scheduled", attempts: 3 }, demoSeed: DEMO_SEED_SOURCE }, authorityDecisionId: null },
    { id: blockedActionId, tenantId, actionType: "request_proposal_signature", payload: { householdId: householdsRows[42]!.id }, policyId: byAction.get("request_proposal_signature")!.id, policyVersion: 1, status: "blocked_integration_unavailable", summary: "E-sign provider unavailable; manual review required", createdAt: dateOffset(asOf, -4), initiatedBy: ownerId, authorityRevision: 1, authorityContext: { integration: "esign", recovery: { state: "manual_review" }, demoSeed: DEMO_SEED_SOURCE }, authorityDecisionId: null },
  ];
  const decisionRows: AuthorityDecisionRow[] = [{
    id: approvalDecisionId,
    tenantId,
    employeeId: dispatcherId,
    authorityRevision: 1,
    operation: "action",
    capability: "action:send_customer_message",
    resourceType: "household",
    resourceId: approvalHousehold,
    amountUsd: null,
    risk: "high",
    outcome: "approval_required",
    reasonCode: "dispatcher_requires_owner_approval",
    approvalChainId: customerCommsChainId,
    evidence: { role: "dispatcher", policyVersion: 1, source: "demo-seed" },
    workId: null,
    domainActionId: approvalActionId,
    operationId: null,
    createdAt: dateOffset(asOf, -2),
  }];
  const requestRows: ApprovalRequestRow[] = [{ id: approvalRequestId, tenantId, domainActionId: approvalActionId, requesterId: dispatcherId, authorityDecisionId: approvalDecisionId, approvalChainId: customerCommsChainId, status: "pending", currentStep: 1, createdAt: dateOffset(asOf, -2), resolvedAt: null }];
  const requestStepRows: ApprovalRequestStepRow[] = [{ id: stableUuid(tenantId, "approval-request-step", "pending-approval-1"), tenantId, approvalRequestId, sequence: 1, approverCapability: "approve:$action", minApprovals: 1, status: "pending", decidedBy: null, authorityDecisionId: null, decidedAt: null }];
  const actionLogRows: ActionLogRow[] = [
    { id: stableUuid(tenantId, "action-log", "failed-provider-attempt"), domainActionId: failedActionId, tenantId, step: "provider_call", input: { channel: "sms", retryable: true }, output: { error: "provider_timeout", attempt: 3 }, timestamp: dateOffset(asOf, -3) },
    { id: stableUuid(tenantId, "action-log", "failed-provider-recovery"), domainActionId: failedActionId, tenantId, step: "recovery_scheduled", input: { nextAttemptAt: dateOffset(asOf, 1).toISOString() }, output: { state: "waiting_for_provider" }, timestamp: dateOffset(asOf, -2) },
  ];
  const workflowRows: WorkflowStateRow[] = opportunityRows.slice(0, Math.min(opportunityRows.length, Math.max(200, Math.floor(leadCount * 0.6)))).map((opportunity, index) => ({
    id: stableUuid(tenantId, "workflow", index),
    tenantId,
    workflow: "lead_to_install",
    subjectType: "household",
    subjectId: opportunity.householdId!,
    state: opportunity.pipelineStage === "won" ? "installed" : opportunity.pipelineStage === "quote_sent" ? "quote_sent" : opportunity.pipelineStage === "lost" ? "closed_lost" : "water_test_scheduled",
    history: [{ from: "lead", to: "water_test_scheduled", cause: "demo_seed", at: dateOffset(asOf, -30).toISOString() }, { from: "water_test_scheduled", to: opportunity.pipelineStage === "won" ? "installed" : opportunity.pipelineStage, cause: "demo_seed", at: dateOffset(asOf, -5).toISOString() }],
    updatedAt: dateOffset(asOf, -2),
  }));
  workflowRows.push({ id: stableUuid(tenantId, "workflow", "recovery"), tenantId, workflow: "customer_communication", subjectType: "household", subjectId: householdsRows[31]!.id!, state: "recovery", history: [{ from: "executing", to: "failed", cause: "provider_timeout" }, { from: "failed", to: "recovery", cause: "retry_scheduled" }], updatedAt: dateOffset(asOf, -2) });

  const businessEventRows: BusinessEventRow[] = leadsRows.map((lead, index) => ({ id: stableUuid(tenantId, "business-event", index), tenantId, entityType: "lead", entityId: lead.id!, eventType: lead.status === "converted" ? "lead_converted" : "lead_created", payload: { status: lead.status, source: lead.source, demoSeed: DEMO_SEED_SOURCE }, occurredAt: lead.createdAt!, source: DEMO_SEED_SOURCE }));
  const scanRows: ScanFindingRow[] = [
    { id: stableUuid(tenantId, "scan-finding", "low-inventory"), tenantId, scanType: "low_inventory", summary: "RO membranes and salt bags are below reorder threshold at the Tampa stockroom.", details: { sku: "RO-STD", quantity: 2, threshold: 8 }, createdAt: dateOffset(asOf, -1), digestedAt: null, severity: "warning", draftedActionId: null },
    { id: stableUuid(tenantId, "scan-finding", "overdue-invoices"), tenantId, scanType: "overdue_invoices", summary: "Overdue invoice cohort needs a collection follow-up.", details: { count: invoiceRows.filter((row) => row.status === "overdue").length }, createdAt: dateOffset(asOf, -1), digestedAt: null, severity: "critical", draftedActionId: approvalActionId },
    { id: stableUuid(tenantId, "scan-finding", "provider-recovery"), tenantId, scanType: "provider_failure", summary: "SMS delivery failure is waiting for provider recovery.", details: { actionId: failedActionId, retryable: true }, createdAt: dateOffset(asOf, -2), digestedAt: null, severity: "warning", draftedActionId: failedActionId },
  ];

  return {
    tenantId,
    asOf,
    technicians: techRows,
    users: usersRows,
    employeeRoles: authority.employeeRoles,
    approvalChains: authority.approvalChains,
    approvalChainSteps: authority.approvalChainSteps,
    employeeRoleAssignments: authority.employeeRoleAssignments,
    roleAuthorityGrants: authority.roleAuthorityGrants,
    rolePermissions: authority.rolePermissions,
    households: householdsRows,
    contacts: contactsRows,
    contactMethods: methodsRows,
    leads: leadsRows,
    opportunities: opportunityRows,
    equipment: equipmentRows,
    serviceVisits: serviceVisitRows,
    maintenanceAgreements: maintenanceRows,
    inventoryItems: inventoryRows,
    warehouses: warehouseRows,
    warehouseStock: warehouseStockRows,
    procurementOrders: procurementRows,
    priceBookItems: priceBookRows,
    quotes: quoteRows,
    quoteLineItems: quoteLineRows,
    proposals: proposalRows,
    workOrders: workOrderRows,
    appointments: appointmentRows,
    tasks: taskRows,
    invoices: invoiceRows,
    payments: paymentRows,
    conversations: conversationRows,
    calls: callRows,
    messages: messageRows,
    workflowStates: workflowRows,
    businessEvents: businessEventRows,
    domainPolicies: policies,
    domainPolicyRevisions: revisions,
    domainActions: actionRows,
    authorityDecisions: decisionRows,
    authorityApprovalRequests: requestRows,
    authorityApprovalRequestSteps: requestStepRows,
    actionLog: actionLogRows,
    scanFindings: scanRows,
  };
}

function tableRows(data: DemoSeedData): Array<[string, readonly Record<string, unknown>[]]> {
  return [
    ["technicians", data.technicians], ["users", data.users], ["employeeRoles", data.employeeRoles], ["approvalChains", data.approvalChains], ["approvalChainSteps", data.approvalChainSteps], ["employeeRoleAssignments", data.employeeRoleAssignments], ["roleAuthorityGrants", data.roleAuthorityGrants], ["rolePermissions", data.rolePermissions], ["households", data.households], ["contacts", data.contacts], ["contactMethods", data.contactMethods], ["leads", data.leads], ["opportunities", data.opportunities], ["equipment", data.equipment], ["serviceVisits", data.serviceVisits], ["maintenanceAgreements", data.maintenanceAgreements], ["inventoryItems", data.inventoryItems], ["warehouses", data.warehouses], ["warehouseStock", data.warehouseStock], ["procurementOrders", data.procurementOrders], ["priceBookItems", data.priceBookItems], ["quotes", data.quotes], ["quoteLineItems", data.quoteLineItems], ["proposals", data.proposals], ["workOrders", data.workOrders], ["appointments", data.appointments], ["tasks", data.tasks], ["invoices", data.invoices], ["payments", data.payments], ["conversations", data.conversations], ["calls", data.calls], ["messages", data.messages], ["workflowStates", data.workflowStates], ["businessEvents", data.businessEvents], ["domainPolicies", data.domainPolicies], ["domainPolicyRevisions", data.domainPolicyRevisions], ["domainActions", data.domainActions], ["authorityDecisions", data.authorityDecisions], ["authorityApprovalRequests", data.authorityApprovalRequests], ["authorityApprovalRequestSteps", data.authorityApprovalRequestSteps], ["actionLog", data.actionLog], ["scanFindings", data.scanFindings],
  ];
}

export function validateDemoSeedData(data: DemoSeedData, minimumLeadCount = 900): DemoSeedValidation {
  const errors: string[] = [];
  const counts: Record<string, number> = {};
  for (const [name, rows] of tableRows(data)) counts[name] = rows.length;
  const leadStatuses: Record<string, number> = {};
  for (const lead of data.leads) leadStatuses[lead.status!] = (leadStatuses[lead.status!] ?? 0) + 1;
  const idsByTable = new Map<string, Set<string>>();
  for (const [name, rows] of tableRows(data)) {
    const ids = rows.map((row) => String(row.id ?? ""));
    idsByTable.set(name, new Set(ids));
    if (ids.some((id) => !UUID_RE.test(id))) errors.push(`${name} has an invalid id`);
    if (new Set(ids).size !== ids.length) errors.push(`${name} contains duplicate ids`);
    if (rows.some((row) => row.tenantId !== data.tenantId)) errors.push(`${name} crosses the requested tenant boundary`);
  }
  if (data.leads.length < minimumLeadCount) errors.push(`expected at least ${minimumLeadCount} leads, got ${data.leads.length}`);
  if (data.leads.length === 0 || Object.keys(leadStatuses).length < 5) errors.push("lead lifecycle statuses are incomplete");
  if (new Set(data.leads.map((lead) => lead.externalId)).size !== data.leads.length) errors.push("lead external ids are not unique");
  const householdIds = idsByTable.get("households")!;
  const contactMethodIds = idsByTable.get("contactMethods")!;
  const opportunityIds = idsByTable.get("opportunities")!;
  const quoteIds = idsByTable.get("quotes")!;
  const workOrderIds = idsByTable.get("workOrders")!;
  const invoiceIds = idsByTable.get("invoices")!;
  for (const lead of data.leads) {
    if (!householdIds.has(lead.householdId!)) errors.push(`lead ${lead.id} has no household`);
    if (!contactMethodIds.has(lead.contactMethodId!)) errors.push(`lead ${lead.id} has no contact method`);
  }
  for (const opportunity of data.opportunities) {
    if (!householdIds.has(opportunity.householdId!)) errors.push(`opportunity ${opportunity.id} has no household`);
  }
  for (const quote of data.quotes) {
    if (quote.opportunityId && !opportunityIds.has(quote.opportunityId)) errors.push(`quote ${quote.id} has no opportunity`);
  }
  for (const workOrder of data.workOrders) {
    if (!quoteIds.has(workOrder.quoteId!)) errors.push(`work order ${workOrder.id} has no quote`);
  }
  for (const payment of data.payments) {
    if (!invoiceIds.has(payment.invoiceId!)) errors.push(`payment ${payment.id} has no invoice`);
  }
  for (const appointment of data.appointments) {
    if (appointment.subjectType === "work_order" && !workOrderIds.has(appointment.subjectId!)) errors.push(`appointment ${appointment.id} has no work order`);
  }
  const has = <T>(rows: T[], predicate: (row: T) => boolean) => rows.some(predicate);
  if (!has(data.invoices, (row) => row.status === "overdue")) errors.push("missing overdue invoice edge");
  if (!has(data.payments, (row) => row.status === "failed")) errors.push("missing failed payment edge");
  if (!has(data.domainActions, (row) => row.status === "failed")) errors.push("missing failed action edge");
  if (!has(data.domainActions, (row) => row.status === "blocked_integration_unavailable")) errors.push("missing blocked integration edge");
  if (!has(data.workflowStates, (row) => row.state === "recovery")) errors.push("missing recovery workflow edge");
  if (!has(data.authorityApprovalRequests, (row) => row.status === "pending")) errors.push("missing pending approval edge");
  if (!has(data.appointments, (row) => row.status === "confirmed") || !has(data.appointments, (row) => row.status === "completed")) errors.push("appointment status variety is incomplete");
  if (!has(data.maintenanceAgreements, (row) => row.status === "renewal_window") || !has(data.maintenanceAgreements, (row) => row.status === "lapsed")) errors.push("maintenance edge statuses are incomplete");
  if (!has(data.inventoryItems, (row) => row.quantity! < row.reorderThreshold!)) errors.push("missing low-inventory edge");
  if (!has(data.domainPolicies, (row) => row.requiresConfirmation === true) || !has(data.domainPolicies, (row) => row.requiresConfirmation === false)) errors.push("policy confirmation variety is incomplete");
  return { valid: errors.length === 0, errors: unique(errors), counts, leadStatuses };
}

async function ensureDemoTenant(config: ValidatedDemoTenantConfig): Promise<void> {
  const db = adminDb();
  await db.transaction(async (tx) => {
    const [existing] = await tx.select({ id: tenants.id, name: tenants.name }).from(tenants).where(eq(tenants.id, config.tenantId)).limit(1);
    let created = false;
    if (!existing) {
      const [inserted] = await tx.insert(tenants).values({ id: config.tenantId, name: config.tenantName, timezone: config.timezone }).onConflictDoNothing().returning({ id: tenants.id });
      created = Boolean(inserted);
    } else if (existing.name !== config.tenantName) {
      throw new Error(`Tenant ${config.tenantId} exists with a different name; refusing to seed it`);
    }
    const [verifiedTenant] = await tx.select({ id: tenants.id, name: tenants.name }).from(tenants).where(eq(tenants.id, config.tenantId)).limit(1);
    if (!verifiedTenant || verifiedTenant.name !== config.tenantName) throw new Error(`Tenant ${config.tenantId} could not be verified safely`);
    const [settings] = await tx.select().from(tenantSettings).where(eq(tenantSettings.tenantId, config.tenantId)).limit(1);
    if (settings?.isDealerZero) throw new Error("Refusing to seed Dealer Zero or another protected tenant");
    if (!created && (!settings || (!settings.simulatorEnabled && !settings.trainingMode))) {
      throw new Error("Existing tenant is not marked as a demo/test tenant; refusing to seed it");
    }
    if (created) {
      await tx.insert(tenantSettings).values({ tenantId: config.tenantId, isDealerZero: false, simulatorEnabled: true, trainingMode: true }).onConflictDoNothing();
    }
  });
}

async function insertChunks(db: Db, table: any, rows: readonly Record<string, unknown>[], chunkSize = 250): Promise<void> {
  for (let start = 0; start < rows.length; start += chunkSize) {
    const chunk = rows.slice(start, start + chunkSize);
    if (chunk.length > 0) await db.insert(table).values(chunk).onConflictDoNothing();
  }
}

async function seedRows(data: DemoSeedData): Promise<void> {
  await withTenant(data.tenantId, async (db) => {
    await insertChunks(db, technicians, data.technicians);
    // Install the deterministic authority graph before users. The user-role sync
    // trigger otherwise creates same-key roles with random ids, leaving the
    // generated assignments pointed at role ids that were never inserted.
    await insertChunks(db, authorityStates, [{ tenantId: data.tenantId, revision: 1, updatedAt: data.asOf }]);
    await insertChunks(db, employeeRoles, data.employeeRoles);
    await insertChunks(db, approvalChains, data.approvalChains);
    await insertChunks(db, approvalChainSteps, data.approvalChainSteps);
    await insertChunks(db, roleAuthorityGrants, data.roleAuthorityGrants);
    await insertChunks(db, rolePermissions, data.rolePermissions);
    await insertChunks(db, users, data.users);
    await db.insert(tenantOperatingProfiles).values({
      tenantId: data.tenantId,
      industry: "water treatment",
      niche: "residential and light-commercial water filtration",
      description: "Isolated synthetic Florida dealer used for realistic FINNOR product verification.",
      primaryGeographies: ["Tampa Bay, Florida", "Sarasota, Florida", "Lakeland, Florida"],
      foundedYear: 2014,
      idealCustomerProfile: { segments: ["homeowners", "private-well households", "light commercial"], serviceRadiusMiles: 55 },
      businessFacts: { annualRevenueUsd: 9_400_000, leadConversionRate: "21%", totalLeadsSeeded: data.leads.length, demoSeed: DEMO_SEED_SOURCE },
      comparisonDefaults: { scaleMetric: "annual revenue", performanceMetric: "lead conversion rate" },
      updatedAt: data.asOf,
    }).onConflictDoUpdate({
      target: tenantOperatingProfiles.tenantId,
      set: {
        industry: "water treatment",
        niche: "residential and light-commercial water filtration",
        description: "Isolated synthetic Florida dealer used for realistic FINNOR product verification.",
        primaryGeographies: ["Tampa Bay, Florida", "Sarasota, Florida", "Lakeland, Florida"],
        foundedYear: 2014,
        idealCustomerProfile: { segments: ["homeowners", "private-well households", "light commercial"], serviceRadiusMiles: 55 },
        businessFacts: { annualRevenueUsd: 9_400_000, leadConversionRate: "21%", totalLeadsSeeded: data.leads.length, demoSeed: DEMO_SEED_SOURCE },
        comparisonDefaults: { scaleMetric: "annual revenue", performanceMetric: "lead conversion rate" },
        updatedAt: data.asOf,
      },
    });
    // The user-role sync trigger has already materialized these composite keys.
    // Upsert the intended demo scopes and active states instead of silently
    // accepting the trigger defaults (notably for assigned/suspended technicians).
    for (const assignment of data.employeeRoleAssignments) {
      await db.insert(employeeRoleAssignments).values(assignment).onConflictDoUpdate({
        target: [employeeRoleAssignments.employeeId, employeeRoleAssignments.roleId],
        set: {
          resourceScope: assignment.resourceScope,
          active: assignment.active,
          expiresAt: assignment.expiresAt ?? null,
        },
      });
    }
    await insertChunks(db, households, data.households);
    await insertChunks(db, contacts, data.contacts);
    await insertChunks(db, contactMethods, data.contactMethods);
    await insertChunks(db, leads, data.leads);
    await insertChunks(db, opportunities, data.opportunities);
    await insertChunks(db, equipment, data.equipment);
    await insertChunks(db, serviceVisits, data.serviceVisits);
    await insertChunks(db, maintenanceAgreements, data.maintenanceAgreements);
    await insertChunks(db, inventoryItems, data.inventoryItems);
    await insertChunks(db, warehouses, data.warehouses);
    await insertChunks(db, warehouseStock, data.warehouseStock);
    await insertChunks(db, procurementOrders, data.procurementOrders);
    await insertChunks(db, priceBookItems, data.priceBookItems);
    await insertChunks(db, technicianCapacity, data.technicians.flatMap((tech, index) => [{ id: stableUuid(data.tenantId, "technician-capacity", `${index}-weekday`), tenantId: data.tenantId, technicianId: tech.id!, dayOfWeek: null, startTime: "07:00", endTime: "17:00", maxConcurrentJobs: index % 2 === 0 ? 3 : 2, serviceRadiusMiles: 45 } as Record<string, unknown>]));
    await insertChunks(db, technicianDispatchProfiles, data.technicians.map((tech, index) => ({ technicianId: tech.id!, tenantId: data.tenantId, baseAddress: index % 2 === 0 ? "4100 Suncoast Commerce Dr, Tampa, FL" : "2200 Gulf Gate Pkwy, Sarasota, FL", workdayStart: "07:00", workdayEnd: "17:00", defaultSlaMinutes: 120, updatedAt: data.asOf })));
    await insertChunks(db, domainPolicies, data.domainPolicies);
    await insertChunks(db, domainPolicyRevisions, data.domainPolicyRevisions);
    await insertChunks(db, quotes, data.quotes);
    await insertChunks(db, quoteLineItems, data.quoteLineItems);
    await insertChunks(db, proposals, data.proposals);
    await insertChunks(db, workOrders, data.workOrders);
    await insertChunks(db, appointments, data.appointments);
    await insertChunks(db, tasks, data.tasks);
    await insertChunks(db, invoices, data.invoices);
    await insertChunks(db, payments, data.payments);
    await insertChunks(db, conversations, data.conversations);
    await insertChunks(db, calls, data.calls);
    await insertChunks(db, messages, data.messages);
    await insertChunks(db, workflowStates, data.workflowStates);
    await insertChunks(db, businessEvents, data.businessEvents);
    await insertChunks(db, domainActions, data.domainActions);
    await insertChunks(db, authorityDecisions, data.authorityDecisions);
    await db.update(domainActions).set({ authorityDecisionId: data.authorityDecisions[0]?.id ?? null }).where(eq(domainActions.id, data.domainActions[0]!.id!));
    await insertChunks(db, authorityApprovalRequests, data.authorityApprovalRequests);
    await insertChunks(db, authorityApprovalRequestSteps, data.authorityApprovalRequestSteps);
    await insertChunks(db, actionLog, data.actionLog);
    await insertChunks(db, scanFindings, data.scanFindings);
  });
  // User profiles have an additional self-only RLS dimension. Seed each one in
  // its own authenticated-user transaction instead of bypassing that policy.
  for (const user of data.users) {
    const userId = user.id!;
    const title = user.role === "owner" ? "Founder & Owner" : user.role === "dispatcher" ? "Dispatcher" : "Field Technician";
    const profileFacts = user.role === "owner"
      ? { age: 39, demoSeed: DEMO_SEED_SOURCE }
      : { demoSeed: DEMO_SEED_SOURCE };
    await withTenant(data.tenantId, async (db) => {
      await db.insert(userOperatingProfiles).values({ userId, tenantId: data.tenantId, title, profileFacts, updatedAt: data.asOf })
        .onConflictDoUpdate({ target: userOperatingProfiles.userId, set: { title, profileFacts, updatedAt: data.asOf } });
    }, userId);
  }
}

export async function seedDemoTenant(config: DemoTenantConfig): Promise<SeedDemoTenantResult> {
  assertDemoSeedEnvironment();
  const validatedConfig = validateDemoTenantConfig(config);
  const data = generateDemoSeedData(validatedConfig);
  const validation = validateDemoSeedData(data);
  if (!validation.valid) throw new Error(`Generated demo data failed validation: ${validation.errors.join("; ")}`);
  await ensureDemoTenant(validatedConfig);
  await seedRows(data);
  return { tenantId: validatedConfig.tenantId, tenantName: validatedConfig.tenantName, counts: validation.counts, validation };
}

function parseArgs(argv: string[]): DemoTenantConfig {
  const args = new Map<string, string>();
  for (const arg of argv) {
    const [key, ...rest] = arg.replace(/^--/, "").split("=");
    if (key && rest.length > 0) args.set(key, rest.join("="));
  }
  const tenantId = args.get("tenant-id");
  const tenantName = args.get("tenant-name");
  if (!tenantId || !tenantName) throw new Error("Usage: npx tsx scripts/seed-demo-tenant.ts --tenant-id=<uuid> --tenant-name='Suncoast Demo Water Co' [--timezone=America/New_York]");
  return { tenantId, tenantName, timezone: args.get("timezone") };
}

const isMain = process.argv[1]?.endsWith("seed-demo-tenant.ts") || process.argv[1]?.endsWith("seed-demo-tenant.js");
if (isMain) {
  seedDemoTenant(parseArgs(process.argv.slice(2)))
    .then(async (result) => {
      console.log(JSON.stringify(result, null, 2));
      await closePool();
    })
    .catch(async (error) => {
      console.error(error instanceof Error ? error.message : error);
      await closePool();
      process.exit(1);
    });
}
