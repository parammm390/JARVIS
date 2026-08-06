// Approval surfaces may be mounted in two different contexts:
//
// - the Command Bridge's tenant-wide inbox (no scope), or
// - the Instruction Thread's cockpit (explicit action/instruction scope).
//
// Keep the distinction in a small pure helper. In particular, an explicit empty
// action-id list is still a scope: falling back to the tenant-wide queue there
// would let an unrelated action become physically approvable from this thread.

export interface ApprovalScope {
  actionIds?: readonly string[]
  instructionId?: string | null
}

export interface ApprovalScopedAction {
  id: string
  instructionId?: string | null
}

export function isScopedApprovalSurface(scope: ApprovalScope): boolean {
  return scope.actionIds !== undefined || scope.instructionId != null
}

export function actionBelongsToApprovalScope(action: ApprovalScopedAction, scope: ApprovalScope): boolean {
  if (!isScopedApprovalSurface(scope)) return true
  if (scope.actionIds?.includes(action.id)) return true
  return scope.instructionId != null && action.instructionId === scope.instructionId
}

export function filterApprovalActions<T extends ApprovalScopedAction>(actions: readonly T[], scope: ApprovalScope): T[] {
  return actions.filter((action) => actionBelongsToApprovalScope(action, scope))
}
