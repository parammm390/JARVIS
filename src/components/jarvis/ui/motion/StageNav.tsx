"use client"

// F1.T3 — Stage 2.0 infrastructure: sticky section nav + per-section mount toggles
// (so a session can isolate FPS to one section instead of the whole page's worst
// case) + a fixture-state switcher (normal/loading/error/empty) that future F6 State
// Narrative entries (FLOW-88..93) plug real dioramas into — today it drives a single
// representative demo panel using the EmptyState/ErrorState/SkeletonCard primitives
// that already exist, honestly labeled as a fixture, not yet bound to real lane state.

import { useState, type ReactNode } from "react"
import { EmptyState } from "../primitives/EmptyState"
import { ErrorState } from "../primitives/ErrorState"
import { PermissionVeil } from "../primitives/PermissionVeil"
import { StaleFog } from "../primitives/StaleFog"
import { SkeletonCard } from "../primitives/Skeletons"

export const STAGE_SECTIONS = [
  { id: "flow-index", label: "Catalog" },
  { id: "live-query", label: "LiveQuery" },
  { id: "flow-grammar", label: "F1 Grammar" },
  { id: "flow-command-surface", label: "F2 Command Surface" },
  { id: "flow-decision-theater", label: "F3 Decision Theater" },
  { id: "flow-pipeline-theater", label: "F8 Pipeline Theater" },
  { id: "flow-dataviz", label: "F5 Data-Viz" },
  { id: "flow-state-narratives", label: "F6 State Narratives" },
  { id: "flow-continuity", label: "F7 Continuity" },
  { id: "flow-core", label: "FLOW-01..13" },
  { id: "flow-ambient", label: "FLOW-14..25" },
  { id: "fx-toolkit", label: "FX" },
  { id: "primitives", label: "Primitives" },
  { id: "renderers", label: "Renderers" },
] as const

export function StageStickyNav() {
  return (
    <nav className="j-scroll sticky top-0 z-20 -mx-6 mb-2 flex gap-1.5 overflow-x-auto border-b border-white/8 bg-[color:var(--j-bg)]/92 px-6 py-2 backdrop-blur">
      {STAGE_SECTIONS.map((s) => (
        <a
          key={s.id}
          href={`#${s.id}`}
          className="j-chip shrink-0 border border-white/12 text-white/70 hover:text-cyan-200 focus-visible:outline-none"
        >
          {s.label}
        </a>
      ))}
    </nav>
  )
}

/** Per-section mount toggle: wraps a section so it can be hidden to isolate FPS
 * measurement to the sections still mounted (Playwright's per-surface isolation
 * convention, plan §0 verification toolkit). Defaults mounted — no behavior change
 * unless a session opts a section out. */
export function MountToggle({ id, label, children }: { id: string; label: string; children: ReactNode }) {
  const [mounted, setMounted] = useState(true)
  return (
    <div data-stage-section={id}>
      <div className="mb-1 flex items-center justify-end">
        <label className="flex items-center gap-1.5 text-[9px] font-bold uppercase tracking-wider text-[color:var(--j-text-faint)]">
          <input type="checkbox" checked={mounted} onChange={(e) => setMounted(e.target.checked)} />
          mount {label}
        </label>
      </div>
      {mounted ? children : <div className="rounded-xl border border-dashed border-white/10 p-4 text-center text-[10px] text-[color:var(--j-text-faint)]">unmounted — isolate FPS to other sections</div>}
    </div>
  )
}

type FixtureState = "normal" | "loading" | "error" | "empty" | "stale" | "veil"

// F6.T1/T2 — the six states below now drive the REAL FLOW-88..93 components (not
// look-alikes): EmptyState (FLOW-88 EmptyTerrarium, family diorama), ErrorState
// (FLOW-89 ErrorFracture, crack-seal-on-retry), StaleFog (FLOW-92, real fog+timestamp
// wrapper), PermissionVeil (FLOW-93). FirstRunTide (91) and OfflineDrift (90) are
// covered by their own dedicated demos in StateNarrativesCatalog.tsx instead (91 has
// no representative single-panel form; 90 is a whole-console mood change, not a
// per-panel state) — this switcher's job is the per-panel four-plus-two states a
// normal panel can actually be in.
export function StageStateSwitcher() {
  const [state, setState] = useState<FixtureState>("normal")
  return (
    <section className="j-panel space-y-3 p-5">
      <div className="mb-1 flex items-center justify-between">
        <h2 className="j-label">Stage 2.0 — fixture-state switcher</h2>
        <div className="flex flex-wrap gap-1">
          {(["normal", "loading", "error", "empty", "stale", "veil"] as const).map((s) => (
            <button
              key={s}
              onClick={() => setState(s)}
              className={`j-chip border ${state === s ? "border-cyan-400/50 bg-cyan-400/12 text-cyan-200" : "border-white/10 bg-white/[.02] text-[color:var(--j-text-dim)]"}`}
            >
              {s}
            </button>
          ))}
        </div>
      </div>
      <p className="text-[10.5px] text-[color:var(--j-text-dim)]">
        Drives a representative panel through the states every real panel can be in, using the SAME real FLOW-88..93 components production
        panels mount (ActivityTheater/PulseBar/ApprovalCockpit/KpiStrip) — not fixture look-alikes.
      </p>
      <div className="min-h-[110px]">
        {state === "normal" && (
          <div className="j-panel p-4 text-[11px] text-[color:var(--j-text)]">Representative panel content — 3 fixture rows loaded fine.</div>
        )}
        {state === "loading" && <SkeletonCard />}
        {state === "error" && <ErrorState message="Couldn't load (FIXTURE)" onRetry={() => setState("normal")} />}
        {state === "empty" && <EmptyState family="activity" title="No rows yet (FIXTURE)" description="Nothing to show for this fixture panel." actionLabel="Reset" onAction={() => setState("normal")} />}
        {state === "stale" && (
          <StaleFog ageMs={120_000} staleAfterMs={90_000}>
            <div className="j-panel p-4 text-[11px] text-[color:var(--j-text)]">Representative panel content — real data, just not refreshed recently (FIXTURE age).</div>
          </StaleFog>
        )}
        {state === "veil" && <PermissionVeil reason="Sign in to see this panel's real data (FIXTURE)." actionLabel="Sign in" actionHref="/jarvis/login" />}
      </div>
    </section>
  )
}
