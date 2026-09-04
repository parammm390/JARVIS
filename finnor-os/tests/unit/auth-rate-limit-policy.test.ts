import { afterEach, describe, expect, it, vi } from "vitest";
import { authenticatedRateLimitPolicy, preAuthRateLimitPolicy, requireContext } from "../../apps/api/lib/auth";
import { setRateLimitRedisForTesting } from "../../apps/api/lib/rate-limit";

describe("authenticated rate-limit policy", () => {
  afterEach(() => {
    setRateLimitRedisForTesting(undefined);
    vi.unstubAllEnvs();
  });

  it("puts projection reads on a bounded read bucket with a separate default budget", () => {
    const policy = authenticatedRateLimitPolicy(new Request("http://localhost/api/stats", { method: "GET" }), "tenant-1");
    expect(policy).toEqual({ bucketKey: "read:tenant:tenant-1", limit: 600, kind: "read" });
  });

  it("honors an explicit read budget without changing the write policy", () => {
    vi.stubEnv("RATE_LIMIT_READ_PER_MINUTE", "240");
    const read = authenticatedRateLimitPolicy(new Request("http://localhost/api/stats", { method: "HEAD" }), "tenant-1");
    const write = authenticatedRateLimitPolicy(new Request("http://localhost/api/actions", { method: "POST" }), "tenant-1");
    expect(read).toEqual({ bucketKey: "read:tenant:tenant-1", limit: 240, kind: "read" });
    expect(write).toEqual({ bucketKey: "tenant:tenant-1", kind: "write" });
  });

  it("keeps every mutating method on the historical tenant bucket", () => {
    for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
      expect(authenticatedRateLimitPolicy(new Request("http://localhost/api/actions", { method }), "tenant-2")).toEqual({
        bucketKey: "tenant:tenant-2",
        kind: "write",
      });
    }
  });

  it("keeps pre-auth mutation protection on the historical IP bucket", () => {
    vi.stubEnv("RATE_LIMIT_IP_PER_MINUTE", "2");
    expect(preAuthRateLimitPolicy(new Request("http://localhost/api/actions", { method: "POST" }), "unknown")).toEqual({
      bucketKey: "ip:unknown",
      limit: 2,
      kind: "write",
    });
  });

  it("uses a separate bounded pre-auth read bucket when the proxy has no caller IP", () => {
    const policy = preAuthRateLimitPolicy(new Request("http://localhost/api/stats", { method: "GET" }), "unknown");
    expect(policy).toEqual({ bucketKey: "ip-read:unknown", limit: 600, kind: "read" });
  });

  it("wires the authenticated GET boundary to the read bucket", async () => {
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("AUTH_DEV_BYPASS", "1");
    const keys: string[] = [];
    setRateLimitRedisForTesting({
      incr: async (key) => {
        keys.push(key);
        return 1;
      },
      pexpire: async () => undefined,
    });
    await requireContext(new Request("http://localhost/api/stats", {
      method: "GET",
      headers: { "x-tenant-id": "tenant-3" },
    }));
    expect(keys.some((key) => key.includes(":read:tenant:tenant-3:"))).toBe(true);
  });
});
