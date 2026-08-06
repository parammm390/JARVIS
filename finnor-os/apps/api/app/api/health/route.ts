export async function GET(): Promise<Response> {
  return Response.json({
    ok: true,
    service: "finnor-api",
    environment: process.env.FINNOR_ENVIRONMENT ?? process.env.NODE_ENV ?? "unknown",
    release: process.env.RELEASE_SHA ?? process.env.VERCEL_GIT_COMMIT_SHA ?? process.env.RAILWAY_GIT_COMMIT_SHA ?? null,
  });
}
