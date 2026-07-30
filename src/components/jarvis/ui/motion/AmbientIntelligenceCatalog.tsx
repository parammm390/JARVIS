"use client"

// F10.T1 — FLOW-98..100 (Band F10 — Ambient Intelligence), demoed on Stage with
// the SAME real, exported production code every prior band's catalog reuses (not
// Stage-only lookalikes): `SinceYouWereAwayView` (the pure view F10.T1 extracted
// from `SinceYouWereAway.tsx` so it can be driven by FIXTURE digest+pending data
// here, since Stage has no signed-in session to fetch a real digest through — the
// standing no-test-creds limitation every prior F-phase has carried), the real
// `frecencyWarmth`/`frecencyGlowStyle` pair `bridge/Bridge.tsx`'s LeftRail nav
// actually calls, and the real `isQuietNow` + `ConsoleAtmosphere`'s real `slow`
// prop.

import { useState } from "react"
import { SinceYouWereAwayView } from "../../SinceYouWereAway"
import type { PendingAction } from "../../lib/data-core"
import { frecencyWarmth, frecencyGlowStyle } from "../../lib/frecency-glow"
import type { FrecencyLedger } from "../../lib/frecency"
import { isQuietNow } from "../../lib/quiet-hours"
import { ConsoleAtmosphere } from "../../atmosphere"
import { FlowCard } from "./FlowCard"

// One item genuinely correlates to a still-open pending action (so the real
// ActionRenderer mini-scene mounts) and one deliberately doesn't (already
// decided, or a session that hasn't loaded the queue) — demoing FLOW-98's own
// graceful-absent fallback to the plain chip, not just its happy path.
const FIXTURE_DIGEST = {
  firstVisit: false,
  greeting: "Welcome back. 2 planned actions changed since you last checked.",
  newActions: 2,
  pendingActions: 1,
  top: [
    { id: "f10-fixture-pending", actionType: "schedule_water_test", summary: null },
    { id: "f10-fixture-decided", actionType: "reschedule_visit", summary: "Rescheduled Thu visit → Fri 9am" },
  ],
}
const FIXTURE_PENDING: PendingAction[] = [
  { id: "f10-fixture-pending", actionType: "schedule_water_test", summary: null, payload: { householdId: "hh-1", proposedDate: "2026-07-29", testType: "annual" }, status: "pending", createdAt: new Date(0).toISOString() },
]

// Real store shape, hand-authored scores spanning cold/warm so the same
// `frecencyWarmth` function bridge/Bridge.tsx calls visibly produces "no tint" at
// one end and a real warm border at the other — not an invented gradient.
const FIXTURE_LEDGER: FrecencyLedger = {
  overview: { visits: 41, lastOpenedAt: 0 },
  pipeline: { visits: 3, lastOpenedAt: 0 },
}

function FrecencyGlowDemo() {
  const now = 7 * 24 * 60 * 60 * 1000 // exactly one half-life after lastOpenedAt=0 — deterministic, not Date.now()
  return (
    <div className="flex gap-2">
      {(Object.keys(FIXTURE_LEDGER) as Array<keyof typeof FIXTURE_LEDGER>).map((id) => {
        const warmth = frecencyWarmth(id, FIXTURE_LEDGER, now)
        return (
          <div key={id} style={frecencyGlowStyle(warmth)} className="rounded-xl border border-transparent px-3 py-2 j-fs-micro font-bold text-[color:var(--j-text-dim)]">
            {id} <span className="j-fs-micro font-normal text-white/40">warmth {warmth.toFixed(2)}</span>
          </div>
        )
      })}
    </div>
  )
}

function QuietHoursDemo() {
  const [quiet, setQuiet] = useState(false)
  // Real function, fixture clock: 23:00 against a configured 22:00→06:00 window
  // proves the real overnight-wrap branch, not just the simple same-day case.
  const proof = isQuietNow("22:00", "06:00", new Date(2026, 0, 1, 23, 0))
  return (
    <div className="w-full space-y-2">
      <div className="relative h-24 overflow-hidden rounded-xl border border-white/8">
        <ConsoleAtmosphere slow={quiet} />
      </div>
      <button
        type="button"
        onClick={() => setQuiet((v) => !v)}
        className="j-chip border border-white/10 bg-white/[.035] text-[color:var(--j-text-dim)]"
      >
        {quiet ? "Quiet hours: on (ambient slowed 1.6×)" : "Quiet hours: off"}
      </button>
      <p className="j-fs-micro text-white/40">isQuietNow(&quot;22:00&quot;,&quot;06:00&quot;, 23:00) = {String(proof)} (real overnight-wrap math)</p>
    </div>
  )
}

export function AmbientIntelligenceCatalogSection() {
  const [skipped, setSkipped] = useState(false)
  return (
    <section className="j-panel space-y-3 p-5" data-flow-band="F10">
      <div className="mb-1 flex items-center justify-between">
        <h2 className="j-label">F10 — Ambient Intelligence (FLOW-98..100)</h2>
        <span className="j-chip bg-cyan-400/12 text-cyan-300">3 entries</span>
      </div>
      <p className="j-fs-micro text-[color:var(--j-text-dim)]">
        Built against main D6&apos;s real shipped prefs/frecency/digest surfaces with D6&apos;s own exit-gate physical-push proof
        still open — a disclosed deviation (Param waived the gate; see F-STATE). Every demo below is the real production
        component/function, FIXTURE-driven only because Stage has no signed-in session.
      </p>
      <div className="grid grid-cols-1 gap-2 lg:grid-cols-3">
        <FlowCard id="FLOW-98" title="GreetingCurrent" reducedFallback="text only, no DecryptText scramble, mini-scenes appear at once (no cascade)">
          <div className="w-full">
            <SinceYouWereAwayView digest={FIXTURE_DIGEST} pendingActions={FIXTURE_PENDING} skipped={skipped} onSkip={() => setSkipped(true)} />
          </div>
        </FlowCard>
        <FlowCard id="FLOW-99" title="FrecencyGlow" reducedFallback="no tint">
          <FrecencyGlowDemo />
        </FlowCard>
        <FlowCard id="FLOW-100" title="QuietHours" reducedFallback="label only, ambient speed unchanged">
          <QuietHoursDemo />
        </FlowCard>
      </div>
    </section>
  )
}
