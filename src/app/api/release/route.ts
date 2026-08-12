import { NextResponse } from "next/server"
import { getReleaseMetadata } from "@/lib/release"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export function GET() {
  const release = getReleaseMetadata("finnor-frontend")
  return NextResponse.json(release, {
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
