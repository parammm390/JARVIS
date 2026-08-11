import { getReleaseMetadata } from "../../../lib/release"

export const dynamic = "force-dynamic"

export function GET(): Response {
  const release = getReleaseMetadata("finnor-api")
  return Response.json(release, {
    headers: {
      "cache-control": "no-store, max-age=0",
      "x-finnor-commit-sha": release.commitSha,
      "x-finnor-build-id": release.buildId,
      "x-finnor-deployment-id": release.deploymentId ?? "unknown",
      "x-finnor-environment": release.environment,
      "x-finnor-version": release.version,
    },
  })
}

