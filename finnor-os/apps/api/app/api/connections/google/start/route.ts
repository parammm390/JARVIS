import { beginGoogleConnection, ConnectionError } from "@finnor/security";
import { errorResponse, requireContext } from "../../../../../lib/auth";

function connectionError(error: unknown): Response {
  if (error instanceof ConnectionError) return Response.json({ error: error.message, code: error.code }, { status: error.status });
  return errorResponse(error);
}
export async function POST(req: Request): Promise<Response> {
  try {
    const ctx = await requireContext(req);
    const body = await req.json() as { authProfileRef?: unknown; redirectUri?: unknown };
    if (typeof body.authProfileRef !== "string" || !body.authProfileRef.trim()) {
      return Response.json({ error: "authProfileRef is required" }, { status: 400 });
    }
    const redirectUri = typeof body.redirectUri === "string" && body.redirectUri.trim()
      ? body.redirectUri.trim()
      : new URL("/api/connections/google/callback", req.url).toString();
    const started = await beginGoogleConnection({
      tenantId: ctx.tenantId,
      actorId: ctx.userId,
      authProfileRef: body.authProfileRef.trim(),
      redirectUri,
      traceId: ctx.correlationId,
    });
    const cookieValue = Buffer.from(JSON.stringify({ state: started.state, verifier: started.verifier }), "utf8").toString("base64url");
    const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
    return Response.json(
      { authorizationUrl: started.authorizationUrl, expiresAt: started.expiresAt },
      {
        headers: {
          "cache-control": "no-store",
          "set-cookie": `finnor_google_oauth=${cookieValue}; HttpOnly${secure}; SameSite=Lax; Path=/api/connections/google/callback; Max-Age=600`,
        },
      },
    );
  } catch (error) {
    return connectionError(error);
  }
}
