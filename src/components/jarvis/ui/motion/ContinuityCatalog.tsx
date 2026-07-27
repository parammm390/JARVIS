"use client"

// F7.T1/T2 — FLOW-94..97 (Band F7 — Continuity) demoed on the Stage, same FlowCard
// chrome convention as the other band catalogs. RouteHandoff (94) is real navigation
// machinery (src/app/jarvis/template.tsx) that can't be triggered by clicking a
// button on this page without actually navigating — the demo below replays the
// SAME choreo.routeHandoff preset the real veil uses, honestly labeled as a replay,
// not a live route change. DrawerToPage/ListToDetail/BackTrace (95-97) are demoed
// with a small fixture list + fixture "receipt" card reusing the SAME shared-
// layoutId + choreo.cameraPan/backTrace mechanism bridge/Bridge.tsx's real
// ReceiptScene uses — labeled FIXTURE data (Stage has no signed-in session to fetch
// a real receipt through, the standing no-test-creds limitation every prior phase
// carries), real choreography.

import { useState } from "react"
import { AnimatePresence, motion, type TargetAndTransition } from "framer-motion"
import { FlowCard, ReplayButton } from "./FlowCard"
import { choreo } from "./choreo"

function DemoStack({ children }: { children: React.ReactNode }) {
  return <div className="flex w-full flex-col items-center gap-2">{children}</div>
}

function RouteHandoffDemo() {
  const [playing, setPlaying] = useState(false)
  return (
    <FlowCard id="FLOW-94" title="RouteHandoff" reducedFallback="instant fade, no wipe">
      <DemoStack>
        <div className="relative h-16 w-full overflow-hidden rounded-lg border border-white/10 bg-[#070d1a]">
          <div className="flex h-full items-center justify-center text-[10px] text-white/40">/jarvis/* route</div>
          <AnimatePresence>
            {playing && (
              <motion.div
                aria-hidden
                className="absolute inset-0"
                variants={choreo.routeHandoff.variants}
                initial="initial"
                animate="animate"
                exit={{ opacity: 0 }}
                onAnimationComplete={() => setPlaying(false)}
                style={{ background: "linear-gradient(180deg, rgba(8,14,24,0.94) 0%, rgba(8,14,24,0.55) 100%)" }}
              />
            )}
          </AnimatePresence>
        </div>
        <ReplayButton onClick={() => setPlaying(true)} />
        <p className="text-[9px] text-white/30">The real one is src/app/jarvis/template.tsx&apos;s veil, replaying this exact choreo.routeHandoff preset on every genuine /jarvis/* client-side navigation (skipped on cold load — that&apos;s FLOW-44 BridgeBoot&apos;s moment instead).</p>
      </DemoStack>
    </FlowCard>
  )
}

interface FixtureRow {
  id: string
  label: string
}
const FIXTURE_ROWS: FixtureRow[] = [
  { id: "row-a", label: "confirm_appointment — FIXTURE" },
  { id: "row-b", label: "send_invoice — FIXTURE" },
]

function ContinuityFlowDemo() {
  const [openId, setOpenId] = useState<string | null>(null)
  const [prevWasOpen, setPrevWasOpen] = useState(false)
  const activeKey = openId ?? "list"
  const returning = prevWasOpen && !openId
  const enterChoreo = openId ? choreo.cameraPan : returning ? choreo.backTrace : choreo.cameraPan
  const open = (id: string) => {
    setPrevWasOpen(false)
    setOpenId(id)
  }
  const back = () => {
    setPrevWasOpen(true)
    setOpenId(null)
  }
  return (
    <>
      <FlowCard id="FLOW-96" title="ListToDetail" reducedFallback="navigate, no shared-element flight">
        <DemoStack>
          <div className="relative h-24 w-full overflow-hidden rounded-lg border border-white/10 bg-[#070d1a] p-2">
            <AnimatePresence mode="wait">
              <motion.div
                key={activeKey}
                variants={enterChoreo.variants}
                initial="initial"
                animate="animate"
                exit={{ opacity: 0 }}
                className="space-y-1.5"
              >
                {!openId &&
                  FIXTURE_ROWS.map((row) => (
                    <button
                      key={row.id}
                      type="button"
                      onClick={() => open(row.id)}
                      className="flex w-full items-center gap-2 rounded-md border border-white/6 bg-white/[0.02] px-2 py-1 text-left text-[10px] text-white/70 hover:bg-white/[0.05]"
                    >
                      <motion.span layoutId={`stage-receipt-dot-${row.id}`} className="h-1.5 w-1.5 shrink-0 rounded-full bg-cyan-400" />
                      {row.label}
                    </button>
                  ))}
                {openId && (
                  <div className="space-y-1.5">
                    <button type="button" onClick={back} className="text-[10px] font-bold text-cyan-300">
                      ← Back
                    </button>
                    <motion.div layoutId={`stage-receipt-dot-${openId}`} className="flex items-center gap-2 rounded-md border border-cyan-300/30 bg-cyan-300/[0.06] px-2 py-1.5">
                      <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-cyan-400" />
                      <span className="text-[10px] font-bold text-white/85">{FIXTURE_ROWS.find((r) => r.id === openId)?.label} — receipt scene</span>
                    </motion.div>
                  </div>
                )}
              </motion.div>
            </AnimatePresence>
          </div>
          <p className="text-[9px] text-white/30">FIXTURE list — the real one is ActivityTheater&apos;s row dot flying into Bridge.tsx&apos;s ReceiptScene header via the same shared layoutId mechanism.</p>
        </DemoStack>
      </FlowCard>
      <FlowCard id="FLOW-95" title="DrawerToPage" reducedFallback="plain navigate, no morph">
        <DemoStack>
          <p className="text-[10px] text-white/50">Same demo card above — opening a row swaps this panel&apos;s content in place (center-stage, not a side drawer), same mechanism Bridge.tsx&apos;s CenterStage uses for the real receipt scene.</p>
        </DemoStack>
      </FlowCard>
      <FlowCard id="FLOW-97" title="BackTrace" reducedFallback="plain navigate back, no mirrored transform">
        <DemoStack>
          <p className="text-[10px] text-white/50">Click ← Back above — the return trip uses choreo.backTrace (CameraPan&apos;s own forward transform, mirrored), tracked by a real previous-key ref, not a hardcoded guess.</p>
        </DemoStack>
      </FlowCard>
    </>
  )
}

export function ContinuityCatalogSection() {
  return (
    <section className="j-panel space-y-3 p-5" data-flow-band="F7">
      <div className="mb-1 flex items-center justify-between">
        <h2 className="j-label">F7 — Continuity (FLOW-94..97)</h2>
        <span className="j-chip bg-cyan-400/12 text-cyan-300">4 entries</span>
      </div>
      <p className="text-[11px] text-[color:var(--j-text-dim)]">
        RouteHandoff replays the real navigation veil&apos;s exact choreo preset (honest replay, not a live route change). ListToDetail/
        DrawerToPage/BackTrace share one fixture demo below driving the same shared-layoutId + mirrored-transform mechanism
        bridge/Bridge.tsx&apos;s real ReceiptScene uses for ActivityTheater&apos;s rows.
      </p>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <RouteHandoffDemo />
        <ContinuityFlowDemo />
      </div>
    </section>
  )
}
