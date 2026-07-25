// GET/PUT /api/policies/:tenantId/:actionType (§8). The tenantId path segment must
// match the caller's own tenant — cross-tenant policy access is a hard 403 before
// RLS would return empty anyway (defense in depth).

import { withTenant, domainPolicies, domainPolicyRevisions } from "@finnor/db";
import { UpsertPolicySchema } from "@finnor/policy-schema";
import { and, eq } from "drizzle-orm";
import { requireContext, errorResponse } from "../../../../../lib/auth";

type Params = { params: Promise<{ tenantId: string; actionType: string }> };

export async function GET(req: Request, { params }: Params): Promise<Response> {
  try {
    const { tenantId, actionType } = await params;
    const ctx = await requireContext(req);
    if (ctx.tenantId !== tenantId) {
      return Response.json({ error: "Forbidden" }, { status: 403 });
    }
    const rows = await withTenant(ctx.tenantId, (db) =>
      db
        .select()
        .from(domainPolicies)
        .where(and(eq(domainPolicies.tenantId, ctx.tenantId), eq(domainPolicies.actionType, actionType))),
    );
    if (rows.length === 0) return Response.json({ error: "No policy configured" }, { status: 404 });
    return Response.json({ policy: rows[0] });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function PUT(req: Request, { params }: Params): Promise<Response> {
  try {
    const { tenantId, actionType } = await params;
    const ctx = await requireContext(req);
    if (ctx.tenantId !== tenantId) {
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
    const effectiveFrom = body.data.effectiveFrom ? new Date(body.data.effectiveFrom) : new Date();
    if (Number.isNaN(effectiveFrom.valueOf()) || effectiveFrom < new Date(Date.now() - 1_000)) {
      return Response.json({ error: "effectiveFrom must be now or in the future" }, { status: 400 });
    }
    const row = await withTenant(ctx.tenantId, async (db) => {
      const [existing] = await db
        .select()
        .from(domainPolicies)
        .where(and(eq(domainPolicies.tenantId, ctx.tenantId), eq(domainPolicies.actionType, actionType)));
      if (existing) {
        // A scheduled change must not replace the live row early. The revision is
        // selected by effective time at planning/execution; the mutable row remains
        // the current fast path until an immediate edit supersedes it.
        if (effectiveFrom > new Date()) {
          const version = existing.version + 1;
          const [scheduled] = await db.insert(domainPolicyRevisions).values({
            tenantId: ctx.tenantId, policyId: existing.id, actionType, version,
            policy: body.data.policy, requiresConfirmation: body.data.requiresConfirmation,
            confirmationTemplate: body.data.confirmationTemplate ?? null, modelProvider: body.data.modelProvider ?? null,
            confirmationTimeoutHours: body.data.confirmationTimeoutHours ?? null, effectiveFrom,
          }).returning();
          return scheduled!;
        }
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
            effectiveFrom,
          })
          .where(eq(domainPolicies.id, existing.id))
          .returning();
        await db.insert(domainPolicyRevisions).values({
          tenantId: ctx.tenantId, policyId: updated!.id, actionType, version: updated!.version,
          policy: updated!.policy, requiresConfirmation: updated!.requiresConfirmation,
          confirmationTemplate: updated!.confirmationTemplate, modelProvider: updated!.modelProvider,
          confirmationTimeoutHours: updated!.confirmationTimeoutHours, effectiveFrom,
        });
        return updated!;
      }
      const [created] = await db
        .insert(domainPolicies)
        .values({
          tenantId: ctx.tenantId,
          actionType,
          policy: body.data.policy,
          requiresConfirmation: body.data.requiresConfirmation,
          confirmationTemplate: body.data.confirmationTemplate ?? null,
          modelProvider: body.data.modelProvider ?? null,
          confirmationTimeoutHours: body.data.confirmationTimeoutHours ?? null,
          effectiveFrom,
          // version omitted — column default (1) applies to a genuinely first-ever row.
        })
        .returning();
      await db.insert(domainPolicyRevisions).values({
        tenantId: ctx.tenantId, policyId: created!.id, actionType, version: created!.version,
        policy: created!.policy, requiresConfirmation: created!.requiresConfirmation,
        confirmationTemplate: created!.confirmationTemplate, modelProvider: created!.modelProvider,
        confirmationTimeoutHours: created!.confirmationTimeoutHours, effectiveFrom,
      });
      return created!;
    });
    return Response.json({ policy: row });
  } catch (err) {
    return errorResponse(err);
  }
}
