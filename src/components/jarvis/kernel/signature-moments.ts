// P1.T4 — the seven Command Canvas signature moments.
//
// This is a presentation contract, not a second lifecycle machine. The
// canonical kernel, trace stream, voice session, and workflow read model still
// own all business state. Components pass one observed source edge to
// `signatureMomentForEdge`; a refresh/restored snapshot is explicitly marked so
// a durable state is rendered settled instead of replaying its entrance.

import type { LiveFrameMode, LiveFrameTransportPosture } from "./liveframe"

export const SIGNATURE_MOMENT_IDS = [
  "wake",
  "gather",
  "draw",
  "clamp",
  "ignite",
  "settle",
  "recover",
] as const

export type SignatureMomentId = (typeof SIGNATURE_MOMENT_IDS)[number]

export interface SignatureMomentSpec {
  label: string
  meaning: string
  durationMs: readonly [number, number]
  easing: readonly number[]
  reducedMotionEquivalent: string
  source: string
}

/** Exact v6 §8 grammar ranges for the seven launch-signature moments. */
export const SIGNATURE_MOMENTS: Readonly<Record<SignatureMomentId, SignatureMomentSpec>> = {
  wake: {
    label: "Presence wakes",
    meaning: "Ready → Listening",
    durationMs: [320, 420],
    easing: [0.22, 1, 0.36, 1],
    reducedMotionEquivalent: "instant focus/border/copy/state change",
    source: "voice session micOpen|voiceSpeaking",
  },
  gather: {
    label: "Business gathers",
    meaning: "Real context enters the Thread",
    durationMs: [220, 320],
    easing: [0.22, 1, 0.36, 1],
    reducedMotionEquivalent: "instant focus/border/copy/state change",
    source: "instruction_events.context_retrieved",
  },
  draw: {
    label: "Plan writes itself",
    meaning: "Real actions/dependencies form",
    durationMs: [240, 340],
    easing: [0.22, 1, 0.36, 1],
    reducedMotionEquivalent: "instant focus/border/copy/state change",
    source: "instruction_events.action_created · domain_actions",
  },
  clamp: {
    label: "Authority clamps",
    meaning: "Approval takes focus",
    durationMs: [180, 260],
    easing: [0.34, 1.56, 0.64, 1],
    reducedMotionEquivalent: "instant focus/border/copy/state change",
    source: "instruction machine awaiting_approval",
  },
  ignite: {
    label: "Execution ignites",
    meaning: "Approved work becomes execution",
    durationMs: [260, 360],
    easing: [0.22, 1, 0.36, 1],
    reducedMotionEquivalent: "instant focus/border/copy/state change",
    source: "workflow_steps.status → leased",
  },
  settle: {
    label: "Evidence settles",
    meaning: "Authoritative outcome becomes receipt evidence",
    durationMs: [320, 440],
    easing: [0.22, 1, 0.36, 1],
    reducedMotionEquivalent: "instant focus/border/copy/state change",
    source: "instruction_events.completed · authoritative receipt",
  },
  recover: {
    label: "Recovery reconnects",
    meaning: "A legal recovery/reconciliation path reconnects",
    durationMs: [260, 420],
    easing: [0.22, 1, 0.36, 1],
    reducedMotionEquivalent: "instant focus/border/copy/state change",
    source: "transport degraded → healthy or legal workflow recovery",
  },
}

type PresenceEdge = {
  kind: "presence"
  previous: LiveFrameMode | null
  current: LiveFrameMode
  restored?: boolean
}

type ContextEdge = {
  kind: "context-retrieved"
  enteringCount: number
  restored?: boolean
}

type ActionEdge = {
  kind: "action-created"
  enteringCount: number
  restored?: boolean
}

type ApprovalEdge = {
  kind: "approval-required"
  state: "awaiting_approval"
  restored?: boolean
}

type WorkflowStepEdge = {
  kind: "workflow-step"
  previous: string | null
  current: string
  restored?: boolean
}

type OutcomeEdge = {
  kind: "authoritative-outcome"
  previous: string | null
  current: "completed" | "partial"
  restored?: boolean
}

type RecoveryEdge = {
  kind: "recovery"
  previousTransport?: LiveFrameTransportPosture | null
  currentTransport?: LiveFrameTransportPosture
  previousStep?: string | null
  currentStep?: string | null
  restored?: boolean
}

export type SignatureSourceEdge =
  | PresenceEdge
  | ContextEdge
  | ActionEdge
  | ApprovalEdge
  | WorkflowStepEdge
  | OutcomeEdge
  | RecoveryEdge

const LEGAL_RECOVERY_NEXT_STEPS = new Set(["leased", "running", "compensating", "completed", "compensated"])

/**
 * Return a moment only for an observed source edge. `null` is intentional:
 * initial/restored snapshots and ordinary state reads must not manufacture a
 * cinematic entrance.
 */
export function signatureMomentForEdge(edge: SignatureSourceEdge): SignatureMomentId | null {
  if (edge.restored) return null

  switch (edge.kind) {
    case "presence":
      return edge.previous === "ready" && edge.current === "listening" ? "wake" : null
    case "context-retrieved":
      return edge.enteringCount > 0 ? "gather" : null
    case "action-created":
      return edge.enteringCount > 0 ? "draw" : null
    case "approval-required":
      return edge.state === "awaiting_approval" ? "clamp" : null
    case "workflow-step":
      return edge.previous !== "leased" && edge.current === "leased" ? "ignite" : null
    case "authoritative-outcome":
      return edge.previous !== edge.current ? "settle" : null
    case "recovery": {
      const transportRecovered = edge.previousTransport !== undefined && edge.previousTransport !== null && edge.previousTransport !== "healthy" && edge.currentTransport === "healthy"
      const workflowRecovered = edge.previousStep === "failed" && typeof edge.currentStep === "string" && LEGAL_RECOVERY_NEXT_STEPS.has(edge.currentStep)
      return transportRecovered || workflowRecovered ? "recover" : null
    }
  }
}
