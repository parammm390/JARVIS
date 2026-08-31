import {
  checkOperationalProgramAdmissibility,
  type StaticAdmissibilityOptions,
  type StaticAdmissibilityReasonCode,
  type StaticAdmissibilityResult,
} from "./admissibility";
import { lowerOperationalProgram, type CompatibilityLoweringResult, type TrustedLoweringContext } from "./lowerer";
import type { AuthorizedRequirementManifest } from "./effects";

export type StaticLoweringResult =
  | {
      status: "REJECTED" | "UNRESOLVED";
      admissibility: StaticAdmissibilityResult;
      reasons: string[];
    }
  | {
      status: "LOWERED";
      admissibility: StaticAdmissibilityResult & { status: "ADMISSIBLE"; manifest: AuthorizedRequirementManifest };
      lowering: Extract<CompatibilityLoweringResult, { status: "LOWERED" }>;
    };

/**
 * P2 fail-closed entry point. It emits requirements only; the existing lowerer,
 * BusinessEffect compiler, Authority evaluator, approvals, and execution guards all
 * remain mandatory downstream.
 */
export async function lowerStaticallyAdmissibleOperationalProgram(
  input: unknown,
  context: TrustedLoweringContext | undefined,
  options: StaticAdmissibilityOptions,
): Promise<StaticLoweringResult> {
  const admissibility = await checkOperationalProgramAdmissibility(input, options);
  if (admissibility.status !== "ADMISSIBLE" || !admissibility.manifest) {
    const blockingStatus: "REJECTED" | "UNRESOLVED" = admissibility.status === "REJECTED" ? "REJECTED" : "UNRESOLVED";
    return {
      status: blockingStatus,
      admissibility,
      reasons: admissibility.issues.map((entry) => `${entry.reasonCode}@${entry.nodeId}: ${entry.message}`),
    };
  }
  const lowering = lowerOperationalProgram(input, context);
  if (lowering.status !== "LOWERED") {
    // The checker must never silently admit an unsupported existing lowerer seam.
    return {
      status: "UNRESOLVED",
      admissibility: {
        ...admissibility,
        status: "UNRESOLVED",
        reasonCodes: [...new Set<StaticAdmissibilityReasonCode>([...admissibility.reasonCodes, "UNSUPPORTED_EFFECT_LOWERING"])].sort(),
        issues: [...admissibility.issues, {
          status: "UNRESOLVED",
          reasonCode: "UNSUPPORTED_EFFECT_LOWERING",
          nodeId: admissibility.summary?.possible[0]?.effect.nodeId ?? "$",
          path: "body",
          message: lowering.reasons.join(" "),
        }],
      },
      reasons: lowering.reasons,
    };
  }
  return {
    status: "LOWERED",
    admissibility: admissibility as StaticAdmissibilityResult & { status: "ADMISSIBLE"; manifest: AuthorizedRequirementManifest },
    lowering,
  };
}
