// LangGraph state for the gate pipeline — mirrors GatedExecutor's local variables
// exactly (validation, draft, result), plus alreadyApproved which replaces the old
// `action.status !== "approved"` check (see executor.ts for why).

import { Annotation } from "@langchain/langgraph";
import type { DomainPolicy, ValidationResult, DraftAction, ExecutionResult } from "@finnor/shared-types";

export const GateStateAnnotation = Annotation.Root({
  actionId: Annotation<string>,
  tenantId: Annotation<string>,
  actionType: Annotation<string>,
  payload: Annotation<Record<string, unknown>>,
  policy: Annotation<DomainPolicy>,
  alreadyApproved: Annotation<boolean>,
  validation: Annotation<ValidationResult | undefined>,
  draft: Annotation<DraftAction | undefined>,
  decision: Annotation<"approve" | "reject" | undefined>,
  result: Annotation<ExecutionResult | undefined>,
});

export type GateState = typeof GateStateAnnotation.State;
