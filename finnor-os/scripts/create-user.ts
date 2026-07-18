// Phase 1.5: idempotent owner/staff user creation. Creates a real Supabase Auth user
// (email+password, the credential requireContext verifies) plus the matching
// finnor_os.users row (tenant_id + role) that resolveUserByEmail joins against —
// these are two independent records linked only by email, not by Supabase's own
// user id, so this script only ever needs the email to stay idempotent.
//
// Re-running is safe: an existing Supabase auth user is left untouched (no silent
// password reset); the users row is upserted by email so tenant/role can be updated.
//
// Usage: npx tsx scripts/create-user.ts --email=you@example.com --role=owner [--tenant=<uuid>]

import "dotenv/config";
import { randomBytes } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { getPool, closePool } from "@finnor/db";

// The one real tenant in production today (matches packages/db/seed.ts SEED_TENANT_ID).
// Dealer Zero (Phase 3) will add a second; until then this is the correct default.
const DEFAULT_TENANT_ID = "00000000-0000-4000-8000-000000000001";
const VALID_ROLES = ["owner", "dispatcher", "technician"] as const;
type Role = (typeof VALID_ROLES)[number];

function parseArgs(): { email: string; role: Role; tenantId: string } {
  const args = Object.fromEntries(
    process.argv.slice(2).map((a) => {
      const [k, ...rest] = a.replace(/^--/, "").split("=");
      return [k, rest.join("=")];
    }),
  );
  const email = args.email;
  if (!email || !email.includes("@")) throw new Error("Usage: --email=you@example.com [--role=owner] [--tenant=<uuid>]");
  const role = (args.role ?? "owner") as Role;
  if (!VALID_ROLES.includes(role)) throw new Error(`--role must be one of ${VALID_ROLES.join(", ")}`);
  const tenantId = args.tenant ?? DEFAULT_TENANT_ID;
  return { email, role, tenantId };
}

function generatePassword(): string {
  // 24 random bytes -> 32-char base64url, well above any reasonable entropy floor.
  return randomBytes(24).toString("base64url");
}

async function upsertAppUserRow(email: string, tenantId: string, role: Role): Promise<{ id: string }> {
  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query("SET search_path = finnor_os, public");
    await client.query("BEGIN");
    await client.query("SELECT set_config('app.tenant_id', $1, true)", [tenantId]);
    const { rows } = await client.query(
      `INSERT INTO users (tenant_id, email, role)
       VALUES ($1, $2, $3)
       ON CONFLICT (email) DO UPDATE SET tenant_id = EXCLUDED.tenant_id, role = EXCLUDED.role
       RETURNING id`,
      [tenantId, email, role],
    );
    await client.query("COMMIT");
    return rows[0];
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

async function main(): Promise<void> {
  const { email, role, tenantId } = parseArgs();

  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY must be set");
  const supabase = createClient(url, key, { auth: { persistSession: false } });

  let createdNewAuthUser = false;
  let generatedPassword: string | null = null;

  const password = generatePassword();
  const { error } = await supabase.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { role },
  });

  if (error) {
    const alreadyExists = /already.*registered|already.*exists/i.test(error.message);
    if (!alreadyExists) throw new Error(`Supabase admin.createUser failed: ${error.message}`);
    console.log(`Supabase auth user for ${email} already exists — leaving its password unchanged.`);
  } else {
    createdNewAuthUser = true;
    generatedPassword = password;
  }

  const row = await upsertAppUserRow(email, tenantId, role);
  await closePool();

  console.log(`finnor_os.users row ready: id=${row.id} email=${email} tenant=${tenantId} role=${role}`);
  if (createdNewAuthUser) {
    console.log("");
    console.log("=== NEW LOGIN CREATED — shown once, not stored anywhere ===");
    console.log(`  email:    ${email}`);
    console.log(`  password: ${generatedPassword}`);
    console.log("Log in, then change this password from the account settings.");
    console.log("============================================================");
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
