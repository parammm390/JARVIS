import "dotenv/config";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { closePool, getPool } from "@finnor/db";
import { OUTCOME_PACK_IDS, type OutcomeCertificationLevel, type OutcomeCertificationStatus, type OutcomePackId } from "@finnor/shared-types";
import { OUTCOME_PACK_DEFINITIONS, outcomePackFingerprint } from "@finnor/orchestration";
import { CertificationArtifactStore, persistOutcomePackCertification } from "./certification-store";
import { createOutcomePackCertification, gateResult, PHASE5_ACCEPTANCE_JOURNEYS } from "./certification-model";

type Evidence = {
  deterministicContractsPassed?: boolean;
  chaosPassed?: boolean;
  shadowZeroEffectPassed?: boolean;
  approvalContinuationPassed?: boolean;
  autonomySafetyPassed?: boolean;
  sandboxProviderObserved?: boolean;
  liveProviderObserved?: boolean;
  canonicalReconciled?: boolean;
  outcomeVerified?: boolean;
  sampleSize?: number;
  criticalViolations?: number;
  acceptanceJourneys?: Record<string, boolean>;
  detail?: unknown;
};

function args(): Record<string, string> {
  return Object.fromEntries(process.argv.slice(2).filter((arg) => arg.startsWith("--") && arg.includes("=")).map((arg) => {
    const [key, ...value] = arg.slice(2).split("=");
    return [key!, value.join("=")];
  }));
}

function required(options: Record<string, string>, key: string): string {
  const value = options[key];
  if (!value) throw new Error(`--${key}=<value> is required`);
  return value;
}

async function configuredProviderTruth(tenantId: string, packId: OutcomePackId, level: OutcomeCertificationLevel): Promise<{ configured: boolean; rows: unknown[] }> {
  if (level === "deterministic" || level === "chaos") return { configured: true, rows: [] };
  const definition = OUTCOME_PACK_DEFINITIONS[packId];
  const requiredCapabilities = definition.requiredCapabilities.filter((item) => item.required).map((item) => item.capability);
  if (requiredCapabilities.length === 0) return { configured: true, rows: [] };
  const result = await getPool().query<{
    capability: string; binding: string; mode: string; health: string; sync_status: string;
    freshness_state: string; reconciliation_status: string; unresolved_conflicts: number; outcome_packs: string[];
  }>(
    `SELECT capability,binding,mode,health,sync_status,freshness_state,reconciliation_status,unresolved_conflicts,outcome_packs
       FROM finnor_os.tenant_integrations WHERE tenant_id=$1::uuid AND capability=ANY($2::text[])`,
    [tenantId, requiredCapabilities],
  );
  const expectedMode = level === "sandbox" ? "sandbox" : "real";
  const configured = requiredCapabilities.every((capability) => result.rows.some((row) =>
    row.capability === capability && row.mode === expectedMode && row.health === "ok" && row.sync_status === "synced"
    && row.freshness_state === "fresh" && row.reconciliation_status === "healthy" && row.unresolved_conflicts === 0
    && row.outcome_packs.includes(packId),
  ));
  return { configured, rows: result.rows.map((row) => ({ ...row, tenantId: undefined })) };
}

async function main(): Promise<void> {
  const options = args();
  const tenantId = required(options, "tenant-id");
  const packId = required(options, "pack") as OutcomePackId;
  if (!(OUTCOME_PACK_IDS as readonly string[]).includes(packId)) throw new Error(`Unknown pack: ${packId}`);
  const level = required(options, "level") as OutcomeCertificationLevel;
  if (!(["deterministic", "chaos", "sandbox", "live_provider", "production"] as const).includes(level)) throw new Error(`Unknown certification level: ${level}`);
  const evidence = JSON.parse(await readFile(resolve(required(options, "evidence")), "utf8")) as Evidence;
  const provider = await configuredProviderTruth(tenantId, packId, level);
  const deterministicPass = evidence.deterministicContractsPassed === true && evidence.shadowZeroEffectPassed === true && evidence.approvalContinuationPassed === true;
  const chaosRequired = level !== "deterministic";
  const chaosPass = !chaosRequired || evidence.chaosPassed === true;
  const providerRequired = level === "sandbox" || level === "live_provider" || level === "production";
  const providerObserved = level === "sandbox" ? evidence.sandboxProviderObserved === true : evidence.liveProviderObserved === true;
  const providerPass = !providerRequired || (provider.configured && providerObserved);
  const outcomePass = evidence.canonicalReconciled === true && evidence.outcomeVerified === true;
  const autonomyPass = evidence.autonomySafetyPassed === true && Number(evidence.criticalViolations ?? 0) === 0;
  const missingAcceptanceJourneys = PHASE5_ACCEPTANCE_JOURNEYS.filter((journey) => evidence.acceptanceJourneys?.[String(journey.id)] !== true);
  const acceptancePass = missingAcceptanceJourneys.length === 0;
  const blockedConfig = providerRequired && !provider.configured;
  const allNonProviderPass = deterministicPass && chaosPass && outcomePass && autonomyPass && acceptancePass;
  const allPass = allNonProviderPass && providerPass;
  const status: OutcomeCertificationStatus = blockedConfig && allNonProviderPass ? "BLOCKED_CONFIG"
    : !allPass ? "NOT_CERTIFIED"
      : level === "sandbox" ? "SANDBOX_PASS"
        : level === "live_provider" || level === "production" ? "LIVE_TEST_PASS" : "LOCAL_PASS";
  const gates = [
    gateResult("pack_contract", deterministicPass ? "PASS" : "FAIL", { packId, version: OUTCOME_PACK_DEFINITIONS[packId].version, deterministicPass }),
    gateResult("deterministic_runtime", deterministicPass ? "PASS" : "FAIL", { deterministicContractsPassed: evidence.deterministicContractsPassed, shadowZeroEffectPassed: evidence.shadowZeroEffectPassed, approvalContinuationPassed: evidence.approvalContinuationPassed }),
    gateResult("failure_chaos", chaosPass ? "PASS" : "FAIL", { required: chaosRequired, passed: evidence.chaosPassed === true }),
    gateResult("acceptance_journeys", acceptancePass ? "PASS" : "FAIL", { required: PHASE5_ACCEPTANCE_JOURNEYS.length, passed: PHASE5_ACCEPTANCE_JOURNEYS.length - missingAcceptanceJourneys.length, missing: missingAcceptanceJourneys }),
    gateResult("provider_source_truth", blockedConfig ? "BLOCKED_CONFIG" : providerPass ? "PASS" : "FAIL", { required: providerRequired, configured: provider.configured, observed: providerObserved, integrations: provider.rows }),
    gateResult("outcome_verification", outcomePass ? "PASS" : "FAIL", { canonicalReconciled: evidence.canonicalReconciled === true, outcomeVerified: evidence.outcomeVerified === true }),
    gateResult("trust_autonomy_safety", autonomyPass ? "PASS" : "FAIL", { autonomySafetyPassed: evidence.autonomySafetyPassed === true, criticalViolations: evidence.criticalViolations ?? 0 }),
  ];
  const certifiedAt = new Date();
  const artifact = createOutcomePackCertification({
    tenantId,
    packId,
    packVersion: OUTCOME_PACK_DEFINITIONS[packId].version,
    fingerprint: outcomePackFingerprint(packId),
    level,
    status,
    gates,
    sampleSize: Math.max(0, Number(evidence.sampleSize ?? 0)),
    criticalViolations: Math.max(0, Number(evidence.criticalViolations ?? 0)),
    certifiedAt: certifiedAt.toISOString(),
    validUntil: new Date(certifiedAt.getTime() + 90 * 86_400_000).toISOString(),
  });
  const store = new CertificationArtifactStore(resolve(options.store ?? ".certifications"));
  const stored = await store.writeOutcomePackCertification(artifact);
  await persistOutcomePackCertification(getPool(), stored.artifact);
  console.log(JSON.stringify({ status, path: stored.path, reused: stored.reused, artifact: stored.artifact }, null, 2));
  process.exitCode = status === "LOCAL_PASS" || status === "SANDBOX_PASS" || status === "LIVE_TEST_PASS" ? 0 : status === "BLOCKED_CONFIG" ? 2 : 1;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}).finally(() => closePool());
