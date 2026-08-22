const FULL_COMMIT_SHA = /^[0-9a-f]{40}$/i;

export type RuntimeReleaseMetadata = {
  service: string;
  commitSha: string;
  buildId: string;
  version: string;
  environment: string;
  source: string;
  traceable: boolean;
};

function env(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value || undefined;
}

/**
 * Provider-neutral release identity shared by persistent FINNOR runtimes.
 * Production deployment injects every field from the canonical Git commit.
 */
export function getRuntimeReleaseMetadata(service: string): RuntimeReleaseMetadata {
  const commitSha = env("FINNOR_COMMIT_SHA") ?? "unknown";
  const shortSha = FULL_COMMIT_SHA.test(commitSha) ? commitSha.slice(0, 12) : "unknown";
  const buildId = env("FINNOR_BUILD_ID") ?? `finnor-${shortSha}`;
  const version = env("FINNOR_VERSION") ?? `0.1.0+${shortSha}`;
  const environment = env("FINNOR_ENVIRONMENT") ?? env("NODE_ENV") ?? "unknown";
  const source = env("FINNOR_RELEASE_SOURCE") ?? "unknown";

  return {
    service,
    commitSha,
    buildId,
    version,
    environment,
    source,
    traceable:
      FULL_COMMIT_SHA.test(commitSha) &&
      buildId === `finnor-${shortSha}` &&
      version.endsWith(`+${shortSha}`) &&
      environment !== "unknown" &&
      source !== "unknown",
  };
}
