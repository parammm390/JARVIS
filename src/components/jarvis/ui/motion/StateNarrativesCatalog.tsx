"use client"

// F6.T1/T2/T3 — FLOW-88..93 (Band F6 — State Narratives) demoed on the Stage, same
// FlowCard chrome convention as the other band catalogs. Every demo reuses the SAME
// real primitives ActivityTheater/PulseBar/ApprovalCockpit/KpiStrip mount
// (EmptyState/ErrorState/PermissionVeil/StaleFog) — no Stage-only lookalikes.
// FirstRunTide stays honestly FIXTURE-only: this codebase has no real "genuinely
// zero-row tenant" signal to key off (every seeded/real dealer already has rows),
// same graceful-absent category F5 already established for forecastBand/anomalies.

import { useState, type ReactNode } from "react"
import { motion } from "framer-motion"
import { FlowCard, ReplayButton } from "./FlowCard"
import { EmptyState } from "../primitives/EmptyState"
import { ErrorState } from "../primitives/ErrorState"
import { PermissionVeil } from "../primitives/PermissionVeil"
import { StaleFog } from "../primitives/StaleFog"

function DemoStack({ children }: { children: ReactNode }) {
  return <div className="flex w-full flex-col items-center gap-2">{children}</div>
}

function EmptyTerrariumDemo() {
  const [family, setFamily] = useState<"activity" | "approvals">("activity")
  return (
    <FlowCard id="FLOW-88" title="EmptyTerrarium" reducedFallback="static illustration + CTA, no breathing loop">
      <DemoStack>
        <EmptyState
          family={family}
          title={family === "activity" ? "No activity yet" : "Nothing needs you"}
          description={family === "activity" ? "The real one lives in ActivityTheater's empty feed." : "The real one lives in ApprovalCockpit's empty queue."}
          actionLabel="Switch family"
          onAction={() => setFamily((f) => (f === "activity" ? "approvals" : "activity"))}
        />
      </DemoStack>
    </FlowCard>
  )
}

function ErrorFractureDemo() {
  const [key, setKey] = useState(0)
  return (
    <FlowCard id="FLOW-89" title="ErrorFracture" reducedFallback="red border + retry, no crack/seal animation">
      <DemoStack>
        <ErrorState key={key} message="Couldn't load (FIXTURE)" onRetry={() => setKey((k) => k + 1)} />
        <p className="text-[9px] text-white/30">The real one is PulseBar&apos;s/ApprovalCockpit&apos;s own poll/decision-failure state — click Retry to watch the crack seal.</p>
      </DemoStack>
    </FlowCard>
  )
}

function OfflineDriftDemo() {
  const [degraded, setDegraded] = useState(false)
  return (
    <FlowCard id="FLOW-90" title="OfflineDrift" reducedFallback="static amber banner, no aurora-dim/relight sweep">
      <DemoStack>
        <div
          className="relative w-full rounded-lg border px-3 py-2 text-center text-[10px] font-bold transition-colors duration-500"
          style={{ borderColor: degraded ? "rgba(251,191,36,0.4)" : "rgba(34,211,238,0.3)", color: degraded ? "#fbbf24" : "#67e8f9" }}
        >
          {degraded ? "reconnecting — mood=standalone, aurora dimmed" : "live — mood=idle"}
        </div>
        <ReplayButton onClick={() => setDegraded((d) => !d)} />
        <p className="text-[9px] text-white/30">The real one is Bridge.tsx&apos;s root `data-mood`, driven by the real `statsDegraded` fast-lane signal — toggle above to see the language, not the live aurora (Stage doesn&apos;t mount ConsoleAtmosphere here).</p>
      </DemoStack>
    </FlowCard>
  )
}

function FirstRunTideDemo() {
  const [filled, setFilled] = useState(false)
  const cells = [0, 1, 2, 3, 4]
  return (
    <FlowCard id="FLOW-91" title="FirstRunTide" reducedFallback="plain render, no left-to-right fill">
      <DemoStack>
        <div className="flex gap-1.5">
          {cells.map((i) => (
            <motion.div
              key={i}
              className="h-8 w-6 rounded bg-cyan-400/30"
              initial={false}
              animate={{ opacity: filled ? 1 : 0.15 }}
              transition={{ duration: 0.4, delay: filled ? i * 0.12 : 0 }}
            />
          ))}
        </div>
        <ReplayButton onClick={() => setFilled((f) => !f)} />
        <p className="text-[9px] text-white/30">FIXTURE only — no real zero-row-tenant signal exists yet (every seeded/real dealer already has rows), same graceful-absent category as F5&apos;s forecastBand/anomalies.</p>
      </DemoStack>
    </FlowCard>
  )
}

function StaleFogDemo() {
  const [stale, setStale] = useState(false)
  return (
    <FlowCard id="FLOW-92" title="StaleFog" reducedFallback="timestamp chip only, no fog/desaturate">
      <DemoStack>
        <StaleFog ageMs={stale ? 120_000 : 5_000} staleAfterMs={90_000}>
          <div className="j-panel p-3 text-[11px] text-white/80">Representative read-model panel content.</div>
        </StaleFog>
        <ReplayButton onClick={() => setStale((s) => !s)} />
        <p className="text-[9px] text-white/30">The real one is KpiStrip, fogging by data-core&apos;s real `slowLastSuccessMs` vs `SLOW_LANE_STALE_MS` (3x the slow lane&apos;s own 30s cadence).</p>
      </DemoStack>
    </FlowCard>
  )
}

function PermissionVeilDemo() {
  return (
    <FlowCard id="FLOW-93" title="PermissionVeil" reducedFallback="static text, no frost/blur">
      <DemoStack>
        <PermissionVeil reason="Sign in for live vitals — real worker heartbeat, queue depth, and DLQ backlog for your own tenant." actionLabel="Sign in" actionHref="/jarvis/login" />
        <p className="text-[9px] text-white/30">The real one is ActivityTheater&apos;s/PulseBar&apos;s own `!session` guard — this is the exact same component and copy.</p>
      </DemoStack>
    </FlowCard>
  )
}

export function StateNarrativesCatalogSection() {
  return (
    <section className="j-panel space-y-3 p-5" data-flow-band="F6">
      <div className="mb-1 flex items-center justify-between">
        <h2 className="j-label">F6 — State Narratives (FLOW-88..93)</h2>
        <span className="j-chip bg-cyan-400/12 text-cyan-300">6 entries</span>
      </div>
      <p className="text-[11px] text-[color:var(--j-text-dim)]">
        Every demo below reuses the same real primitive ActivityTheater/PulseBar/ApprovalCockpit/KpiStrip mount — no Stage-only lookalikes.
        FirstRunTide is FIXTURE-labeled (no real zero-row-tenant signal exists); every other card is the exact component shipping in
        production today. Use the fixture-state switcher above to drive a representative panel through these same states.
      </p>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <EmptyTerrariumDemo />
        <ErrorFractureDemo />
        <OfflineDriftDemo />
        <FirstRunTideDemo />
        <StaleFogDemo />
        <PermissionVeilDemo />
      </div>
    </section>
  )
}
