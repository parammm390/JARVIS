"use client"

// The single sanctioned bridge from the lane runner into the kernel (plan v3 §4.1:
// "the kernel wraps lib/data-core.ts; it never replaces it").
//
// This is the ONE place outside the kernel's own boundary where `useJarvis()` and
// `useJarvisAuth()` are read. It assembles the plain `SelectorInput` that every
// selector consumes and nothing else — no interpretation happens here, so there is
// nothing here to unit-test and nothing here that can contradict a selector.

import { useJarvis, SLOW_LANE_STALE_MS } from "../lib/data-core"
import type { SetupStatus } from "../lib/data-core"
import type { IntegrationsStatus } from "../lib/data-core"
import { useJarvisAuth } from "../lib/jarvis-auth"
import type { SelectorInput } from "./selectors"

export function useSelectorInput(): SelectorInput {
  const data = useJarvis()
  const auth = useJarvisAuth()

  // `data-core` reports *that* a lane is degraded, not *since when*. Until the
  // kernel owns transport (P2.T1) the honest available approximation is the last
  // successful slow-lane fetch — the most recent moment we know things were fine.
  const degradedSinceMs = data.slowLastSuccessMs ?? data.now

  return {
    signedIn: !!auth.session,
    authLoading: auth.loading,
    accessDenied: data.accessDenied,
    now: data.now,
    stats: data.stats,
    statsDegraded: data.statsDegraded,
    pendingActions: data.pendingActions,
    pendingDegraded: data.pendingDegraded,
    runs: data.runs,
    runsDegraded: data.runsDegraded,
    events: data.events,
    eventsDegraded: data.eventsDegraded,
    cashCollections: data.cashCollections,
    pipelineHealth: data.pipelineHealth,
    slaBreaches: data.slaBreaches,
    readModelsDegraded: data.readModelsDegraded,
    slowLastSuccessMs: data.slowLastSuccessMs,
    slowLaneStaleAfterMs: SLOW_LANE_STALE_MS,
    degradedSinceMs,
  }
}

/**
 * Presentation-layer lane state that is explicitly NOT a fact about the business:
 * session-local sparkline history, the session's own new-pending counter, and the
 * slow lane's last-success timestamp used to fog the strip.
 *
 * These exist here for the same reason the selectors do — so that a panel never has
 * to import `useJarvis()` itself (§4.7) — but they are kept separate from
 * `SelectorInput` because none of them is a displayed fact and none of them carries
 * a `Truth`. `metricHistory` is a per-poll trend of numbers the session has actually
 * observed; it is drawn beside a value, never in place of one, and `Metric` drops it
 * along with the number whenever that number is not known.
 */
export interface LanePresentation {
  now: number
  metricHistory: Record<string, number[]>
  newPendingSinceOpen: number
  slowLastSuccessMs: number | null
  /** Transport health, not a business fact: when the last poll landed and how long
   *  it took. Rendered as "synced 3s ago · 210ms", never as a number about the
   *  business. */
  lastPollAtMs: number | null
  apiLatencyMs: number | null
  /** This tenant's integration/config posture. `setupDegraded` already drives an
   *  honest "Standalone" label rather than a fabricated "Optimal". */
  setupStatus: SetupStatus | null
  setupDegraded: boolean
  integrationsStatus: IntegrationsStatus | null
  integrationsDegraded: boolean
}

export function useLanePresentation(): LanePresentation {
  const data = useJarvis()
  return {
    now: data.now,
    metricHistory: data.metricHistory,
    newPendingSinceOpen: data.newPendingSinceOpen,
    slowLastSuccessMs: data.slowLastSuccessMs,
    lastPollAtMs: data.lastPollAtMs,
    apiLatencyMs: data.apiLatencyMs,
    setupStatus: data.setupStatus,
    setupDegraded: data.setupDegraded,
    integrationsStatus: data.integrationsStatus,
    integrationsDegraded: data.integrationsDegraded,
  }
}
