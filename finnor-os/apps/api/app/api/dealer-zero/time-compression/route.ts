// B4.T2: presentation timing for D8. It cannot run for a customer tenant: the
// DB-backed Dealer Zero flag is checked on every request, and every response says
// demo/synthetic explicitly. This route scripts a demo; it never changes business data.

import { buildTimeCompressedDemo, isDealerZeroScenarioPack } from "@finnor/shared-types";
import { decisionReceipts, tenantSettings, withTenant } from "@finnor/db";
import { desc, eq } from "drizzle-orm";
import { z } from "zod";
import { AuthError, errorResponse, requireContext } from "../../../../lib/auth";

const RequestSchema = z.object({
  dateSeed: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).default(() => new Date().toISOString().slice(0, 10)),
  scenario: z.enum(["normal_day", "brutal_summer", "payment_crunch", "equipment_recall", "chaos_day"]).default("normal_day"),
  multiplier: z.number().int().min(1).max(120).default(60),
});

export async function POST(req: Request): Promise<Response> {
  try {
    const ctx = await requireContext(req);
    if (ctx.role !== "owner") throw new AuthError("Dealer Zero demo access requires an owner", 403);
    const body = RequestSchema.safeParse(await req.json().catch(() => ({})));
    if (!body.success) return Response.json({ error: body.error.issues.map((issue) => issue.message).join("; ") }, { status: 400 });
    const [settings] = await withTenant(ctx.tenantId, (db) =>
      db.select({ isDealerZero: tenantSettings.isDealerZero }).from(tenantSettings).where(eq(tenantSettings.tenantId, ctx.tenantId)).limit(1),
    );
    if (!settings?.isDealerZero) throw new AuthError("Time-compression is available only for the labeled Dealer Zero demo tenant", 403);
    // The zod enum is the runtime authority; retain the type guard so a future schema
    // edit cannot accidentally widen data passed into the shared deterministic script.
    if (!isDealerZeroScenarioPack(body.data.scenario)) throw new AuthError("Unknown demo scenario", 400);
    const demo = buildTimeCompressedDemo(body.data.dateSeed, body.data.scenario, body.data.multiplier);
    // D8's pause-and-inspect surface must resolve to actual tenant receipts, not
    // invented IDs or a second demo ledger.  The script remains deterministic; the
    // current Dealer Zero receipt ids are only attached to its three inspectable
    // narrative beats, and this read never creates or changes business data.
    const receipts = await withTenant(ctx.tenantId, (db) =>
      db
        .select({ id: decisionReceipts.id })
        .from(decisionReceipts)
        .where(eq(decisionReceipts.tenantId, ctx.tenantId))
        .orderBy(desc(decisionReceipts.createdAt))
        .limit(3),
    );
    let receiptIndex = 0;
    return Response.json({
      ...demo,
      frames: demo.frames.map((frame) => {
        if (frame.kind === "day_start" || frame.kind === "day_end") return { ...frame, receiptId: null };
        const receiptId = receipts.length > 0 ? receipts[receiptIndex++ % receipts.length]!.id : null;
        return { ...frame, receiptId };
      }),
    });
  } catch (err) {
    return errorResponse(err);
  }
}
