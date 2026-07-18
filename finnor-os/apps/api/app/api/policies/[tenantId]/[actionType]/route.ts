// GET/PUT /api/policies/:tenantId/:actionType (§8). The tenantId path segment must
// match the caller's own tenant — cross-tenant policy access is a hard 403 before
// RLS would return empty anyway (defense in depth).

import { withTenant, domainPolicies } from "@finnor/db";
import { UpsertPolicySchema } from "@finnor/policy-schema";
import { and, eq } from "drizzle-orm";
import { requireContext, errorResponse } from "../../../../../lib/auth";

type Params = { params: { tenantId: string; actionType: string } };

export async function GET(req: Request, { params }: Params): Promise<Response> {
  try {
    const ctx = await requireContext(req);
    if (ctx.tenantId !== params.tenantId) {
      return Response.json({ error: "Forbidden" }, { status: 403 });
    }
    const rows = await withTenant(ctx.tenantId, (db) =>
      db
        .select()
        .from(domainPolicies)
        .where(and(eq(domainPolicies.tenantId, ctx.tenantId), eq(domainPolicies.actionType, params.actionType))),
    );
    if (rows.length === 0) return Response.json({ error: "No policy configured" }, { status: 404 });
    return Response.json({ policy: rows[0] });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function PUT(req: Request, { params }: Params): Promise<Response> {
  try {
    const ctx = await requireContext(req);
    if (ctx.tenantId !== params.tenantId) {
      return Response.json({ error: "Forbidden" }, { status: 403 });
    }
    if (ctx.role !== "owner") {
      return Response.json({ error: "Only owners can edit policies" }, { status: 403 });
    }
    const body = UpsertPolicySchema.safeParse(await req.json().catch(() => null));
    if (!body.success) {
      return Response.json(
        { error: body.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") },
        { status: 400 },
      );
    }
    const row = await withTenant(ctx.tenantId, async (db) => {
      const [existing] = await db
        .select()
        .from(domainPolicies)
        .where(and(eq(domainPolicies.tenantId, ctx.tenantId), eq(domainPolicies.actionType, params.actionType)));
      if (existing) {
        const [updated] = await db
          .update(domainPolicies)
          .set({
            policy: body.data.policy,
            requiresConfirmation: body.data.requiresConfirmation,
            confirmationTemplate: body.data.confirmationTemplate ?? null,
            modelProvider: body.data.modelProvider ?? null,
            confirmationTimeoutHours: body.data.confirmationTimeoutHours ?? null,
            // §3.1: a real edit is a real new version — never caller-supplied (a
            // client can't be trusted to increment its own audit trail), always +1
            // from whatever's actually stored, regardless of what body.data.version says.
            version: existing.version + 1,
          })
          .where(eq(domainPolicies.id, existing.id))
          .returning();
        return updated!;
      }
      const [created] = await db
        .insert(domainPolicies)
        .values({
          tenantId: ctx.tenantId,
          actionType: params.actionType,
          policy: body.data.policy,
          requiresConfirmation: body.data.requiresConfirmation,
          confirmationTemplate: body.data.confirmationTemplate ?? null,
          modelProvider: body.data.modelProvider ?? null,
          confirmationTimeoutHours: body.data.confirmationTimeoutHours ?? null,
          // version omitted — column default (1) applies to a genuinely first-ever row.
        })
        .returning();
      return created!;
    });
    return Response.json({ policy: row });
  } catch (err) {
    return errorResponse(err);
  }
}
