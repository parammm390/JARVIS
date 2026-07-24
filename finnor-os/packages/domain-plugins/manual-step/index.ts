// B2.T5: a durable, explicitly non-side-effecting replacement when an integration
// is unavailable.  It preserves the intended action and its payload for an operator
// without attempting to route through a provider whose breaker is open.

import type { DomainEnginePlugin } from "../shared/plugin-interface";
import type { DomainPolicy, DraftAction, ExecutionResult, ValidationResult } from "@finnor/shared-types";
import { z } from "zod";

const ACTION = "manual_step_suggestion";
export const ManualStepSuggestionSchema = z.object({
  originalActionType: z.string().min(1).max(160),
  originalPayload: z.record(z.unknown()),
  unavailableCapabilities: z.array(z.string().min(1).max(80)).min(1).max(9),
  reason: z.string().min(3).max(2000),
});

export const manualStepPlugin: DomainEnginePlugin = {
  name: "manual-step",
  actionTypes: [ACTION],
  payloadSchemas: { [ACTION]: ManualStepSuggestionSchema },
  canHandle: (actionType) => actionType === ACTION,
  validate(actionType, payload): ValidationResult {
    if (actionType !== ACTION) return { valid: false, errors: [`unhandled action ${actionType}`] };
    const parsed = ManualStepSuggestionSchema.safeParse(payload);
    return parsed.success ? { valid: true, errors: [] } : { valid: false, errors: parsed.error.issues.map((issue) => `payload.${issue.path.join(".")}: ${issue.message}`) };
  },
  draft(actionType, payload, _policy: DomainPolicy): DraftAction {
    const suggestion = ManualStepSuggestionSchema.parse(payload);
    return {
      actionType,
      summary: `Manual step needed: ${suggestion.reason}`,
      payload: suggestion,
      // This records an advisory receipt only. It never approves or performs the
      // blocked original action.
      requiresConfirmation: false,
    };
  },
  simulate(_actionType, payload) {
    const suggestion = ManualStepSuggestionSchema.parse(payload);
    return {
      mode: "schema" as const,
      summary: `No provider call predicted. Manual handling is needed for ${suggestion.originalActionType}.`,
      predicted: { manualStepSuggested: true, fieldChanges: [] },
    };
  },
  async execute(draft): Promise<ExecutionResult> {
    return {
      status: "success",
      output: {
        manualStepSuggested: true,
        originalActionType: draft.payload.originalActionType,
        unavailableCapabilities: draft.payload.unavailableCapabilities,
        reason: draft.payload.reason,
      },
    };
  },
};

export default manualStepPlugin;
