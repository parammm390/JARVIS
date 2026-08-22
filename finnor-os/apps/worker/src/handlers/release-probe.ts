import { getRuntimeReleaseMetadata } from "@finnor/tools";

/** Operational, side-effect-free proof that the persistent queue executed this release. */
export async function releaseProbe(payload: Record<string, unknown>): Promise<void> {
  const release = getRuntimeReleaseMetadata("finnor-worker");
  if (!release.traceable) throw new Error("worker release identity is not traceable");
  if (payload.commitSha !== release.commitSha) {
    throw new Error(`release probe expected ${String(payload.commitSha)}, worker is ${release.commitSha}`);
  }
}
