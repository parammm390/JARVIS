// GET/PUT /api/price-book/:tenantId — modeled on policies/[tenantId]/[actionType]/route.ts.
// Replaces the old PUT /api/policies/:tenantId/pricing_catalog flow for line-item pricing
// now that prices live in the real price_book_items table (Phase 1 canonical data
// platform), not a domain_policies JSONB blob — without this route, dealers would lose
// the only way they had to enter prices.

import { withTenant } from "@finnor/db";
import { upsertPriceBookItem, listPriceBookItems } from "@finnor/data-platform";
import { z } from "zod";
import { requireContext, errorResponse } from "../../../../lib/auth";

type Params = { params: { tenantId: string } };

const UpsertPriceBookItemSchema = z.object({
  sku: z.string().min(1),
  label: z.string().min(1),
  priceUsd: z.number().nonnegative(),
  unitOfMeasure: z.string().min(1).optional(),
});

export async function GET(req: Request, { params }: Params): Promise<Response> {
  try {
    const ctx = await requireContext(req);
    if (ctx.tenantId !== params.tenantId) {
      return Response.json({ error: "Forbidden" }, { status: 403 });
    }
    const items = await withTenant(ctx.tenantId, (db) => listPriceBookItems(db, ctx.tenantId));
    return Response.json({ items });
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
      return Response.json({ error: "Only owners can edit the price book" }, { status: 403 });
    }
    const body = UpsertPriceBookItemSchema.safeParse(await req.json().catch(() => null));
    if (!body.success) {
      return Response.json(
        { error: body.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") },
        { status: 400 },
      );
    }
    const { itemId } = await withTenant(ctx.tenantId, (db) =>
      upsertPriceBookItem(db, { tenantId: ctx.tenantId, ...body.data }),
    );
    return Response.json({ itemId });
  } catch (err) {
    return errorResponse(err);
  }
}
