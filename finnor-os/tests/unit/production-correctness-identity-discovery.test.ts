import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("production-correctness identity discovery", () => {
  it("shares execution status, credential, restriction, and authority gates", async () => {
    const source = await readFile(new URL("../../packages/security/src/identity-access.ts", import.meta.url), "utf8");
    const projection = source.slice(source.indexOf("export async function listAvailableIdentityAccess"));

    expect(projection).toContain('["active", "degraded"].includes(row.linkedConnectionStatus');
    expect(projection).toContain('["active", "degraded"].includes(row.connectionStatus)');
    expect(projection).toContain("communicationCredentialAvailable(tenantId, row)");
    expect(projection).toContain("authProfileCredentialAvailable(tenantId, row)");
    expect(projection).toContain("restrictionsAllow(row, actor.actorId, row.purpose)");
    expect(projection.match(/await canUse\(/g)).toHaveLength(2);
  });
});
