/**
 * A workflow-step job key identifies one delivery generation, not the step for all
 * time. Generation zero deliberately keeps the historical key so queued jobs from a
 * rolling deployment remain claimable after this release.
 */
export function workflowStepJobKey(tenantId: string, stepId: string, dispatchGeneration = 0): string {
  if (!Number.isSafeInteger(dispatchGeneration) || dispatchGeneration < 0) {
    throw new Error("workflow step dispatch generation must be a non-negative safe integer");
  }
  const base = `workflow-step:${tenantId}:${stepId}`;
  return dispatchGeneration === 0 ? base : `${base}:generation:${dispatchGeneration}`;
}
