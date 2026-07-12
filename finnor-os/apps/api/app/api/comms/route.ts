// GET /api/comms — everything Finnor has said or sent: the sandbox outbox (carrier hop
// simulated) merged with the real communications log, newest first, tenant-scoped.

import { withTenant, sandboxOutbox, communicationsLog, households } from "@finnor/db";
import { desc, eq } from "drizzle-orm";
import { requireContext, errorResponse } from "../../../lib/auth";

export async function GET(req: Request): Promise<Response> {
  try {
    const ctx = await requireContext(req);
    const [outbox, comms] = await withTenant(ctx.tenantId, async (db) =>
      Promise.all([
        db.select().from(sandboxOutbox).orderBy(desc(sandboxOutbox.createdAt)).limit(100),
        db
          .select({
            id: communicationsLog.id,
            channel: communicationsLog.channel,
            direction: communicationsLog.direction,
            content: communicationsLog.content,
            timestamp: communicationsLog.timestamp,
            household: households.address,
            contactInfo: households.contactInfo,
          })
          .from(communicationsLog)
          .innerJoin(households, eq(communicationsLog.householdId, households.id))
          .orderBy(desc(communicationsLog.timestamp))
          .limit(100),
      ]),
    );
    return Response.json({ outbox, communications: comms });
  } catch (err) {
    return errorResponse(err);
  }
}
