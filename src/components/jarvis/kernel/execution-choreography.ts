/** Phase 4 execution motion contracts. These values are presentation-only:
 * durable workflow state remains owned by the shared data projection. */

export const LF09_DECISION_WAVE_MS = 520
export const LF10_WORKFLOW_IGNITION_MS = 300
export const LF11_FLOW_SLOW_MS = 1400
export const LF11_FLOW_FAST_MS = 800
export const LF12_STEP_SPARK_MS = 340
export const LF13_FAULT_FRACTURE_MS = 160

export function leasedFlowDurationMs(energy: number): number {
  const bounded = Number.isFinite(energy) ? Math.max(0, Math.min(1, energy)) : 0
  return LF11_FLOW_SLOW_MS - (LF11_FLOW_SLOW_MS - LF11_FLOW_FAST_MS) * bounded
}

export function workflowFaultVariants(reduced: boolean) {
  return {
    initial: { x: 0, opacity: 0 },
    animate: reduced
      ? { x: 0, opacity: 1, transition: { duration: 0 } }
      : {
          x: [0, -4, 4, 0],
          opacity: [0, 1, 1, 0],
          transition: { duration: LF13_FAULT_FRACTURE_MS / 1000, ease: "easeOut" as const },
        },
  }
}
