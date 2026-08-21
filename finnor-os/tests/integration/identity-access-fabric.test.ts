import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";
import { randomUUID } from "node:crypto";
import { migrate } from "../../packages/db/migrate";
import { closePool } from "@finnor/db";
import {
  listAvailableIdentityAccess,
  resolveAuthProfileRef,
  resolveCredentialContext,
  setTenantSecretReaderForTesting,
} from "@finnor/security";
import { assembleOperatingContext } from "@finnor/orchestration";

const SUPER_URL = process.env.DATABASE_URL ?? "postgres://finnor:finnor@localhost:5432/finnor";
const APP_URL = SUPER_URL.replace(/\/\/[^@]+@/, "//finnor_app:finnor_app@");

async function canConnect(connectionString: string): Promise<boolean> {
  const client = new pg.Client({ connectionString, connectionTimeoutMillis: 2_000 });
  try { await client.connect(); await client.end(); return true; } catch { return false; }
}
const available = await canConnect(SUPER_URL);

describe.skipIf(!available)("Phase 1 Identity + Access Binding Fabric", () => {
  const tenantA = randomUUID();
  const tenantB = randomUUID();
  const clientA = `identity-a-${randomUUID().slice(0, 8)}`;
  const clientB = `identity-b-${randomUUID().slice(0, 8)}`;
  const alice = randomUUID();
  const mario = randomUUID();
  const bobB = randomUUID();
  const phoenix = randomUUID();
  const locationB = randomUUID();
  const serviceTeam = randomUUID();
  const otherTeam = randomUUID();
  const personalEmail = randomUUID();
  const marioEmail = randomUUID();
  const serviceEmail = randomUUID();
  const delegatedEmail = randomUUID();
  const sharedEmail = randomUUID();
  const phoenixVoice = randomUUID();
  const disabledEmail = randomUUID();
  const crossTenantEmail = randomUUID();
  const supplierAccount = randomUUID();
  const invoiceAccount = randomUUID();
  const payrollAccount = randomUUID();
  const ambiguousAccountA = randomUUID();
  const ambiguousAccountB = randomUUID();
  const disabledAccount = randomUUID();
  const tenantBAccount = randomUUID();
  const supplierProfile = randomUUID();
  const invoiceProfile = randomUUID();
  const payrollProfile = randomUUID();
  const ambiguousProfileA = randomUUID();
  const ambiguousProfileB = randomUUID();
  const disabledProfile = randomUUID();
  const tenantBProfile = randomUUID();
  let admin: pg.Client;
  let app: pg.Client;

  beforeAll(async () => {
    await migrate(SUPER_URL);
    admin = new pg.Client({ connectionString: SUPER_URL });
    await admin.connect();
    app = new pg.Client({ connectionString: APP_URL });
    await app.connect();
    await admin.query(
      `INSERT INTO finnor_os.tenants(id,client_key,name)
       VALUES ($1,$2,'Identity A'),($3,$4,'Identity B')`,
      [tenantA, clientA, tenantB, clientB],
    );
    await admin.query(
      `INSERT INTO finnor_os.tenant_locations(id,tenant_id,location_key,name)
       VALUES ($1,$2,'phoenix','Phoenix'),($3,$4,'other-location','Other')`,
      [phoenix, tenantA, locationB, tenantB],
    );
    await admin.query(
      `INSERT INTO finnor_os.users(id,tenant_id,email,role,display_name,primary_location_id)
       VALUES ($1,$2,$3,'technician','Alice',$4),($5,$2,$6,'technician','Mario',$4),
              ($7,$8,$9,'technician','Bob B',$10)`,
      [alice, tenantA, `alice-${alice}@example.test`, phoenix, mario, `mario-${mario}@example.test`, bobB, tenantB, `bob-${bobB}@example.test`, locationB],
    );
    await admin.query(
      `INSERT INTO finnor_os.org_units(id,tenant_id,unit_key,name,kind,location_id,managed_by)
       VALUES ($1,$3,'service-team','Service Team','team',$4,$5),
              ($2,$3,'other-team','Other Team','team',$4,$5)`,
      [serviceTeam, otherTeam, tenantA, phoenix, clientA],
    );
    await admin.query(
      `INSERT INTO finnor_os.org_unit_memberships(tenant_id,org_unit_id,employee_id,managed_by)
       VALUES ($1,$2,$3,$4)`,
      [tenantA, serviceTeam, alice, clientA],
    );
    await admin.query(
      `INSERT INTO finnor_os.communication_identities
         (id,tenant_id,identity_key,provider,channel,address,provider_identity_ref,status,capabilities,credential_provider,credential_ref,managed_by)
       VALUES
         ($1,$9,'alice-email','gmail','email','alice@company.test',NULL,'active','["send"]','aws-secrets-manager',$11,$10),
         ($2,$9,'mario-email','gmail','email','mario@company.test',NULL,'active','["send"]','aws-secrets-manager',$12,$10),
         ($3,$9,'service-email','gmail','email','service@company.test',NULL,'active','["send"]','aws-secrets-manager',$13,$10),
         ($4,$9,'delegated-email','gmail','email','delegated@company.test',NULL,'active','["send"]','aws-secrets-manager',$14,$10),
         ($5,$9,'shared-email','gmail','email','hello@company.test',NULL,'active','["send"]','aws-secrets-manager',$15,$10),
         ($6,$9,'phoenix-voice','vapi','voice',NULL,'phone-phoenix','active','["call"]','aws-secrets-manager',$16,$10),
         ($7,$9,'disabled-email','gmail','email','disabled@company.test',NULL,'disabled','["send"]','aws-secrets-manager',$17,$10),
         ($8,$18,'cross-email','gmail','email','cross@other.test',NULL,'active','["send"]','aws-secrets-manager',$19,$20)`,
      [personalEmail, marioEmail, serviceEmail, delegatedEmail, sharedEmail, phoenixVoice, disabledEmail, crossTenantEmail,
        tenantA, clientA,
        `finnor/tenants/${tenantA}/gmail/alice`, `finnor/tenants/${tenantA}/gmail/mario`,
        `finnor/tenants/${tenantA}/gmail/service`, `finnor/tenants/${tenantA}/gmail/delegated`,
        `finnor/tenants/${tenantA}/gmail/shared`, `finnor/tenants/${tenantA}/vapi/phoenix`,
        `finnor/tenants/${tenantA}/gmail/disabled`, tenantB, `finnor/tenants/${tenantB}/gmail/cross`, clientB],
    );
    await admin.query(
      `INSERT INTO finnor_os.communication_identity_bindings
         (tenant_id,communication_identity_id,principal_type,principal_id,purpose,priority,status,managed_by)
       VALUES
         ($1,$2,'employee',$3,'quote',100,'active',$11),
         ($1,$4,'employee',$5,'default',100,'active',$11),
         ($1,$6,'team',$7,'service',80,'active',$11),
         ($1,$8,'team',$9,'delegate',80,'active',$11),
         ($1,$10,'tenant',$1,'company',10,'active',$11),
         ($1,$12,'location',$13,'branch_call',50,'active',$11),
         ($1,$14,'employee',$3,'disabled',100,'active',$11),
         ($15,$16,'tenant',$15,'default',0,'active',$17)`,
      [tenantA, personalEmail, alice, marioEmail, mario, serviceEmail, serviceTeam, delegatedEmail, otherTeam,
        sharedEmail, clientA, phoenixVoice, phoenix, disabledEmail, tenantB, crossTenantEmail, clientB],
    );
    await admin.query(
      `INSERT INTO finnor_os.application_accounts
         (id,tenant_id,account_key,application,provider,display_name,provider_account_ref,status,capabilities,metadata,managed_by)
       VALUES
         ($1,$8,'supplier-a','supplier_portal','supplier_portal','Supplier Portal A','supplier-account-a','active','["purchase"]','{"region":"west"}',$9),
         ($2,$8,'qbo-invoices','quickbooks','quickbooks','QuickBooks Invoices','realm-invoice','active','["sync"]','{}',$9),
         ($3,$8,'qbo-payroll','quickbooks','quickbooks','QuickBooks Payroll','realm-payroll','active','["payroll"]','{}',$9),
         ($4,$8,'qbo-ambiguous-a','quickbooks','quickbooks','QuickBooks Ambiguous A','realm-a','active','["sync"]','{}',$9),
         ($5,$8,'qbo-ambiguous-b','quickbooks','quickbooks','QuickBooks Ambiguous B','realm-b','active','["sync"]','{}',$9),
         ($6,$8,'qbo-disabled','quickbooks','quickbooks','QuickBooks Disabled','realm-disabled','disabled','["sync"]','{}',$9),
         ($7,$10,'other-qbo','quickbooks','quickbooks','Other QuickBooks','realm-other','active','["sync"]','{}',$11)`,
      [supplierAccount, invoiceAccount, payrollAccount, ambiguousAccountA, ambiguousAccountB, disabledAccount, tenantBAccount,
        tenantA, clientA, tenantB, clientB],
    );
    await admin.query(
      `INSERT INTO finnor_os.auth_profiles
         (id,tenant_id,auth_profile_ref,principal_type,principal_id,application_account_id,purpose,priority,scope,credential_provider,credential_ref,status,capabilities,restrictions,managed_by)
       VALUES
         ($1,$9,'mario-supplier-a','employee',$10,$2,'purchase',100,'{}','aws-secrets-manager',$16,'active','["purchase"]','{}',$15),
         ($3,$9,'alice-qbo-invoices','employee',$11,$4,'invoice_sync',100,'{}','aws-secrets-manager',$17,'active','["sync"]','{}',$15),
         ($5,$9,'alice-qbo-payroll','employee',$11,$6,'payroll',100,'{}','aws-secrets-manager',$18,'active','["payroll"]','{}',$15),
         ($7,$9,'alice-qbo-ambiguous-a','employee',$11,$8,'reconcile',50,'{}','aws-secrets-manager',$19,'active','["sync"]','{}',$15),
         ($12,$9,'alice-qbo-ambiguous-b','employee',$11,$13,'reconcile',50,'{}','aws-secrets-manager',$20,'active','["sync"]','{}',$15),
         ($14,$9,'alice-qbo-disabled','employee',$11,$21,'close_books',100,'{}','aws-secrets-manager',$22,'disabled','["sync"]','{}',$15),
         ($23,$24,'other-qbo-profile','employee',$25,$26,'invoice_sync',100,'{}','aws-secrets-manager',$27,'active','["sync"]','{}',$28)`,
      [supplierProfile, supplierAccount, invoiceProfile, invoiceAccount, payrollProfile, payrollAccount,
        ambiguousProfileA, ambiguousAccountA, tenantA, mario, alice, ambiguousProfileB,
        ambiguousAccountB, disabledProfile, clientA,
        `finnor/tenants/${tenantA}/supplier/a`, `finnor/tenants/${tenantA}/quickbooks/invoices`,
        `finnor/tenants/${tenantA}/quickbooks/payroll`, `finnor/tenants/${tenantA}/quickbooks/ambiguous-a`,
        `finnor/tenants/${tenantA}/quickbooks/ambiguous-b`, disabledAccount,
        `finnor/tenants/${tenantA}/quickbooks/disabled`, tenantBProfile, tenantB, bobB, tenantBAccount,
        `finnor/tenants/${tenantB}/quickbooks/other`, clientB],
    );

    setTenantSecretReaderForTesting(async (reference): Promise<Record<string, string>> => {
      if (reference.includes("/gmail/")) return { user: "secret-default@invalid.test", appPassword: "gmail-app-password" };
      if (reference.includes("/vapi/")) return { apiKey: "vapi-key", phoneNumberId: "secret-default-phone", assistantId: "assistant" };
      if (reference.includes("/quickbooks/")) return {
        clientId: "client", clientSecret: "secret", refreshToken: "refresh",
        realmId: "secret-default-realm", environment: "sandbox",
      };
      return { opaque: "not-read-by-safe-profile-selection" };
    });
    process.env.DATABASE_URL = APP_URL;
    await closePool();
  });

  afterAll(async () => {
    setTenantSecretReaderForTesting(null);
    await closePool();
    process.env.DATABASE_URL = SUPER_URL;
    await app?.end();
    await admin?.end();
  });

  it("applies the migration once and keeps all four structures tenant-scoped", async () => {
    expect((await admin.query("SELECT name FROM finnor_os._migrations WHERE name='0085_phase1_identity_access_fabric.sql'")).rows).toHaveLength(1);
    expect((await migrate(SUPER_URL)).filter((name) => name === "0085_phase1_identity_access_fabric.sql")).toHaveLength(0);
    await app.query("SELECT set_config('app.tenant_id',$1,false)", [tenantA]);
    expect((await app.query("SELECT count(*)::int count FROM finnor_os.communication_identities")).rows[0]?.count).toBe(7);
    expect((await app.query("SELECT count(*)::int count FROM finnor_os.communication_identity_bindings")).rows[0]?.count).toBe(7);
    expect((await app.query("SELECT count(*)::int count FROM finnor_os.application_accounts")).rows[0]?.count).toBe(6);
    expect((await app.query("SELECT count(*)::int count FROM finnor_os.auth_profiles")).rows[0]?.count).toBe(6);
    await app.query("SELECT set_config('app.tenant_id',$1,false)", [tenantB]);
    expect((await app.query("SELECT count(*)::int count FROM finnor_os.communication_identities")).rows[0]?.count).toBe(1);
    expect((await app.query("SELECT count(*)::int count FROM finnor_os.communication_identity_bindings")).rows[0]?.count).toBe(1);
    expect((await app.query("SELECT count(*)::int count FROM finnor_os.application_accounts")).rows[0]?.count).toBe(1);
    expect((await app.query("SELECT count(*)::int count FROM finnor_os.auth_profiles")).rows[0]?.count).toBe(1);
    await app.query("SELECT set_config('app.tenant_id',$1,false)", [tenantA]);
    await expect(app.query(
      `INSERT INTO finnor_os.communication_identity_bindings
         (tenant_id,communication_identity_id,principal_type,principal_id,purpose)
       VALUES ($1,$2,'employee',$3,'forged')`,
      [tenantA, personalEmail, bobB],
    )).rejects.toThrow(/tenant|scope|policy|boundary/i);
  });

  it("selects personal, team, location, and explicitly shared senders in precedence order", async () => {
    const personal = await resolveCredentialContext(tenantA, alice, "gmail", "quote", { channel: "email" });
    expect(personal.access).toMatchObject({ communicationIdentityId: personalEmail, principalRef: { type: "employee", id: alice } });
    expect(personal.credentials.user).toBe("alice@company.test");

    const team = await resolveCredentialContext(tenantA, alice, "gmail", "service", { channel: "email" });
    expect(team.access).toMatchObject({ communicationIdentityId: serviceEmail, principalRef: { type: "team", id: serviceTeam } });
    expect(team.credentials.user).toBe("service@company.test");

    const location = await resolveCredentialContext(tenantA, alice, "vapi", "branch_call", { channel: "voice" });
    expect(location.access).toMatchObject({ communicationIdentityId: phoenixVoice, principalRef: { type: "location", id: phoenix } });
    expect(location.credentials.phoneNumberId).toBe("phone-phoenix");

    const shared = await resolveCredentialContext(tenantA, alice, "gmail", "company", { channel: "email" });
    expect(shared.access).toMatchObject({ communicationIdentityId: sharedEmail, principalRef: { type: "tenant", id: tenantA } });
  });

  it("fails visibly instead of falling back or impersonating another principal", async () => {
    await expect(resolveCredentialContext(tenantA, alice, "gmail", "missing", { channel: "email" }))
      .rejects.toMatchObject({ code: "no_valid_identity" });
    await expect(resolveCredentialContext(tenantA, alice, "gmail", "default", { channel: "email", communicationIdentityId: marioEmail }))
      .rejects.toMatchObject({ code: "authority_denied" });
    await expect(resolveCredentialContext(tenantA, alice, "gmail", "delegate", { channel: "email", communicationIdentityId: delegatedEmail }))
      .rejects.toMatchObject({ code: "authority_denied" });
    await expect(resolveCredentialContext(tenantA, alice, "gmail", "disabled", { channel: "email", communicationIdentityId: disabledEmail }))
      .rejects.toMatchObject({ code: "identity_inactive" });
    await expect(resolveCredentialContext(tenantA, alice, "gmail", "default", { channel: "email", communicationIdentityId: crossTenantEmail }))
      .rejects.toMatchObject({ code: "identity_not_found" });
  });

  it("allows related-team use and a resource-scoped explicit act-as grant without broad impersonation", async () => {
    const allowed = await resolveCredentialContext(tenantA, alice, "gmail", "service", { channel: "email", communicationIdentityId: serviceEmail });
    expect(allowed.access.communicationIdentityId).toBe(serviceEmail);
    expect(allowed.access.principalRef).toEqual({ type: "team", id: serviceTeam });

    const delegatedRole = randomUUID();
    await admin.query(
      "INSERT INTO finnor_os.employee_roles(id,tenant_id,key,name) VALUES ($1,$2,$3,'Scoped identity delegate')",
      [delegatedRole, tenantA, `identity-delegate-${delegatedRole.slice(0, 8)}`],
    );
    await admin.query(
      `INSERT INTO finnor_os.employee_role_assignments(tenant_id,employee_id,role_id,resource_scope)
       VALUES ($1,$2,$3,$4::jsonb)`,
      [tenantA, alice, delegatedRole, JSON.stringify({
        kind: "resources",
        resourceType: "communication_identity",
        resourceIds: [delegatedEmail],
      })],
    );
    await admin.query(
      `INSERT INTO finnor_os.role_authority_grants(tenant_id,role_id,capability,resource_type,effect,max_risk)
       VALUES ($1,$2,'identity:act_as','communication_identity','allow','high')`,
      [tenantA, delegatedRole],
    );

    const explicitlyDelegated = await resolveCredentialContext(tenantA, alice, "gmail", "delegate", {
      channel: "email",
      communicationIdentityId: delegatedEmail,
    });
    expect(explicitlyDelegated.access).toMatchObject({
      communicationIdentityId: delegatedEmail,
      principalRef: { type: "team", id: otherTeam },
    });
    await expect(resolveCredentialContext(tenantA, alice, "gmail", "default", {
      channel: "email",
      communicationIdentityId: marioEmail,
    })).rejects.toMatchObject({ code: "authority_denied" });
  });

  it("selects safe supplier and purpose-specific application profiles without exposing credentials", async () => {
    const supplier = await resolveAuthProfileRef(tenantA, mario, "supplier_portal", "purchase");
    expect(supplier).toMatchObject({
      authProfileRef: "mario-supplier-a",
      principalRef: { type: "employee", id: mario },
      applicationAccount: { id: supplierAccount, providerAccountRef: "supplier-account-a" },
    });
    expect(JSON.stringify(supplier)).not.toMatch(/credential|password|token|secret/i);

    const invoice = await resolveCredentialContext(tenantA, alice, "quickbooks", "invoice_sync", { application: "quickbooks" });
    const payroll = await resolveCredentialContext(tenantA, alice, "quickbooks", "payroll", { application: "quickbooks" });
    expect(invoice.access.authProfileRef).toBe("alice-qbo-invoices");
    expect(invoice.credentials.realmId).toBe("realm-invoice");
    expect(payroll.access.authProfileRef).toBe("alice-qbo-payroll");
    expect(payroll.credentials.realmId).toBe("realm-payroll");
  });

  it("rejects ambiguous, disabled, impersonated, and cross-tenant authProfileRefs", async () => {
    await expect(resolveCredentialContext(tenantA, alice, "quickbooks", "reconcile", { application: "quickbooks" }))
      .rejects.toMatchObject({ code: "ambiguous_auth_profile" });
    await expect(resolveCredentialContext(tenantA, alice, "quickbooks", "close_books", { application: "quickbooks", authProfileRef: "alice-qbo-disabled" }))
      .rejects.toMatchObject({ code: "auth_profile_inactive" });
    await expect(resolveAuthProfileRef(tenantA, alice, "supplier_portal", "purchase", "mario-supplier-a"))
      .rejects.toMatchObject({ code: "authority_denied" });
    await expect(resolveCredentialContext(tenantA, alice, "quickbooks", "invoice_sync", { application: "quickbooks", authProfileRef: "other-qbo-profile" }))
      .rejects.toMatchObject({ code: "auth_profile_not_found" });
  });

  it("projects safe, bounded identity access into Operating Context", async () => {
    const direct = await listAvailableIdentityAccess(tenantA, alice);
    expect(direct.communicationIdentities).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: personalEmail, principalRef: { type: "employee", id: alice } }),
      expect.objectContaining({ id: serviceEmail, principalRef: { type: "team", id: serviceTeam } }),
      expect.objectContaining({ id: sharedEmail, principalRef: { type: "tenant", id: tenantA } }),
    ]));
    expect(direct.communicationIdentities).not.toEqual(expect.arrayContaining([expect.objectContaining({ id: marioEmail })]));
    const assembled = await assembleOperatingContext(
      { tenantId: tenantA, userId: alice, employeeId: alice, role: "technician" },
      { instruction: "Prepare the service notice", includeMemory: false, includeCanonicalBusinessState: false },
    );
    expect(assembled.context.identityAccess.communicationIdentities.length).toBeGreaterThan(0);
    const serialized = JSON.stringify(assembled.context.identityAccess);
    expect(serialized).not.toMatch(/credentialRef|credentialVersion|appPassword|accessToken|refreshToken|apiKey|cookie|sessionStorage|localStorage/i);
  });
});
