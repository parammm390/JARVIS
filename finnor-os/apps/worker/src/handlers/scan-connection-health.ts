import { verifyRequiredConnectionsForTenant } from "@finnor/security";
import { getLogger } from "@finnor/tools";
import type { JobHandler } from "../queue";

export const scanConnectionHealth: JobHandler = async (payload) => {
  const tenantId = typeof payload.tenantId === "string" ? payload.tenantId : "";
  if (!tenantId) throw new Error("scan_connection_health requires tenantId");
  const results = await verifyRequiredConnectionsForTenant(tenantId);
  getLogger().info({
    tenantId,
    checked: results.length,
    usable: results.filter((result) => result.usable).length,
    statuses: results.reduce<Record<string, number>>((counts, result) => {
      counts[result.status] = (counts[result.status] ?? 0) + 1;
      return counts;
    }, {}),
  }, "[connections] governed health scan completed");
};
