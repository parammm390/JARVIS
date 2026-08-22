import { completeGoogleConnection, ConnectionError } from "@finnor/security";

function cookie(req: Request, name: string): string | null {
  for (const part of (req.headers.get("cookie") ?? "").split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) return rest.join("=");
  }
  return null;
}

function consoleRedirect(status: string, code?: string): URL {
  const base = (process.env.CONSOLE_ORIGIN ?? "http://localhost:3101").split(",")[0]!.trim();
  const url = new URL("/settings/connections", base);
  url.searchParams.set("google", status);
  if (code) url.searchParams.set("code", code);
  return url;
}

export async function GET(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const state = url.searchParams.get("state") ?? "";
  const code = url.searchParams.get("code") ?? "";
  const providerError = url.searchParams.get("error");
  const rawCookie = cookie(req, "finnor_google_oauth");
  const clearCookie = "finnor_google_oauth=; HttpOnly; SameSite=Lax; Path=/api/connections/google/callback; Max-Age=0";
  const redirect = (target: URL) => new Response(null, { status: 303, headers: { location: target.toString(), "set-cookie": clearCookie, "cache-control": "no-store" } });
  if (providerError || !rawCookie) {
    return redirect(consoleRedirect("failed", providerError ?? "missing_cookie"));
  }
  try {
    const parsed = JSON.parse(Buffer.from(rawCookie, "base64url").toString("utf8")) as { state?: unknown; verifier?: unknown };
    if (typeof parsed.state !== "string" || typeof parsed.verifier !== "string" || parsed.state !== state) {
      throw new ConnectionError("invalid_state", "OAuth browser state does not match", 409);
    }
    await completeGoogleConnection({ state, code, verifier: parsed.verifier, traceId: req.headers.get("x-correlation-id") ?? undefined });
    return redirect(consoleRedirect("connected"));
  } catch (error) {
    const codeValue = error instanceof ConnectionError ? error.code : "callback_failed";
    return redirect(consoleRedirect("failed", codeValue));
  }
}
