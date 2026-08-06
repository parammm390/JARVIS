# P4.T4 discovery — failure, blocked, compensation, and recovery

## Source facts

- Run states in the checked-out kernel include `failed`, `compensating`, `compensated`, `cancelled`, and `escalated`.
- Step states include `failed`, `compensating`, and `compensated`; the checked-out workflow step schema does not expose a separate `blocked` step state.
- Blocked work is exposed by the existing `actions/pending?filter=blocked` response, so blocked is represented as an action with no workflow run rather than invented as a step state.
- Existing run controls are real POST operations with server-side authorization and version checks.
