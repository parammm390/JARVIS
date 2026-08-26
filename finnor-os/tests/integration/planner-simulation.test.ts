// B2.T2 acceptance: five flagship plugin simulations read real tenant data without
// mutating it, and LLMPlanner persists the resulting labeled prediction beside the
// newly drafted (not-yet-approved) domain action.

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import pg from "pg";
import { randomUUID } from "node:crypto";
import { migrate } from "../../packages/db/migrate";
import { closePool, commands, communicationsLog, domainActions, households, inventoryItems, invoices, proposals, serviceVisits, technicians, tenants, withTenant } from "@finnor/db";
import { and, eq } from "drizzle-orm";
import { createDefaultPluginRegistry, LLMPlanner } from "@finnor/orchestration";
import type { LLMProvider } from "@finnor/orchestration";
import type { DomainPolicy, MemorySnapshot, TenantContext } from "@finnor/shared-types";

const DB_URL = process.env.DATABASE_URL ?? "postgres://finnor:finnor@localhost:5432/finnor";
const TENANT_ID = "00000000-0000-4000-8000-0000000000c2";

async function dbUp(): Promise<boolean> {
  const client = new pg.Client({ connectionString: DB_URL, connectionTimeoutMillis: 2000 });
  try { await client.connect(); await client.end(); return true; } catch { return false; }
}
const available = await dbUp();
const policy = (actionType: string): DomainPolicy => ({ id: "", tenantId: TENANT_ID, actionType, policy: {}, requiresConfirmation: true, confirmationTemplate: null, version: 0 });
const memory = (): MemorySnapshot => ({ shortTerm: null, longTerm: null, semantic: [], episodic: [], patterns: null });
const context = (): TenantContext => ({ tenantId: TENANT_ID, userId: "simulation-test", role: "owner" });

describe.skipIf(!available)("planner simulations", () => {
  beforeAll(async () => {
    process.env.DATABASE_URL = DB_URL;
    await migrate(DB_URL);
    await withTenant(TENANT_ID, (db) => db.insert(tenants).values({ id: TENANT_ID, name: "Planner Simulation Test Dealer" }).onConflictDoNothing());
  });
  beforeEach(() => { delete process.env.AWS_BEDROCK_API_KEY; });
  afterAll(async () => { await closePool(); });

  it("runs data-backed dry-runs for quotation, scheduling, inventory, invoice-to-cash, and bulk notify without mutation", async () => {
    const sku = `SIM-${randomUUID().slice(0, 8)}`;
    const [household] = await withTenant(TENANT_ID, (db) =>
      db.insert(households).values({ tenantId: TENANT_ID, address: "42 Simulation Way", contactInfo: { name: "Sim Customer", phone: "+15550000042" }, marketingConsent: true }).returning(),
    );
    const [technician] = await withTenant(TENANT_ID, (db) => db.insert(technicians).values({ tenantId: TENANT_ID, name: "Simulation Tech", availability: {} }).returning());
    const [visit] = await withTenant(TENANT_ID, (db) => db.insert(serviceVisits).values({ householdId: household!.id, type: "service", scheduledAt: new Date("2026-08-01T10:00:00.000Z") }).returning());
    const [item] = await withTenant(TENANT_ID, (db) => db.insert(inventoryItems).values({ tenantId: TENANT_ID, sku, name: "Simulation Filter", quantity: 10, reorderThreshold: 2 }).returning());
    const [invoice] = await withTenant(TENANT_ID, (db) => db.insert(invoices).values({ tenantId: TENANT_ID, householdId: household!.id, amountUsd: "125.00", status: "sent" }).returning());
    const before = await withTenant(TENANT_ID, async (db) => ({
      quantity: (await db.select({ quantity: inventoryItems.quantity }).from(inventoryItems).where(eq(inventoryItems.id, item!.id)))[0]!.quantity,
      scheduledAt: (await db.select({ scheduledAt: serviceVisits.scheduledAt }).from(serviceVisits).where(eq(serviceVisits.id, visit!.id)))[0]!.scheduledAt,
      proposals: (await db.select().from(proposals).where(eq(proposals.householdId, household!.id))).length,
      commands: (await db.select().from(commands).where(eq(commands.tenantId, TENANT_ID))).length,
      communications: (await db.select().from(communicationsLog).where(eq(communicationsLog.householdId, household!.id))).length,
    }));
    const registry = createDefaultPluginRegistry();
    const results = await Promise.all([
      registry.simulate("generate_quote", { householdId: household!.id, householdLabel: "Sim Customer", items: ["Simulation Filter"] }, policy("generate_quote")),
      registry.simulate("assign_technician_to_visit", { visitId: visit!.id, technicianId: technician!.id }, policy("assign_technician_to_visit")),
      registry.simulate("log_stock_used_on_visit", { sku: item!.sku, quantity: 3, visitId: visit!.id }, policy("log_stock_used_on_visit")),
      registry.simulate("start_invoice_to_cash_workflow", { invoiceId: invoice!.id, channel: "sms" }, policy("start_invoice_to_cash_workflow")),
      registry.simulate("bulk_notify_existing_customers", { discountPercent: 10, channel: "sms" }, policy("bulk_notify_existing_customers")),
    ]);
    expect(results.every((result) => result.mode === "dry_run")).toBe(true);
    const after = await withTenant(TENANT_ID, async (db) => ({
      quantity: (await db.select({ quantity: inventoryItems.quantity }).from(inventoryItems).where(eq(inventoryItems.id, item!.id)))[0]!.quantity,
      scheduledAt: (await db.select({ scheduledAt: serviceVisits.scheduledAt }).from(serviceVisits).where(eq(serviceVisits.id, visit!.id)))[0]!.scheduledAt,
      proposals: (await db.select().from(proposals).where(eq(proposals.householdId, household!.id))).length,
      commands: (await db.select().from(commands).where(eq(commands.tenantId, TENANT_ID))).length,
      communications: (await db.select().from(communicationsLog).where(eq(communicationsLog.householdId, household!.id))).length,
    }));
    expect(after).toEqual(before);
  });

  it("stores the prediction alongside the draft before the confirmation gate", async () => {
    const provider: LLMProvider = { name: "simulation-stub", async complete() { return JSON.stringify({ actions: [{ action_type: "generate_quote", payload: { householdLabel: "Prediction Customer", items: ["Simulation Filter"] } }] }); } };
    const [action] = await new LLMPlanner(createDefaultPluginRegistry(), provider).plan("Quote the simulation filter.", context(), memory());
    const [row] = await withTenant(TENANT_ID, (db) => db.select().from(domainActions).where(and(eq(domainActions.tenantId, TENANT_ID), eq(domainActions.id, action!.id))));
    expect(row!.status).toBe("draft");
    expect(row!.predictedReceipt).toMatchObject({ version: 1, actionType: "generate_quote", simulation: { mode: "dry_run" } });
    expect((row!.predictedReceipt as { simulation: { summary: string } }).simulation.summary).toContain("Dry run");
  });
});
process.env.FINNOR_PLANNING_IR_MODE = "legacy"; // This suite intentionally certifies the bounded legacy planner envelope.
