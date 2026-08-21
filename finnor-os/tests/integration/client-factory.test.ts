import { randomUUID } from "node:crypto";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { closePool, getPool } from "@finnor/db";
import { migrate } from "../../packages/db/migrate";
import { parseClientManifest, type ClientManifest } from "../../scripts/client-manifest";
import {
  inspectClientFactory,
  resumeClientFactory,
  runClientFactory,
  startClientFactory,
  type ImportSourceResolver,
} from "../../scripts/client-factory";
import type { TenantAuthAdmin } from "../../scripts/tenant-user";

const DB_URL = process.env.DATABASE_URL ?? "postgres://finnor:finnor@localhost:5432/finnor";
async function dbUp() {
  const client = new pg.Client({ connectionString: DB_URL, connectionTimeoutMillis: 2_000 });
  try { await client.connect(); await client.end(); return true; } catch { return false; }
}
const available = await dbUp();

function fakeAuth() {
  const users = new Map<string, { id: string; email: string }>();
  const passwords: string[] = [];
  const listUsers = vi.fn(async ({ page = 1, perPage = 200 }: { page?: number; perPage?: number } = {}) => {
    const all = [...users.values()];
    const start = (page - 1) * perPage;
    return { data: { users: all.slice(start, start + perPage), nextPage: null }, error: null };
  });
  const createUser = vi.fn(async ({ email, password }: { email: string; password: string }) => {
    passwords.push(password);
    const user = { id: randomUUID(), email: email.toLowerCase() };
    users.set(user.email, user);
    return { data: { user }, error: null };
  });
  const updateUserById = vi.fn(async () => ({ data: { user: {} }, error: null }));
  return { users, passwords, auth: { listUsers, createUser, updateUserById } as unknown as TenantAuthAdmin };
}

const customerDefinition = {
  version: 1,
  entity: "customer" as const,
  sourceSystem: "factory-crm",
  fields: {
    firstName: { from: "first", required: true, normalize: ["trim", "title_case"] as const },
    lastName: { from: "last", normalize: ["trim", "title_case"] as const },
    email: { from: "email", normalize: ["trim", "lowercase"] as const },
  },
  externalId: { from: "id", required: true },
  identity: [{ fields: ["email"] }],
  updateMode: "source_owned" as const,
};

function factoryManifest(key: string, email: string, overrides: Record<string, unknown> = {}): ClientManifest {
  return parseClientManifest({
    clientKey: key,
    tenant: { name: "Factory Water", timezone: "America/Chicago" },
    users: [{ email, role: "owner" }],
    locations: [{ key: "main-office", name: "Main Office" }],
    requiredCapabilities: ["crm", "communications"],
    policyOverrides: { create_review_request: { policy: { review_link_url: "https://example.test/review" } } },
    imports: [{ key: "customers", source: "csv", sourceRef: "memory://customers", definition: customerDefinition }],
    ...overrides,
  });
}

function memoryResolver(sources: Map<string, string>): ImportSourceResolver {
  return async ({ sourceRef }) => {
    const content = sources.get(sourceRef);
    if (content === undefined) {
      const error = new Error(`missing ${sourceRef}`) as NodeJS.ErrnoException;
      error.code = "ENOENT";
      throw error;
    }
    return { name: sourceRef, content };
  };
}

describe.skipIf(!available).sequential("Phase 4 durable client factory", () => {
  beforeAll(async () => {
    process.env.DATABASE_URL = DB_URL;
    await migrate(DB_URL);
  });
  afterAll(() => closePool());

  it("completes onboarding, reuses unchanged checkpoints, and never duplicates tenant/user/import state", async () => {
    const suffix = randomUUID().slice(0, 8);
    const manifest = factoryManifest(`factory-ok-${suffix}`, `factory-ok-${suffix}@example.test`);
    const auth = fakeAuth();
    const sources = new Map([["memory://customers", "id,first,last,email\nC-1,Ada,Lovelace,ada@example.test\n"]]);
    const first = await startClientFactory(manifest, { enqueue: false });
    expect((await runClientFactory(first.run.id, { auth: auth.auth, resolveImportSource: memoryResolver(sources) })).status).toBe("passed");

    const second = await startClientFactory(manifest, { enqueue: false });
    expect(second.run.id).not.toBe(first.run.id);
    expect((await runClientFactory(second.run.id, { auth: auth.auth, resolveImportSource: memoryResolver(sources) })).status).toBe("passed");
    const status = await inspectClientFactory({ runId: second.run.id });
    expect(status!.stages.every((stage) => stage.status === "passed" && stage.attempts === 0)).toBe(true);

    const counts = await getPool().query(
      `SELECT
        (SELECT count(*)::int FROM finnor_os.tenants WHERE client_key=$1) tenants,
        (SELECT count(*)::int FROM finnor_os.users WHERE tenant_id=$2) users,
        (SELECT count(*)::int FROM finnor_os.households WHERE tenant_id=$2) households,
        (SELECT count(*)::int FROM finnor_os.import_entity_refs WHERE tenant_id=$2) refs`,
      [manifest.clientKey, first.run.tenantId ?? (await inspectClientFactory({ runId: first.run.id }))!.tenantId],
    );
    expect(counts.rows[0]).toEqual({ tenants: 1, users: 1, households: 1, refs: 1 });
    expect(auth.passwords).toHaveLength(1);
  }, 120_000);

  it("recovers an expired lease after a crash between durable stage checkpoints", async () => {
    const suffix = randomUUID().slice(0, 8);
    const manifest = factoryManifest(`factory-crash-${suffix}`, `factory-crash-${suffix}@example.test`);
    const auth = fakeAuth();
    const sources = new Map([["memory://customers", "id,first,last,email\nC-1,Grace,Hopper,grace@example.test\n"]]);
    const started = await startClientFactory(manifest, { enqueue: false });
    await expect(runClientFactory(started.run.id, {
      auth: auth.auth,
      resolveImportSource: memoryResolver(sources),
      afterStage: (stage) => { if (stage === "tenant") throw new Error("simulated process crash"); },
    })).rejects.toThrow("simulated process crash");
    await getPool().query("UPDATE finnor_os.client_factory_runs SET lease_expires_at=now()-interval '1 second' WHERE id=$1", [started.run.id]);
    expect((await runClientFactory(started.run.id, { auth: auth.auth, resolveImportSource: memoryResolver(sources) })).status).toBe("passed");
    const status = await inspectClientFactory({ runId: started.run.id });
    expect(status!.stages.find((stage) => stage.key === "tenant")!.attempts).toBe(1);
    expect(status!.stages.find((stage) => stage.key === "identity")!.attempts).toBe(1);
    const abandoned = await getPool().query(
      "SELECT count(*)::int count FROM finnor_os.client_factory_stage_attempts WHERE run_id=$1 AND status='running'",
      [started.run.id],
    );
    expect(abandoned.rows[0].count).toBe(0);
  }, 120_000);

  it("moves BLOCKED-CONFIG to passed after a credential reference is configured and resumed", async () => {
    const suffix = randomUUID().slice(0, 8);
    const key = `factory-block-${suffix}`;
    const email = `factory-block-${suffix}@example.test`;
    const auth = fakeAuth();
    const sources = new Map([["memory://customers", "id,first,last,email\nC-1,Katherine,Johnson,katherine@example.test\n"]]);
    const blockedManifest = factoryManifest(key, email, {
      integrations: [
        { capability: "crm", binding: "native", mode: "real" },
        { capability: "communications", binding: "vapi", mode: "sandbox" },
      ],
    });
    const started = await startClientFactory(blockedManifest, { enqueue: false });
    expect((await runClientFactory(started.run.id, { auth: auth.auth, resolveImportSource: memoryResolver(sources) })).status).toBe("blocked_config");

    const configured = parseClientManifest({
      ...blockedManifest,
      integrations: blockedManifest.integrations.map((integration) => integration.capability === "communications"
        ? { ...integration, credential: { provider: "aws-secrets-manager", ref: "finnor/tenants/{tenantId}/vapi" } }
        : integration),
    });
    const resumedRun = await resumeClientFactory(started.run.id, { enqueue: false, manifest: configured });
    expect(resumedRun.id).toBe(started.run.id);
    expect((await runClientFactory(resumedRun.id, { auth: auth.auth, resolveImportSource: memoryResolver(sources) })).status).toBe("passed");
    const status = await inspectClientFactory({ runId: resumedRun.id });
    expect(status!.stages.find((stage) => stage.key === "tenant")!.attempts).toBe(1);
    expect(status!.stages.find((stage) => stage.key === "integrations_credentials")!.attempts).toBe(2);
  }, 120_000);

  it("keeps import failure visible, then converges after the source is fixed", async () => {
    const suffix = randomUUID().slice(0, 8);
    const manifest = factoryManifest(`factory-import-${suffix}`, `factory-import-${suffix}@example.test`);
    const auth = fakeAuth();
    const sources = new Map([["memory://customers", "id,first,last,email\nC-1,Alan,Turing,not-an-email\n"]]);
    const started = await startClientFactory(manifest, { enqueue: false });
    await expect(runClientFactory(started.run.id, { auth: auth.auth, resolveImportSource: memoryResolver(sources) })).rejects.toThrow(/quarantined/);
    expect((await inspectClientFactory({ runId: started.run.id }))!.status).toBe("failed");

    sources.set("memory://customers", "id,first,last,email\nC-1,Alan,Turing,alan@example.test\n");
    await startClientFactory(manifest, { enqueue: false });
    expect((await runClientFactory(started.run.id, { auth: auth.auth, resolveImportSource: memoryResolver(sources) })).status).toBe("passed");
    const status = await inspectClientFactory({ runId: started.run.id });
    expect(status!.stages.find((stage) => stage.key === "import")!.attempts).toBe(2);
    const rows = await getPool().query("SELECT count(*)::int count FROM finnor_os.households WHERE tenant_id=$1", [status!.tenantId]);
    expect(rows.rows[0].count).toBe(1);
  }, 120_000);

  it("serializes same-client starts and invalidates only changed configuration stages", async () => {
    const suffix = randomUUID().slice(0, 8);
    const manifest = factoryManifest(`factory-hash-${suffix}`, `factory-hash-${suffix}@example.test`);
    const auth = fakeAuth();
    const sources = new Map([["memory://customers", "id,first,last,email\nC-1,Dorothy,Vaughan,dorothy@example.test\n"]]);
    const [a, b] = await Promise.all([
      startClientFactory(manifest, { enqueue: false }),
      startClientFactory(manifest, { enqueue: false }),
    ]);
    expect(a.run.id).toBe(b.run.id);
    await runClientFactory(a.run.id, { auth: auth.auth, resolveImportSource: memoryResolver(sources) });

    const changed = parseClientManifest({ ...manifest, workspaceConfig: {
      enabledSurfaces: ["home", "work", "customers"],
      terminology: { home: "HQ", work: "Cases", customers: "Accounts", schedule: "Schedule", money: "Money", agents: "Agents" },
      voiceEnabled: false,
      navigationPriority: ["home", "work", "customers", "schedule", "money", "agents"],
      brand: { accent: "teal", radius: "precise", mark: "FW" },
      visibility: { policy: true, authority: true },
    } });
    const next = await startClientFactory(changed, { enqueue: false });
    await runClientFactory(next.run.id, { auth: auth.auth, resolveImportSource: memoryResolver(sources) });
    const status = await inspectClientFactory({ runId: next.run.id });
    const attempted = status!.stages.filter((stage) => stage.attempts > 0).map((stage) => stage.key);
    expect(attempted).toEqual(["validate", "workspace_policies", "tenant_health", "ready_for_certification"]);
  }, 120_000);

  it("replays only the import whose mapping changed", async () => {
    const suffix = randomUUID().slice(0, 8);
    const base = factoryManifest(`factory-import-target-${suffix}`, `factory-import-target-${suffix}@example.test`, {
      imports: [
        { key: "customers-east", source: "csv", sourceRef: "memory://customers-east", definition: customerDefinition },
        { key: "customers-west", source: "csv", sourceRef: "memory://customers-west", definition: customerDefinition },
      ],
    });
    const auth = fakeAuth();
    const sources = new Map([
      ["memory://customers-east", "id,first,last,email\nE-1,East,Customer,east@example.test\n"],
      ["memory://customers-west", "id,first,last,email\nW-1,West,Customer,west@example.test\n"],
    ]);
    const first = await startClientFactory(base, { enqueue: false });
    await runClientFactory(first.run.id, { auth: auth.auth, resolveImportSource: memoryResolver(sources) });

    const changed = parseClientManifest({
      ...base,
      imports: base.imports.map((item) => item.key === "customers-east"
        ? { ...item, definition: { ...item.definition, fields: { ...item.definition.fields, lastName: { from: "last", normalize: ["trim"] } } } }
        : item),
    });
    const next = await startClientFactory(changed, { enqueue: false });
    await runClientFactory(next.run.id, { auth: auth.auth, resolveImportSource: memoryResolver(sources) });
    const status = await inspectClientFactory({ runId: next.run.id });
    const evidence = status!.stages.find((stage) => stage.key === "import")!.evidence as {
      executedImportKeys: string[]; reusedImportKeys: string[];
    };
    expect(evidence.executedImportKeys).toEqual(["customers-east"]);
    expect(evidence.reusedImportKeys).toEqual(["customers-west"]);
  }, 120_000);

  it("persists no generated password/source secret and preserves the cross-tenant user boundary", async () => {
    const suffix = randomUUID().slice(0, 8);
    const sharedEmail = `factory-boundary-${suffix}@example.test`;
    const auth = fakeAuth();
    const sourceSecret = `customer-secret-${randomUUID()}`;
    const sources = new Map([["memory://customers", `id,first,last,email,notes\nC-1,Mae,Jemison,mae@example.test,${sourceSecret}\n`]]);
    const first = factoryManifest(`factory-boundary-a-${suffix}`, sharedEmail);
    const firstRun = await startClientFactory(first, { enqueue: false });
    await runClientFactory(firstRun.run.id, { auth: auth.auth, resolveImportSource: memoryResolver(sources) });

    const second = factoryManifest(`factory-boundary-b-${suffix}`, sharedEmail);
    const secondRun = await startClientFactory(second, { enqueue: false });
    await expect(runClientFactory(secondRun.run.id, { auth: auth.auth, resolveImportSource: memoryResolver(sources) })).rejects.toThrow(/belongs to tenant/);
    const tenantB = await getPool().query("SELECT id FROM finnor_os.tenants WHERE client_key=$1", [second.clientKey]);
    expect(tenantB.rowCount).toBe(0);

    const durable = await getPool().query<{ state: string }>(
      `SELECT concat_ws(' ', r.manifest_snapshot::text, r.last_error,
         string_agg(s.evidence::text || ' ' || coalesce(s.last_error,''), ' '),
         string_agg(a.evidence::text || ' ' || coalesce(a.error,''), ' ')) state
       FROM finnor_os.client_factory_runs r
       LEFT JOIN finnor_os.client_factory_stages s ON s.run_id=r.id
       LEFT JOIN finnor_os.client_factory_stage_attempts a ON a.run_id=r.id
       WHERE r.id=$1 GROUP BY r.id`,
      [firstRun.run.id],
    );
    expect(durable.rows[0]!.state).not.toContain(auth.passwords[0]!);
    expect(durable.rows[0]!.state).not.toContain(sourceSecret);
  }, 120_000);
});
