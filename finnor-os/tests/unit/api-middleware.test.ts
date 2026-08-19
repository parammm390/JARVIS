import { describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { middleware } from "../../apps/api/middleware";

function request(path: string, authorization?: string): NextRequest {
  return new NextRequest(`https://api.finnor.test${path}`, {
    headers: authorization ? { authorization } : undefined,
  });
}

describe("API middleware readiness boundary", () => {
  it.each(["/api/health", "/api/release"])("allows anonymous readiness request %s through", (path) => {
    const response = middleware(request(path));

    expect(response.status).toBe(200);
    expect(response.headers.get("x-middleware-next")).toBe("1");
  });

  it("still rejects an anonymous private API request", async () => {
    const response = middleware(request("/api/operating-profile"));

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: "Missing Authorization header" });
  });

  it("allows an authenticated private API request through", () => {
    const response = middleware(request("/api/operating-profile", "Bearer verified-user-token"));

    expect(response.status).toBe(200);
    expect(response.headers.get("x-middleware-next")).toBe("1");
  });
});
