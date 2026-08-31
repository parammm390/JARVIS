import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  applicationAccounts,
  authProfiles,
  closePool,
  households,
  invoices,
  tenantIntegrations,
  tenants,
  withTenant,
} from "@finnor/db";
import { checkOperationalProgramAdmissibility } from "@finnor/operational-ir";
import {
  computerWriteProgram,
  externalSpendProgram,
  internalCanonicalWriteProgram,
} from "../../packages/operational-ir/fixtures/p2-programs";
import { reseal } from "../../packages/operational-ir/fixtures/programs";
import { finnorStaticResolutionProvider } from "../../packages/orchestration/src/operational-ir-effect-resolution";
import { migrate } from "../../packages/db/migrate";

const DB_URL = process.env.DATABASE_URL ?? "postgres://finnor:finnor@localhost:5432/finnor";
const TENANT_A = "70000000-0000-4000-8000-000000000001";
const TENANT_B = "70000000-0000-4000-8000-000000000002";
const HOUSEHOLD_ID = "40000000-0000-4000-8000-000000000001";
const INVOICE_ID = "50000000-0000-4000-8000-000000000001";
const ACCOUNT_ID = "80000000-0000-4000-8000-000000000001";

async function dbUp(): Promise<boolean> {
  const client = new pg.Client({ connectionString: DB_URL, connectionTimeoutMillis: 2_000 });
  try { await client.connect(); await client.end(); return true; } catch { return false; }
}
const available = await dbUp();

describe.skipIf(!available).sequential("P2 tenant-scoped entity/capability resolution", () => {
  beforeAll(async () => {
    process.env.DATABASE_URL = DB_URL;
    await migrate(DB_URL);
    await withTenant(TENANT_A, async (db) => {
      await db.insert(tenants).values({ id: TENANT_A, name: "P2 Resolution Tenant A" }).onConflictDoNothing();
      await db.insert(households).values({ id: HOUSEHOLD_ID, tenantId: TENANT_A, address: "1 Static Proof Way" }).onConflictDoNothing();
      await db.insert(invoices).values({ id: INVOICE_ID, tenantId: TENANT_A, householdId: HOUSEHOLD_ID, amountUsd: "125.00", status: "draft" }).onConflictDoNothing();
      await db.insert(tenantIntegrations).values({ tenantId: TENANT_A, capability: "marketing", binding: "p2-test", mode: "emulator" }).onConflictDoNothing();
      await db.insert(applicationAccounts).values({
        id: ACCOUNT_ID,
        tenantId: TENANT_A,
        accountKey: "p2-accounting-app",
        application: "accounting_app",
        provider: "p2-test",
        displayName: "P2 Accounting App",
        status: "active",
      }).onConflictDoNothing();
      await db.insert(authProfiles).values({
        tenantId: TENANT_A,
        authProfileRef: "p2-accounting-profile",
        principalType: "tenant",
        principalId: TENANT_A,
        applicationAccountId: ACCOUNT_ID,
        purpose: "p2-static-admissibility",
        status: "active",
        connectionStatus: "active",
      }).onConflictDoNothing();
    });
    await withTenant(TENANT_B, (db) => db.insert(tenants).values({ id: TENANT_B, name: "P2 Resolution Tenant B" }).onConflictDoNothing());
  });

  afterAll(() => closePool());

  it("admits only canonical targets in the trusted tenant and rejects a cross-tenant reference", async () => {
    const own = await checkOperationalProgramAdmissibility(internalCanonicalWriteProgram(), {
      resolution: { tenantId: TENANT_A, provider: finnorStaticResolutionProvider },
    });
    const crossTenant = await checkOperationalProgramAdmissibility(internalCanonicalWriteProgram(), {
      resolution: { tenantId: TENANT_B, provider: finnorStaticResolutionProvider },
    });
    expect(own.status).toBe("ADMISSIBLE");
    expect(crossTenant.status).toBe("REJECTED");
    expect(crossTenant.resolution?.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ decision: "REJECTED", reasonCode: expect.stringMatching(/CROSS_TENANT_REFERENCE|ENTITY_NOT_FOUND/) }),
    ]));
  });

  it("resolves configured provider and exact computer application bindings and rejects an unconfigured app", async () => {
    const spend = await checkOperationalProgramAdmissibility(externalSpendProgram(), {
      resolution: { tenantId: TENANT_A, provider: finnorStaticResolutionProvider },
    });
    const computer = await checkOperationalProgramAdmissibility(computerWriteProgram(true), {
      resolution: { tenantId: TENANT_A, provider: finnorStaticResolutionProvider },
    });
    expect(spend.status, JSON.stringify({ reasons: spend.reasonCodes, issues: spend.issues, resolution: spend.resolution }, null, 2)).toBe("ADMISSIBLE");
    expect(computer.status, JSON.stringify({ reasons: computer.reasonCodes, issues: computer.issues, resolution: computer.resolution }, null, 2)).toBe("ADMISSIBLE");

    const unconfigured = reseal(computerWriteProgram(true), (draft) => {
      if (draft.body.kind !== "effect" || !draft.body.effectDeclaration) throw new Error("fixture drift");
      draft.body.arguments.application = "unconfigured_app";
      draft.body.effectDeclaration.computerMutations[0]!.application = "unconfigured_app";
      draft.body.effectDeclaration.externalMutations[0]!.system = "unconfigured_app";
      for (const flow of draft.body.effectDeclaration.informationFlows) {
        if (flow.destination.kind === "COMPUTER_APPLICATION") flow.destination.application = "unconfigured_app";
      }
    });
    const missingBinding = await checkOperationalProgramAdmissibility(unconfigured, {
      resolution: { tenantId: TENANT_A, provider: finnorStaticResolutionProvider },
    });
    expect(missingBinding.status).toBe("REJECTED");
    expect(missingBinding.resolution?.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ decision: "REJECTED", reasonCode: "REQUIRED_BINDING_NOT_CONFIGURED" }),
    ]));
  });
});
