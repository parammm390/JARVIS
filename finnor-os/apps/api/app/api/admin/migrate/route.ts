// POST /api/admin/migrate — runs migrations + seed server-side, where the database
// credentials live (Vercel-injected POSTGRES_URL). Guarded by ADMIN_SECRET; used
// exactly like a CI migrate step, never from application code paths.

import { migrate } from "@finnor/db/migrate";
import { MIGRATIONS } from "@finnor/db/migrations-bundle";
import { seed, SEED_TENANT_ID } from "@finnor/db/seed";

export const maxDuration = 60;

export async function POST(req: Request): Promise<Response> {
  const secret = process.env.ADMIN_SECRET;
  if (!secret || req.headers.get("x-admin-secret") !== secret) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }
  const url =
    process.env.DATABASE_URL ?? process.env.POSTGRES_URL_NON_POOLING ?? process.env.POSTGRES_URL;
  if (!url) return Response.json({ error: "No database configured" }, { status: 500 });
  try {
    const applied = await migrate(url, MIGRATIONS);
    await seed(url);
    return Response.json({ ok: true, applied, seededTenant: SEED_TENANT_ID });
  } catch (err) {
    console.error("[admin/migrate]", err);
    return Response.json({ error: (err as Error).message }, { status: 500 });
  }
}
