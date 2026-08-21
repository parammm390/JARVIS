import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import pg from "pg";
import { closePool, getPool } from "@finnor/db";
import { resolveCredentialContext } from "@finnor/security";
import { migrate } from "../../packages/db/migrate";
import { parseClientManifest, type ClientManifest } from "../../scripts/client-manifest";
import { provisionClient } from "../../scripts/client-provisioning";
import type { TenantAuthAdmin } from "../../scripts/tenant-user";

const DB_URL = process.env.DATABASE_URL ?? "postgres://finnor:finnor@localhost:5432/finnor";

async function dbUp(): Promise<boolean> {
  const client = new pg.Client({ connectionString: DB_URL, connectionTimeoutMillis: 2_000 });
  try {
    await client.connect();
    await client.end();
    return true;
  } catch {
    return false;
  }
}

const available = await dbUp();

function fakeAuth(): TenantAuthAdmin {
  const users = new Map<string, { id: string; email: string }>();
  return {
    listUsers: vi.fn(async ({ page = 1, perPage = 50 }: { page?: number; perPage?: number } = {}) => {
      const all = [...users.values()];
      const start = (page - 1) * perPage;
      return {
        data: {
          users: all.slice(start, start + perPage),
          aud: "authenticated",
          nextPage: start + perPage < all.length ? page + 1 : null,
          lastPage: Math.ceil(all.length / perPage),
          total: all.length,
        },
        error: null,
      };
    }),
    createUser: vi.fn(async ({ email }: { email: string }) => {
      const normalized = email.toLowerCase();
      const user = { id: randomUUID(), email: normalized };
      users.set(normalized, user);
      return { data: { user }, error: null };
    }),
    updateUserById: vi.fn(async () => ({ data: { user: {} }, error: null })),
  } as unknown as TenantAuthAdmin;
}

function identityManifest(clientKey: string): ClientManifest {
  const alice = `${clientKey}-alice@example.test`;
  const mario = `${clientKey}-mario@example.test`;
  return parseClientManifest({
    clientKey,
    tenant: { name: "Identity Convergence", timezone: "America/Phoenix" },
    locations: [{ key: "main-office", name: "Main Office", address: "1 Identity Way" }],
    users: [
      { email: alice, role: "owner", displayName: "Alice", locationKey: "main-office" },
      { email: mario, role: "technician", displayName: "Mario", orgUnitKeys: ["service-team"] },
    ],
    orgUnits: [{ key: "service-team", name: "Service Team", kind: "team" }],
    communicationIdentities: [
      {
        key: "alice-email",
        provider: "gmail",
        channel: "email",
        address: alice,
        capabilities: ["quotes"],
        credential: { provider: "aws-secrets-manager", ref: "finnor/tenants/{tenantId}/gmail/alice-v1", version: "AWSCURRENT" },
      },
      {
        key: "service-sms",
        provider: "ghl",
        channel: "sms",
        address: "+15555550101",
        providerIdentityRef: "location-service",
        capabilities: ["dispatch"],
        credential: { provider: "aws-secrets-manager", ref: "finnor/tenants/{tenantId}/ghl/service-v1" },
      },
      {
        key: "main-voice",
        provider: "vapi",
        channel: "voice",
        address: "+15555550102",
        providerIdentityRef: "assistant-main",
        capabilities: ["confirmations"],
        credential: { provider: "aws-secrets-manager", ref: "finnor/tenants/{tenantId}/vapi/main-v1" },
      },
    ],
    communicationIdentityBindings: [
      { identityKey: "alice-email", principal: { type: "employee", employeeEmail: alice }, purpose: "quotes", priority: 100 },
      { identityKey: "service-sms", principal: { type: "team", orgUnitKey: "service-team" }, purpose: "dispatch", priority: 50 },
      { identityKey: "main-voice", principal: { type: "location", locationKey: "main-office" }, purpose: "confirmations", priority: 25 },
    ],
    applicationAccounts: [
      {
        key: "quickbooks-main",
        application: "quickbooks",
        provider: "quickbooks",
        displayName: "QuickBooks Main",
        providerAccountRef: "realm-v1",
        capabilities: ["accounting"],
        metadata: { region: "us" },
      },
      {
        key: "supplier-main",
        application: "supplier_portal",
        provider: "supplier_portal",
        displayName: "Supplier Portal",
        providerAccountRef: "supplier-v1",
        capabilities: ["purchasing"],
      },
    ],
    authProfiles: [
      {
        ref: "alice-quickbooks",
        principal: { type: "employee", employeeEmail: alice },
        applicationAccountKey: "quickbooks-main",
        purpose: "accounting",
        priority: 100,
        credential: { provider: "aws-secrets-manager", ref: "finnor/tenants/{tenantId}/quickbooks/alice-v1" },
        capabilities: ["accounting"],
      },
      {
        ref: "mario-supplier",
        principal: { type: "employee", employeeEmail: mario },
        applicationAccountKey: "supplier-main",
        purpose: "purchasing",
        priority: 50,
        credential: { provider: "aws-secrets-manager", ref: "finnor/tenants/{tenantId}/supplier/mario-v1" },
        capabilities: ["purchasing"],
        restrictions: { allowedPurposes: ["purchasing"] },
      },
    ],
  });
}

async function accessSnapshot(tenantId: string) {
  return getPool().query(
    `SELECT 'identity' kind, identity_key logical_key, id, status, address value,
            credential_ref, updated_at
       FROM finnor_os.communication_identities WHERE tenant_id=$1
     UNION ALL
     SELECT 'account', account_key, id, status, display_name, NULL, updated_at
       FROM finnor_os.application_accounts WHERE tenant_id=$1
     UNION ALL
     SELECT 'profile', auth_profile_ref, id, status, priority::text, credential_ref, updated_at
       FROM finnor_os.auth_profiles WHERE tenant_id=$1
     ORDER BY kind, logical_key`,
    [tenantId],
  );
}

describe.skipIf(!available)("identity/access manifest convergence", () => {
  beforeAll(async () => {
    process.env.DATABASE_URL = DB_URL;
    await migrate(DB_URL);
  });

  afterAll(async () => closePool());

  it("is idempotent, rotates references in place, disables removals, and repairs drift", async () => {
    const clientKey = `access-${randomUUID().slice(0, 8)}`;
    const auth = fakeAuth();
    const initial = identityManifest(clientKey);

    const first = await provisionClient(initial, { auth });
    expect(first.identityAccess).toEqual({
      communicationIdentities: 3,
      communicationIdentityBindings: 3,
      applicationAccounts: 2,
      authProfiles: 2,
      compatibilityMode: false,
    });
    const before = await accessSnapshot(first.tenantId);

    const repeated = await provisionClient(initial, { auth });
    expect(repeated.tenantId).toBe(first.tenantId);
    expect((await accessSnapshot(first.tenantId)).rows).toEqual(before.rows);

    const alice = initial.users[0]!.email;
    const mario = initial.users[1]!.email;
    const changed = parseClientManifest({
      ...initial,
      tenant: { ...initial.tenant },
      communicationIdentities: [
        {
          ...initial.communicationIdentities![0]!,
          address: "alice.rotated@example.test",
          credential: { provider: "aws-secrets-manager", ref: "finnor/tenants/{tenantId}/gmail/alice-v2", version: "v2" },
        },
        initial.communicationIdentities![2],
      ],
      communicationIdentityBindings: [
        { identityKey: "alice-email", principal: { type: "employee", employeeEmail: alice }, purpose: "quotes", priority: 125 },
        initial.communicationIdentityBindings![2],
      ],
      applicationAccounts: [{
        ...initial.applicationAccounts![1]!,
        displayName: "Supplier Portal Rotated",
        providerAccountRef: "supplier-v2",
        metadata: { region: "west" },
      }],
      authProfiles: [{
        ...initial.authProfiles![1]!,
        principal: { type: "employee", employeeEmail: mario },
        priority: 75,
        credential: { provider: "aws-secrets-manager", ref: "finnor/tenants/{tenantId}/supplier/mario-v2", version: "v2" },
      }],
    });
    await provisionClient(changed, { auth });

    const rotated = await accessSnapshot(first.tenantId);
    const byKey = new Map(rotated.rows.map((row) => [`${row.kind}:${row.logical_key}`, row]));
    const originalByKey = new Map(before.rows.map((row) => [`${row.kind}:${row.logical_key}`, row]));
    expect(byKey.get("identity:alice-email")).toMatchObject({
      id: originalByKey.get("identity:alice-email").id,
      status: "active",
      value: "alice.rotated@example.test",
      credential_ref: `finnor/tenants/${first.tenantId}/gmail/alice-v2`,
    });
    expect(byKey.get("identity:service-sms")).toMatchObject({
      id: originalByKey.get("identity:service-sms").id,
      status: "disabled",
    });
    expect(byKey.get("account:quickbooks-main")).toMatchObject({
      id: originalByKey.get("account:quickbooks-main").id,
      status: "disabled",
    });
    expect(byKey.get("account:supplier-main")).toMatchObject({
      id: originalByKey.get("account:supplier-main").id,
      status: "active",
      value: "Supplier Portal Rotated",
    });
    expect(byKey.get("profile:alice-quickbooks")).toMatchObject({
      id: originalByKey.get("profile:alice-quickbooks").id,
      status: "disabled",
    });
    expect(byKey.get("profile:mario-supplier")).toMatchObject({
      id: originalByKey.get("profile:mario-supplier").id,
      status: "active",
      value: "75",
      credential_ref: `finnor/tenants/${first.tenantId}/supplier/mario-v2`,
    });

    const removedBinding = await getPool().query<{ id: string }>(
      `DELETE FROM finnor_os.communication_identity_bindings b
       USING finnor_os.communication_identities i
       WHERE b.tenant_id=$1 AND i.tenant_id=b.tenant_id AND i.id=b.communication_identity_id
         AND i.identity_key='alice-email'
       RETURNING b.id`,
      [first.tenantId],
    );
    expect(removedBinding.rowCount).toBe(1);
    await getPool().query(
      "UPDATE finnor_os.auth_profiles SET priority=-99 WHERE tenant_id=$1 AND auth_profile_ref='mario-supplier'",
      [first.tenantId],
    );
    await provisionClient(changed, { auth });
    const repaired = await getPool().query(
      `SELECT
         (SELECT count(*)::int FROM finnor_os.communication_identity_bindings b
          JOIN finnor_os.communication_identities i ON i.tenant_id=b.tenant_id AND i.id=b.communication_identity_id
          WHERE b.tenant_id=$1 AND i.identity_key='alice-email' AND b.status='active') binding_count,
         (SELECT priority FROM finnor_os.auth_profiles WHERE tenant_id=$1 AND auth_profile_ref='mario-supplier') profile_priority`,
      [first.tenantId],
    );
    expect(repaired.rows[0]).toEqual({ binding_count: 1, profile_priority: 75 });

    const cleared = parseClientManifest({
      ...changed,
      communicationIdentities: [],
      communicationIdentityBindings: [],
      applicationAccounts: [],
      authProfiles: [],
    });
    await provisionClient(cleared, { auth });
    const active = await getPool().query(
      `SELECT
         (SELECT count(*)::int FROM finnor_os.communication_identities WHERE tenant_id=$1 AND managed_by=$2 AND status<>'disabled') identities,
         (SELECT count(*)::int FROM finnor_os.communication_identity_bindings WHERE tenant_id=$1 AND managed_by=$2 AND status<>'disabled') bindings,
         (SELECT count(*)::int FROM finnor_os.application_accounts WHERE tenant_id=$1 AND managed_by=$2 AND status<>'disabled') accounts,
         (SELECT count(*)::int FROM finnor_os.auth_profiles WHERE tenant_id=$1 AND managed_by=$2 AND status<>'disabled') profiles`,
      [first.tenantId, clientKey],
    );
    expect(active.rows[0]).toEqual({ identities: 0, bindings: 0, accounts: 0, profiles: 0 });
  }, 120_000);

  it("preserves safe routing metadata from pre-Phase-1 integration config", async () => {
    const suffix = randomUUID().slice(0, 8);
    const clientKey = `legacy-access-${suffix}`;
    const ownerEmail = `${clientKey}@example.test`;
    const auth = fakeAuth();
    const legacy = parseClientManifest({
      clientKey,
      tenant: { name: "Legacy Access Upgrade", timezone: "America/Phoenix" },
      users: [{ email: ownerEmail, role: "owner", displayName: "Legacy Owner" }],
      requiredCapabilities: ["communications", "accounting", "marketing"],
      integrations: [
        { capability: "communications", binding: "vapi", mode: "real", config: { phoneNumberId: "legacy-config-phone" } },
        { capability: "accounting", binding: "quickbooks", mode: "real", config: { realmId: "legacy-config-realm" } },
        { capability: "marketing", binding: "ads", mode: "real", config: { adapter: "meta_ads", accountId: "legacy-config-ad-account" } },
      ],
    });

    const provisioned = await provisionClient(legacy, { auth });
    expect(provisioned.identityAccess).toMatchObject({
      communicationIdentities: 1,
      applicationAccounts: 3,
      authProfiles: 3,
      compatibilityMode: true,
    });
    const canonical = await getPool().query(
      `SELECT
         (SELECT provider_identity_ref FROM finnor_os.communication_identities
          WHERE tenant_id=$1 AND identity_key='legacy-communications-vapi') phone_ref,
         (SELECT provider_account_ref FROM finnor_os.application_accounts
          WHERE tenant_id=$1 AND account_key='legacy-accounting-quickbooks') realm_ref,
         (SELECT provider FROM finnor_os.application_accounts
          WHERE tenant_id=$1 AND account_key='legacy-marketing-ads') ads_provider,
         (SELECT provider_account_ref FROM finnor_os.application_accounts
          WHERE tenant_id=$1 AND account_key='legacy-marketing-ads') ads_account_ref,
         (SELECT id FROM finnor_os.users WHERE tenant_id=$1 AND email=$2) owner_id`,
      [provisioned.tenantId, ownerEmail],
    );
    expect(canonical.rows[0]).toMatchObject({
      phone_ref: "legacy-config-phone",
      realm_ref: "legacy-config-realm",
      ads_provider: "meta_ads",
      ads_account_ref: "legacy-config-ad-account",
    });

    vi.stubEnv("FINNOR_LEGACY_CREDENTIAL_TENANT_IDS", provisioned.tenantId);
    vi.stubEnv("VAPI_API_KEY", "legacy-vapi-key");
    vi.stubEnv("VAPI_PHONE_NUMBER_ID", "process-default-phone");
    vi.stubEnv("VAPI_ASSISTANT_ID", "legacy-assistant");
    vi.stubEnv("QUICKBOOKS_CLIENT_ID", "legacy-qbo-client");
    vi.stubEnv("QUICKBOOKS_CLIENT_SECRET", "legacy-qbo-secret");
    vi.stubEnv("QUICKBOOKS_REFRESH_TOKEN", "legacy-qbo-refresh");
    vi.stubEnv("QUICKBOOKS_REALM_ID", "process-default-realm");
    try {
      const voice = await resolveCredentialContext(
        provisioned.tenantId,
        canonical.rows[0].owner_id,
        "vapi",
        "default",
        { channel: "voice" },
      );
      const accounting = await resolveCredentialContext(
        provisioned.tenantId,
        canonical.rows[0].owner_id,
        "quickbooks",
        "default",
        { application: "quickbooks" },
      );
      expect(voice.credentials.phoneNumberId).toBe("legacy-config-phone");
      expect(accounting.credentials.realmId).toBe("legacy-config-realm");
    } finally {
      vi.unstubAllEnvs();
    }
  }, 120_000);
});
