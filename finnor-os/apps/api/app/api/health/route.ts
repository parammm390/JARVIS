import { getReleaseMetadata } from "../../../lib/release";

export async function GET(): Promise<Response> {
  const release = getReleaseMetadata("finnor-api");
  return Response.json({
    ok: true,
    service: "finnor-api",
    environment: process.env.FINNOR_ENVIRONMENT ?? process.env.NODE_ENV ?? "unknown",
    release: release.commitSha,
    provenance: release,
  });
}
