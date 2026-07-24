// B3.T1 — one advisory, normally gated route proposal per technician each day.
// The plugin itself reads that day's unfinished stops only after approval; this handler
// deliberately does not bypass the normal action/receipt pipeline.

import { withTenant, technicians } from "@finnor/db";
import { FinnorOrchestrator } from "@finnor/orchestration";
import { eq } from "drizzle-orm";
import type { JobHandler } from "../queue";

let orchestrator: FinnorOrchestrator | null = null;

export const suggestDailyRoutes: JobHandler = async (payload) => {
  const tenantId = String(payload.tenantId ?? "");
  if (!tenantId) throw new Error("suggest_daily_routes requires tenantId");
  orchestrator ??= new FinnorOrchestrator();
  const date = typeof payload.date === "string" ? payload.date : new Date().toISOString().slice(0, 10);
  const techs = await withTenant(tenantId, (db) =>
    db.select({ id: technicians.id }).from(technicians).where(eq(technicians.tenantId, tenantId)),
  );
  for (const tech of techs) {
    await orchestrator.draftKnownAction("route_suggestion", { technicianId: tech.id, date }, tenantId, { source: "suggest_daily_routes" });
  }
};
