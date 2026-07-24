// A5.T2 live-principal provisioning. This intentionally creates two real, isolated
// internal security-test tenants and one non-customer marker household for a
// meaningful tenant-isolation check. It never prints passwords or JWTs; callers
// provide a mode-0600 credential output path for the subsequent probe.
//
// Usage:
// npx tsx scripts/provision-a5-live-isolation-probes.ts \
//   --production-env=/secure/production.env --staging-env=/secure/preview.env \
//   --email-a=pdave9807@gmail.com --email-b=pdave1302@gmail.com \
//   --credentials-output=/secure/a5-probe-credentials.json

import { randomBytes, randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { chmod, readFile, writeFile } from "node:fs/promises";
import { GetSecretValueCommand, SecretsManagerClient } from "@aws-sdk/client-secrets-manager";
import { Pool } from "pg";

type Environment = Record<string, string>;
type RolePosture = { currentUser: string; bypassRls: boolean };

function parseArgs(): Record<string, string> {
  return Object.fromEntries(
    process.argv.slice(2).map((argument) => {
      const [key, ...value] = argument.replace(/^--/, "").split("=");
      return [key, value.join("=")];
    }),
  );
}

function parseEnv(contents: string): Environment {
  const values: Environment = {};
  for (const line of contents.split(/\r?\n/)) {
    const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match) continue;
    const key = match[1]!;
    const rawValue = match[2]!;
    values[key] = rawValue.replace(/^['"]|['"]$/g, "");
  }
  return values;
}

function randomPassword(): string {
  return randomBytes(32).toString("base64url");
}

/** Resolve managed values in memory only, using the exact mapping the production
 * API uses. Returned values are never logged or written to the credential file. */
async function resolveManagedEnvironment(environment: Environment): Promise<Environment> {
  if (environment.SECRETS_PROVIDER !== "aws-secrets-manager") return environment;
  let mappings: Record<string, string>;
  try {
    mappings = JSON.parse(environment.FINNOR_SECRET_IDS ?? "{}") as Record<string, string>;
  } catch {
    throw new Error("FINNOR_SECRET_IDS is not valid JSON");
  }
  if (!environment.AWS_ACCESS_KEY_ID || !environment.AWS_SECRET_ACCESS_KEY) {
    throw new Error("managed-secret environment is missing AWS credentials");
  }
  const client = new SecretsManagerClient({
    region: environment.AWS_REGION ?? environment.AWS_BEDROCK_REGION ?? "us-east-1",
    credentials: { accessKeyId: environment.AWS_ACCESS_KEY_ID, secretAccessKey: environment.AWS_SECRET_ACCESS_KEY },
  });
  const resolved = { ...environment };
  for (const [envName, secretId] of Object.entries(mappings)) {
    const response = await client.send(new GetSecretValueCommand({ SecretId: secretId }));
    const raw = response.SecretString ?? (response.SecretBinary ? Buffer.from(response.SecretBinary as Uint8Array).toString("utf8") : "");
    if (!raw) throw new Error(`managed secret for ${envName} had no value`);
    let value = raw;
    try {
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      if (typeof parsed[envName] === "string") value = parsed[envName];
    } catch {
      // A single-value secret is an allowed Secrets Manager shape.
    }
    resolved[envName] = value;
  }
  return resolved;
}

type AuthAdmin = { baseUrl: string; serviceKey: string };

async function authRequest(auth: AuthAdmin, path: string, init: RequestInit = {}): Promise<Response> {
  return fetch(new URL(path, auth.baseUrl), {
    ...init,
    headers: {
      apikey: auth.serviceKey,
      authorization: `Bearer ${auth.serviceKey}`,
      "content-type": "application/json",
      ...init.headers,
    },
  });
}

async function findAuthUserByEmail(auth: AuthAdmin, email: string): Promise<{ id: string } | null> {
  for (let page = 1; page <= 10; page += 1) {
    const response = await authRequest(auth, `/auth/v1/admin/users?page=${page}&per_page=200`);
    if (!response.ok) throw new Error(`Supabase listUsers failed: HTTP ${response.status}`);
    const body = (await response.json()) as { users?: Array<{ id: string; email?: string }> };
    const users = body.users ?? [];
    const match = users.find((user) => user.email?.toLowerCase() === email.toLowerCase());
    if (match) return { id: match.id };
    if (users.length < 200) break;
  }
  return null;
}

async function ensureAuthPrincipal(auth: AuthAdmin, email: string): Promise<{ jwt: string; wasReset: boolean }> {
  const password = randomPassword();
  const existing = await findAuthUserByEmail(auth, email);
  let wasReset = false;

  if (existing) {
    const response = await authRequest(auth, `/auth/v1/admin/users/${existing.id}`, {
      method: "PUT",
      body: JSON.stringify({ password, email_confirm: true }),
    });
    if (!response.ok) throw new Error(`Supabase password reset failed for ${email}: HTTP ${response.status}`);
    wasReset = true;
  } else {
    const response = await authRequest(auth, "/auth/v1/admin/users", {
      method: "POST",
      body: JSON.stringify({
        email,
        password,
        email_confirm: true,
        user_metadata: { role: "owner", purpose: "a5_internal_tenant_isolation" },
      }),
    });
    if (!response.ok) throw new Error(`Supabase auth user creation failed for ${email}: HTTP ${response.status}`);
  }

  const response = await authRequest(auth, "/auth/v1/token?grant_type=password", {
    method: "POST",
    body: JSON.stringify({ email, password }),
  });
  const body = (await response.json()) as { access_token?: string; msg?: string; message?: string };
  if (!response.ok || !body.access_token) throw new Error(`Supabase password sign-in failed for ${email}: ${body.msg ?? body.message ?? `HTTP ${response.status}`}`);
  return { jwt: body.access_token, wasReset };
}

async function provisionDatabase(
  databaseUrl: string,
  tenantAId: string,
  tenantBId: string,
  emailA: string,
  emailB: string,
  allowPrivilegedSeed = false,
): Promise<{ posture: RolePosture; markerHouseholdId: string }> {
  const pool = new Pool({ connectionString: databaseUrl, max: 1 });
  const client = await pool.connect();
  try {
    await client.query("SET search_path = finnor_os, public");
    const postureResult = await client.query<{ current_user: string; rolbypassrls: boolean }>(
      "SELECT current_user, rolbypassrls FROM pg_roles WHERE rolname = current_user",
    );
    const posture = {
      currentUser: postureResult.rows[0]?.current_user ?? "unknown",
      bypassRls: postureResult.rows[0]?.rolbypassrls ?? true,
    };
    if (posture.bypassRls && !allowPrivilegedSeed) throw new Error(`A5 provisioning refused: database role ${posture.currentUser} bypasses RLS`);

    const provisionTenant = async (tenantId: string, email: string, name: string): Promise<void> => {
      await client.query("BEGIN");
      try {
        await client.query("SELECT set_config('app.tenant_id', $1, true)", [tenantId]);
        await client.query(
          "INSERT INTO tenants (id, name) VALUES ($1, $2) ON CONFLICT (id) DO NOTHING",
          [tenantId, name],
        );
        await client.query(
          `INSERT INTO users (tenant_id, email, role)
           VALUES ($1, $2, 'owner')
           ON CONFLICT (email) DO UPDATE SET tenant_id = EXCLUDED.tenant_id, role = EXCLUDED.role`,
          [tenantId, email],
        );
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      }
    };

    await provisionTenant(tenantAId, emailA, "A5 Internal Security Tenant A");
    await provisionTenant(tenantBId, emailB, "A5 Internal Security Tenant B");

    await client.query("BEGIN");
    try {
      await client.query("SELECT set_config('app.tenant_id', $1, true)", [tenantAId]);
      const existing = await client.query<{ id: string }>(
        "SELECT id FROM households WHERE address = $1 LIMIT 1",
        ["A5 internal isolation marker — not a customer address"],
      );
      let markerHouseholdId = existing.rows[0]?.id;
      if (!markerHouseholdId) {
        const inserted = await client.query<{ id: string }>(
          `INSERT INTO households (tenant_id, address, contact_info, water_profile, marketing_consent)
           VALUES ($1, $2, $3::jsonb, '{}'::jsonb, false) RETURNING id`,
          [
            tenantAId,
            "A5 internal isolation marker — not a customer address",
            JSON.stringify({ purpose: "A5 tenant-isolation proof; internal test record only" }),
          ],
        );
        markerHouseholdId = inserted.rows[0]?.id;
      }
      if (!markerHouseholdId) throw new Error("A5 marker household creation returned no ID");
      await client.query("COMMIT");
      return { posture, markerHouseholdId };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    }
  } finally {
    client.release();
    await pool.end();
  }
}

async function main(): Promise<void> {
  const args = parseArgs();
  const required = ["production-env", "staging-env", "email-a", "email-b", "credentials-output"];
  for (const key of required) if (!args[key]) throw new Error(`Missing --${key}`);
  const productionEnvPath = args["production-env"]!;
  const stagingEnvPath = args["staging-env"]!;
  const emailA = args["email-a"]!;
  const emailB = args["email-b"]!;
  const credentialsOutput = args["credentials-output"]!;
  if (existsSync(credentialsOutput)) throw new Error("Refusing to overwrite credentials output; choose a new mode-0600 path");

  const [productionFileEnv, stagingEnv] = await Promise.all([
    readFile(productionEnvPath, "utf8").then(parseEnv),
    readFile(stagingEnvPath, "utf8").then(parseEnv),
  ]);
  const productionEnv = await resolveManagedEnvironment(productionFileEnv);
  for (const [name, environment] of Object.entries({ productionEnv, stagingEnv })) {
    for (const key of ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "DATABASE_URL"]) {
      if (!environment[key]) throw new Error(`${name} is missing ${key}`);
    }
  }
  if (productionEnv.SUPABASE_URL !== stagingEnv.SUPABASE_URL) throw new Error("Production and staging do not share Supabase Auth; provision separate principals intentionally");

  // Auth administration uses the verified direct Vercel service key. Managed
  // overrides are intentionally used below for runtime secrets such as DATABASE_URL,
  // but an incorrectly mapped Auth key must not block or silently change principal
  // provisioning.
  const auth: AuthAdmin = { baseUrl: productionFileEnv.SUPABASE_URL!, serviceKey: productionFileEnv.SUPABASE_SERVICE_ROLE_KEY! };
  const tenantAId = randomUUID();
  const tenantBId = randomUUID();
  const [principalA, principalB] = await Promise.all([
    ensureAuthPrincipal(auth, emailA),
    ensureAuthPrincipal(auth, emailB),
  ]);
  const [production, staging] = await Promise.all([
    provisionDatabase(productionEnv.DATABASE_URL!, tenantAId, tenantBId, emailA, emailB),
    // Preview currently exposes only its migration credential. This path seeds the
    // internal marker, but the subsequent live HTTP probe is the authority for
    // whether the deployed Preview API itself runs with RLS enforced.
    provisionDatabase(stagingEnv.DATABASE_URL!, tenantAId, tenantBId, emailA, emailB, true),
  ]);

  await writeFile(
    credentialsOutput,
    JSON.stringify(
      {
        tenantA: { email: emailA, id: tenantAId, jwt: principalA.jwt, markerHouseholdId: production.markerHouseholdId },
        tenantB: { email: emailB, id: tenantBId, jwt: principalB.jwt },
        // The marker IDs differ between databases because they are generated per database.
        stagingMarkerHouseholdId: staging.markerHouseholdId,
      },
      null,
      2,
    ),
    { mode: 0o600 },
  );
  await chmod(credentialsOutput, 0o600);

  console.log(
    JSON.stringify({
      provisioned: true,
      tenantAId,
      tenantBId,
      auth: { tenantAExistingCredentialReset: principalA.wasReset, tenantBExistingCredentialReset: principalB.wasReset },
      production: { databaseRole: production.posture, markerHouseholdCreated: Boolean(production.markerHouseholdId) },
      staging: { databaseRole: staging.posture, privilegedSeedOnly: staging.posture.bypassRls, markerHouseholdCreated: Boolean(staging.markerHouseholdId) },
      credentialsWritten: true,
    }),
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
