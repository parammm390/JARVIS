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
import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { getPool, closePool } from "@finnor/db";

// The one real tenant in production today (matches packages/db/seed.ts SEED_TENANT_ID).
// Dealer Zero (Phase 3) will add a second; until then this is the correct default.
const DEFAULT_TENANT_ID = "00000000-0000-4000-8000-000000000001";
const VALID_ROLES = ["owner", "dispatcher", "technician"] as const;
type Role = (typeof VALID_ROLES)[number];

function parseArgs(): { email: string; role: Role; tenantId: string; resetPassword: boolean } {
  const args = Object.fromEntries(
    process.argv.slice(2).map((a) => {
      const [k, ...rest] = a.replace(/^--/, "").split("=");
      return [k, rest.join("=")];
    }),
  );
  const email = args.email;
  if (!email || !email.includes("@")) throw new Error("Usage: --email=you@example.com [--role=owner] [--tenant=<uuid>] [--reset-password]");
  const role = (args.role ?? "owner") as Role;
  if (!VALID_ROLES.includes(role)) throw new Error(`--role must be one of ${VALID_ROLES.join(", ")}`);
  const tenantId = args.tenant ?? DEFAULT_TENANT_ID;
  const resetPassword = "reset-password" in args;
  return { email, role, tenantId, resetPassword };
}

/** GoTrue's admin API has no getUserByEmail — page through and match client-side.
 *  Fine at this scale (a handful of accounts); would need real pagination past that. */
async function findAuthUserByEmail(supabase: SupabaseClient, email: string): Promise<{ id: string } | null> {
  const { data, error } = await supabase.auth.admin.listUsers({ page: 1, perPage: 200 });
  if (error) throw new Error(`listUsers failed: ${error.message}`);
  const match = data.users.find((u) => u.email?.toLowerCase() === email.toLowerCase());
  return match ? { id: match.id } : null;
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
  const { email, role, tenantId, resetPassword } = parseArgs();

  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY must be set");
  const supabase = createClient(url, key, { auth: { persistSession: false } });

  let passwordToReport: string | null = null;

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
    if (resetPassword) {
      const existing = await findAuthUserByEmail(supabase, email);
      if (!existing) throw new Error(`createUser said "${email}" already exists, but listUsers can't find it — investigate before retrying.`);
      const { error: updateErr } = await supabase.auth.admin.updateUserById(existing.id, { password });
      if (updateErr) throw new Error(`updateUserById failed: ${updateErr.message}`);
      passwordToReport = password;
      console.log(`Supabase auth user for ${email} already existed — password reset as requested.`);
    } else {
      console.log(`Supabase auth user for ${email} already exists — leaving its password unchanged (pass --reset-password to change it).`);
    }
  } else {
    passwordToReport = password;
  }

  const row = await upsertAppUserRow(email, tenantId, role);
  await closePool();

  console.log(`finnor_os.users row ready: id=${row.id} email=${email} tenant=${tenantId} role=${role}`);
  if (passwordToReport) {
    console.log("");
    console.log("=== LOGIN PASSWORD — shown once, not stored anywhere ===");
    console.log(`  email:    ${email}`);
    console.log(`  password: ${passwordToReport}`);
    console.log("Log in, then change this password from the account settings.");
    console.log("==========================================================");
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
