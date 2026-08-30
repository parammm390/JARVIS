import {
  P2_ZERO_SHADOW_MUTATIONS,
  runP2EffectShadow,
  type StaticResolutionProvider,
} from "@finnor/operational-ir";
import { logWithTrace } from "@finnor/tools";
import { finnorStaticResolutionProvider } from "./operational-ir-effect-resolution";
import {
  operationalQueryShadowProgram,
  type OperationalQueryShadowInput,
} from "./operational-ir-shadow";

export interface OperationalQueryP2EffectShadowSummary {
  event: "operational_ir_p2_effect_shadow";
  version: 1;
  authoritativePath: "EXISTING";
  behaviorChanged: false;
  executionModel: "QUERY";
  queryIntent: string;
  admissibility: "ADMISSIBLE" | "REJECTED" | "UNRESOLVED";
  reasonCodes: string[];
  dimensions: string[];
  runtimeAuthorityReevaluationRequired: true;
  consequentialMutations: 0;
  persistenceWrites: 0;
  authorityDecisions: 0;
  approvalRequests: 0;
  providerCalls: 0;
  computerRuns: 0;
  workTransitions: 0;
}

export type OperationalQueryP2EffectShadowRecorder = (summary: OperationalQueryP2EffectShadowSummary) => void;

/**
 * Additive read-only P2 production shadow. Tenant identity is supplied separately
 * by authenticated runtime context; resolution may read governed stores but this
 * function has no authority, approval, persistence, provider, computer, or Work
 * mutation callback.
 */
export async function observeOperationalQueryP2EffectShadow(
  input: OperationalQueryShadowInput,
  trustedTenantId: string,
  provider: StaticResolutionProvider = finnorStaticResolutionProvider,
  recorder?: OperationalQueryP2EffectShadowRecorder,
): Promise<OperationalQueryP2EffectShadowSummary> {
  let summary: OperationalQueryP2EffectShadowSummary;
  try {
    const program = operationalQueryShadowProgram(input);
    const record = await runP2EffectShadow({
      program,
      options: { resolution: { tenantId: trustedTenantId, provider } },
    });
    summary = {
      event: "operational_ir_p2_effect_shadow",
      version: 1,
      authoritativePath: "EXISTING",
      behaviorChanged: false,
      executionModel: "QUERY",
      queryIntent: input.readDecision.request.intent,
      admissibility: record.admissibility.status,
      reasonCodes: record.admissibility.reasonCodes,
      dimensions: record.admissibility.summary?.dimensions ?? [],
      runtimeAuthorityReevaluationRequired: true,
      ...P2_ZERO_SHADOW_MUTATIONS,
    };
  } catch {
    summary = {
      event: "operational_ir_p2_effect_shadow",
      version: 1,
      authoritativePath: "EXISTING",
      behaviorChanged: false,
      executionModel: "QUERY",
      queryIntent: input.readDecision.request.intent,
      admissibility: "UNRESOLVED",
      reasonCodes: ["P2_SHADOW_INTERNAL_FAILURE"],
      dimensions: [],
      runtimeAuthorityReevaluationRequired: true,
      ...P2_ZERO_SHADOW_MUTATIONS,
    };
  }
  const effectiveRecorder = recorder ?? ((record: OperationalQueryP2EffectShadowSummary) => {
    logWithTrace({ workId: input.workId, instructionId: input.instructionId }).info(
      record,
      "Operational IR P2 effect shadow",
    );
  });
  try { effectiveRecorder(summary); } catch { /* Shadow recording cannot alter the authoritative query. */ }
  return summary;
}
