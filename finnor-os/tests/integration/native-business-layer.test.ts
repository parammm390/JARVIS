// Native business layer acceptance: CRM, scheduling, inventory, accounting, quotes,
// and issue flagging are REAL against Finnor's own tables — no external SaaS required.

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import pg from "pg";
import { migrate } from "../../packages/db/migrate";
import { seed, SEED_TENANT_ID } from "../../packages/db/seed";
import {
  withTenant,
  closePool,
  domainActions,
  households,
  serviceVisits,
  technicians,
  inventoryItems,
  invoices,
  workflowStates,
  communicationsLog,
  proposals,
} from "@finnor/db";
import { FinnorOrchestrator } from "@finnor/orchestration";
import { createDefaultRegistry } from "@finnor/tools";
import { desc, eq } from "drizzle-orm";
import type { DomainAction } from "@finnor/shared-types";

const DB_URL = process.env.DATABASE_URL ?? "postgres://finnor:finnor@localhost:5432/finnor";

async function dbUp(): Promise<boolean> {
  const c = new pg.Client({ connectionString: DB_URL, connectionTimeoutMillis: 2000 });
  try {
    await c.connect();
    await c.end();
    return true;
  } catch {
    return false;
  }
}
const available = await dbUp();

let orchestrator: FinnorOrchestrator;

async function runGated(actionType: string, payload: Record<string, unknown>) {
  const action: DomainAction = await withTenant(SEED_TENANT_ID, async (db) => {
    const [row] = await db
      .insert(domainActions)
      .values({ tenantId: SEED_TENANT_ID, actionType, payload, status: "draft" })
      .returning();
    return {
      id: row!.id,
      tenantId: row!.tenantId,
      actionType,
      payload,
      policyId: null,
      status: row!.status,
      createdAt: row!.createdAt.toISOString(),
    };
  });
  const policy = await orchestrator.loadPolicy(action);
  const first = await orchestrator.executor.execute(action, policy);
  // Read-only actions are ungated by policy and complete immediately; everything
  // else stops at the gate and needs the (voice) approval.
  if (!first.output.gated) return first;
  return orchestrator.decide(action.id, SEED_TENANT_ID, "approve", "voice:native-test");
}

describe.skipIf(!available)("native business layer — real, end to end, gated", () => {
  beforeAll(async () => {
    process.env.DATABASE_URL = DB_URL;
    process.env.COMMS_MODE = "native";
    await migrate(DB_URL);
    await seed(DB_URL);
    orchestrator = new FinnorOrchestrator({ tools: createDefaultRegistry() });
    // Deterministic stock for the deduction assertions, whatever earlier runs consumed.
    await withTenant(SEED_TENANT_ID, (db) =>
      db.update(inventoryItems).set({ quantity: 6 }).where(eq(inventoryItems.sku, "RO-MEM-75")),
    );
  });
  afterAll(async () => {
    await closePool();
  });

  it("create_lead → real household + workflow 'lead' + interaction logged", async () => {
    const r = await runGated("create_lead", {
      name: "Tom Okafor",
      phone: "+13195557001",
      address: "9 River Bend Ct, Cedar Falls, IA",
      notes: "Asked about iron staining at the county fair booth",
    });
    expect(r.status).toBe("success");
    const hhId = String(r.output.householdId);
    const [wf] = await withTenant(SEED_TENANT_ID, (db) =>
      db.select().from(workflowStates).where(eq(workflowStates.subjectId, hhId)),
    );
    expect(wf!.state).toBe("lead");
    const comms = await withTenant(SEED_TENANT_ID, (db) =>
      db.select().from(communicationsLog).where(eq(communicationsLog.householdId, hhId)),
    );
    expect(comms.some((c) => /county fair/.test(c.content))).toBe(true);
  });

  it("assign_lead_to_technician + check availability + reschedule — real calendar ops", async () => {
    const assign = await runGated("assign_lead_to_technician", { phone: "+13195557001", technicianName: "Dale" });
    expect(assign.status).toBe("success");
    const visitId = String(assign.output.visitId);

    const avail = await runGated("check_technician_availability", { technicianName: "Dale", date: "2026-07-20" });
    expect(avail.status).toBe("success");
    expect(avail.output.technician).toBe("Dale Brooks");
    expect(avail.output.workingHours).toBeTruthy();

    const res = await runGated("reschedule_visit", { visitId, newTime: "2026-07-20T15:00:00Z", reason: "customer asked for afternoon" });
    expect(res.status).toBe("success");
    const [v] = await withTenant(SEED_TENANT_ID, (db) => db.select().from(serviceVisits).where(eq(serviceVisits.id, visitId)));
    expect(v!.scheduledAt?.toISOString()).toBe("2026-07-20T15:00:00.000Z");
    expect(v!.notes).toMatch(/Rescheduled/);
  });

  it("inventory: stock check, usage deduction, refuses to go negative, reorder flag", async () => {
    const check = await runGated("check_stock_level", { sku: "RO-MEM-75" });
    expect(check.status).toBe("success");
    const startQty = Number(check.output.quantity);

    const use = await runGated("log_stock_used_on_visit", { sku: "RO-MEM-75", quantity: 2 });
    expect(use.status).toBe("success");
    expect(Number(use.output.remaining)).toBe(startQty - 2);

    const tooMany = await runGated("log_stock_used_on_visit", { sku: "RO-MEM-75", quantity: 999 });
    expect(tooMany.status).toBe("failure");
    expect(tooMany.error).toMatch(/in stock/);

    const reorder = await runGated("flag_reorder_needed", { sku: "RO-MEM-75" });
    expect(reorder.status).toBe("success");
    expect(typeof reorder.output.reorderNeeded).toBe("boolean");
  });

  it("accounting: invoice → reminder (sms channel via outbox) → payment recorded", async () => {
    const inv = await runGated("create_invoice", { phone: "+13195550142", amountUsd: 249, memo: "Annual maintenance visit" });
    expect(inv.status).toBe("success");
    const invoiceId = String(inv.output.invoiceId);

    const remind = await runGated("send_payment_reminder", { invoiceId });
    expect(remind.status).toBe("success");
    expect(remind.output.channel).toBe("sms"); // no email on file → SMS channel (outbox until carrier)

    const pay = await runGated("record_payment", { invoiceId });
    expect(pay.status).toBe("success");
    const [row] = await withTenant(SEED_TENANT_ID, (db) => db.select().from(invoices).where(eq(invoices.id, invoiceId)));
    expect(row!.status).toBe("paid");
  });

  it("generate_quote stores a real proposal, prices only from policy — never guessed", async () => {
    const r = await runGated("generate_quote", {
      phone: "+13195550142",
      householdLabel: "The Hendersons",
      items: ["HE Softener 45k", "Install labor"],
    });
    expect(r.status).toBe("success");
    const quote = r.output.quote as { lines: Array<{ item: string; priceUsd: number | null }>; totalUsd: number | null; pricingNote: string | null };
    expect(quote.lines).toHaveLength(2);
    expect(quote.lines.every((l) => l.priceUsd === null)).toBe(true); // no configured pricing → no invented numbers
    expect(quote.pricingNote).toMatch(/not configured/);
    const [prop] = await withTenant(SEED_TENANT_ID, (db) =>
      db.select().from(proposals).orderBy(desc(proposals.id)).limit(1),
    );
    expect(prop).toBeTruthy();
  });

  it("flag_visit_issue creates a real review card in the owner's queue", async () => {
    const r = await runGated("flag_visit_issue", { issue: "Brine tank crack found at the Henderson place — needs replacement part" });
    expect(r.status).toBe("success");
    const [card] = await withTenant(SEED_TENANT_ID, (db) =>
      db.select().from(domainActions).where(eq(domainActions.id, String(r.output.reviewCardId))),
    );
    expect(card!.status).toBe("needs_human_review");
    expect(card!.summary).toMatch(/Brine tank crack/);
  });

  it("send_customer_message goes out via the native channel and lands in the comms history", async () => {
    const r = await runGated("send_customer_message", {
      phone: "+13195550142",
      message: "Your water test results are in — everything looks great except hardness at 18 gpg. We'll walk you through options.",
      channel: "sms",
    });
    expect(r.status).toBe("success");
    const [hh] = await withTenant(SEED_TENANT_ID, (db) =>
      db.select().from(households).where(eq(households.address, "412 Maple Ridge Rd, Cedar Falls, IA")),
    );
    const comms = await withTenant(SEED_TENANT_ID, (db) =>
      db.select().from(communicationsLog).where(eq(communicationsLog.householdId, hh!.id)).orderBy(desc(communicationsLog.timestamp)).limit(3),
    );
    expect(comms.some((c) => /water test results/.test(c.content))).toBe(true);
  });
});
