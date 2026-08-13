import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";
import { randomUUID } from "node:crypto";
import { migrate } from "../../packages/db/migrate";
import {
  authorityApprovalRequests,
  authorityDecisions,
  authorityStates,
  closePool,
  employeeRoleAssignments,
  employeeRoles,
  receiveWork,
  roleAuthorityGrants,
  users,
  workEntityLinks,
  works,
  withTenant,
} from "@finnor/db";
import { employeeAuthoritySnapshot, evaluateAuthority } from "@finnor/authority";
import { and, eq } from "drizzle-orm";

const SUPER_URL = process.env.DATABASE_URL ?? "postgres://finnor:finnor@localhost:5432/finnor";
const APP_URL = SUPER_URL.replace(/\/\/[^@]+@/, "//finnor_app:finnor_app@");

async function dbUp(): Promise<boolean> {
  const c = new pg.Client({ connectionString: SUPER_URL, connectionTimeoutMillis: 2_000 });
  try { await c.connect(); await c.end(); return true; } catch { return false; }
}
const available = await dbUp();

describe.skipIf(!available)("Upgrade 8 employee authority runtime", () => {
  const tenantA = randomUUID();
  const tenantB = randomUUID();
  const ownerA = randomUUID();
  const dispatcherA = randomUUID();
  const technicianA = randomUUID();
  const ownerB = randomUUID();
  const otherCustomer = randomUUID();
  const ownerAEmail = `owner-a-${ownerA}@example.test`;
  const dispatcherAEmail = `dispatch-a-${dispatcherA}@example.test`;
  const technicianAEmail = `tech-a-${technicianA}@example.test`;
  const ownerBEmail = `owner-b-${ownerB}@example.test`;
  let dispatchRole: string;
  let ownerRole: string;
  let technicianRole: string;
  let chainId: string;

  beforeAll(async () => {
    await migrate(SUPER_URL);
    const admin = new pg.Client({ connectionString: SUPER_URL });
    await admin.connect();
    await admin.query("INSERT INTO finnor_os.tenants(id,name) VALUES ($1,'Authority A'),($2,'Authority B')", [tenantA, tenantB]);
    await admin.query("INSERT INTO finnor_os.users(id,tenant_id,email,role,display_name,phone_number) VALUES ($1,$4,$7,'owner','Owner A','+15551000001'),($2,$4,$8,'dispatcher','Dispatch A','+15551000002'),($3,$4,$9,'technician','Tech A','+15551000003'),($5,$6,$10,'owner','Owner B','+15551000004')", [ownerA, dispatcherA, technicianA, tenantA, ownerB, tenantB, ownerAEmail, dispatcherAEmail, technicianAEmail, ownerBEmail]);
    await admin.query("INSERT INTO finnor_os.households(id,tenant_id,address) VALUES ($1,$2,'Out of scope')", [otherCustomer, tenantA]);
    await admin.end();
    process.env.DATABASE_URL = APP_URL;
    await closePool();

    const seeded = await withTenant(tenantA, async (db) => {
      const roles = await db.select().from(employeeRoles).where(eq(employeeRoles.tenantId, tenantA));
      const [chain] = await db.select().from((await import("@finnor/db")).approvalChains).where(and(eq((await import("@finnor/db")).approvalChains.tenantId, tenantA), eq((await import("@finnor/db")).approvalChains.key, "default")));
      return { roles, chain: chain! };
    });
    dispatchRole = seeded.roles.find((role) => role.key === "dispatcher")!.id;
    ownerRole = seeded.roles.find((role) => role.key === "owner")!.id;
    technicianRole = seeded.roles.find((role) => role.key === "technician")!.id;
    chainId = seeded.chain.id;

    // Make this tenant's real journey intentionally narrower than legacy defaults.
    await withTenant(tenantA, async (db) => {
      await db.delete(roleAuthorityGrants).where(and(eq(roleAuthorityGrants.tenantId, tenantA), eq(roleAuthorityGrants.roleId, dispatchRole)));
      await db.delete(roleAuthorityGrants).where(and(eq(roleAuthorityGrants.tenantId, tenantA), eq(roleAuthorityGrants.roleId, technicianRole)));
      await db.insert(roleAuthorityGrants).values([
        { tenantId: tenantA, roleId: dispatchRole, capability: "query:customer_lookup", resourceType: "household", maxRisk: "low" },
        { tenantId: tenantA, roleId: dispatchRole, capability: "action:create_invoice", resourceType: "household", maxRisk: "high", maxAmountUsd: "500", approvalRequired: false, approvalChainId: chainId },
        { tenantId: tenantA, roleId: technicianRole, capability: "action:log_visit_report", resourceType: "household", maxRisk: "medium" },
      ]);
      await db.update(employeeRoleAssignments).set({ resourceScope: { kind: "resources", resourceType: "household", resourceIds: [otherCustomer] } }).where(and(eq(employeeRoleAssignments.tenantId, tenantA), eq(employeeRoleAssignments.employeeId, dispatcherA), eq(employeeRoleAssignments.roleId, dispatchRole)));
      await db.update(employeeRoleAssignments).set({ resourceScope: { kind: "assigned" } }).where(and(eq(employeeRoleAssignments.tenantId, tenantA), eq(employeeRoleAssignments.employeeId, technicianA), eq(employeeRoleAssignments.roleId, technicianRole)));
    });
  });

  afterAll(async () => { await closePool(); process.env.DATABASE_URL = SUPER_URL; });

  const ctx = (employeeId: string, role: "owner" | "dispatcher" | "technician", tenantId = tenantA) => ({ tenantId, userId: employeeId, employeeId, role });

  it("keeps users canonical and exposes multiple active roles with one authority revision", async () => {
    const snapshot = await employeeAuthoritySnapshot(ctx(dispatcherA, "dispatcher"));
    expect(snapshot).toMatchObject({ employeeId: dispatcherA, roles: expect.arrayContaining(["dispatcher"]) });
    expect(snapshot.revision).toBeGreaterThan(0);
  });

  it("records the initiating employee, current owner and authority snapshot on Work and the Company Graph", async () => {
    const snapshot = await employeeAuthoritySnapshot(ctx(dispatcherA, "dispatcher"));
    const received = await receiveWork({
      tenantId: tenantA,
      userId: dispatcherA,
      channel: "text",
      instruction: "Look up the scoped customer",
      idempotencyKey: `authority-work:${randomUUID()}`,
      authorityContext: snapshot as unknown as Record<string, unknown>,
      activeContext: { householdId: otherCustomer },
    });
    const result = await withTenant(tenantA, async (db) => {
      const [work] = await db.select().from(works).where(eq(works.id, received.workId));
      const links = await db.select().from(workEntityLinks).where(eq(workEntityLinks.workId, received.workId));
      return { work, links };
    });
    expect(result.work).toMatchObject({
      createdBy: dispatcherA,
      currentOwnerId: dispatcherA,
      authorityContext: { employeeId: dispatcherA, revision: snapshot.revision },
    });
    expect(result.links).toEqual(expect.arrayContaining([
      expect.objectContaining({ entityType: "user", entityId: dispatcherA }),
      expect.objectContaining({ entityType: "household", entityId: otherCustomer }),
    ]));
  });

  it("allows a scoped customer query and denies a different customer", async () => {
    const allowed = await evaluateAuthority(ctx(dispatcherA, "dispatcher"), { operation: "query", capability: "query:customer_lookup", resource: { type: "household", id: otherCustomer }, risk: "low" });
    expect(allowed.outcome).toBe("allowed");
    const denied = await evaluateAuthority(ctx(dispatcherA, "dispatcher"), { operation: "query", capability: "query:customer_lookup", resource: { type: "household", id: randomUUID() }, risk: "low" });
    expect(denied).toMatchObject({ outcome: "denied", reasonCode: "resource_out_of_scope" });
  });

  it("enforces monetary limits and routes elevation to real capable approvers", async () => {
    const within = await evaluateAuthority(ctx(dispatcherA, "dispatcher"), { operation: "action", capability: "action:create_invoice", resource: { type: "household", id: otherCustomer }, amountUsd: 450, risk: "high" });
    expect(within.outcome).toBe("allowed");
    const elevated = await evaluateAuthority(ctx(dispatcherA, "dispatcher"), { operation: "action", capability: "action:create_invoice", resource: { type: "household", id: otherCustomer }, amountUsd: 750, risk: "high" });
    expect(elevated).toMatchObject({ outcome: "approval_required", reasonCode: "monetary_limit_exceeded" });
    expect(elevated.eligibleApproverIds).toContain(ownerA);
    expect(elevated.eligibleApproverIds).not.toContain(technicianA);
  });

  it("denies missing capabilities and records auditable reason/evidence", async () => {
    const denied = await evaluateAuthority(ctx(technicianA, "technician"), { operation: "action", capability: "action:record_payment", resource: { type: "payment", id: randomUUID() }, amountUsd: 10, risk: "high" });
    expect(denied).toMatchObject({ outcome: "denied", reasonCode: "capability_missing" });
    const [audit] = await withTenant(tenantA, (db) => db.select().from(authorityDecisions).where(eq(authorityDecisions.id, denied.id)));
    expect(audit?.evidence).toMatchObject({ roles: expect.arrayContaining(["technician"]) });
    await expect(withTenant(tenantA, (db) => db.update(authorityDecisions).set({ reasonCode: "tampered" }).where(eq(authorityDecisions.id, denied.id)))).rejects.toThrow();
  });

  it("prevents cross-tenant assignment and rejects stale authority after revocation", async () => {
    const [tenantBRole] = await withTenant(tenantB, (db) => db.select().from(employeeRoles).where(and(eq(employeeRoles.tenantId, tenantB), eq(employeeRoles.key, "owner"))));
    await expect(withTenant(tenantA, (db) => db.insert(employeeRoleAssignments).values({ tenantId: tenantA, employeeId: dispatcherA, roleId: tenantBRole!.id, resourceScope: { kind: "tenant" } }))).rejects.toThrow(/failed query|tenant boundary/i);

    const before = await evaluateAuthority(ctx(dispatcherA, "dispatcher"), { operation: "query", capability: "query:customer_lookup", resource: { type: "household", id: otherCustomer }, risk: "low" });
    await withTenant(tenantA, (db) => db.update(employeeRoleAssignments).set({ active: false }).where(and(eq(employeeRoleAssignments.tenantId, tenantA), eq(employeeRoleAssignments.employeeId, dispatcherA), eq(employeeRoleAssignments.roleId, dispatchRole))));
    const [state] = await withTenant(tenantA, (db) => db.select().from(authorityStates).where(eq(authorityStates.tenantId, tenantA)));
    expect(state!.revision).toBeGreaterThan(before.authorityRevision);
    const after = await evaluateAuthority(ctx(dispatcherA, "dispatcher"), { operation: "query", capability: "query:customer_lookup", resource: { type: "household", id: otherCustomer }, risk: "low" });
    expect(after).toMatchObject({ outcome: "denied", reasonCode: "capability_missing" });
  });
});
