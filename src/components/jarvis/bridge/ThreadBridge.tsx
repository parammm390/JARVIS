"use client"

// The Instruction Thread — top-level page (plan v3 §2.2/§6⓪, P2.T5).
//
// Mounts the kernel (which itself mounts JarvisAuthProvider/JarvisDataProvider —
// §4.1, the kernel wraps data-core, never replaces it) and gates on owner role.
// `VapiSessionProvider` is already mounted once at `src/app/jarvis/layout.tsx`
// for the whole /jarvis section — this page does not remount it.

import { useEffect, useRef, useState } from "react"
import dynamic from "next/dynamic"
import { useReducedMotion } from "framer-motion"
import "../jarvis-theme.css"
import { KernelProvider, useKernel, type Thread as ThreadData } from "../kernel/store"
import { useJarvisAuth } from "../lib/jarvis-auth"
import { useVapiSession } from "../lib/useVapiSession"
import { ThreadField } from "./ThreadField"
import { ThreadStack } from "./ThreadStack"
import { ThreadApprovalCockpit } from "./ThreadBlocks"
import { CommandRail } from "./CommandRail"
import { FirstRunScene } from "./FirstRunScene"
import { ModeChip } from "./ModeChip"
import { DispatchMap } from "../panels/DispatchMap"
import { MyDay } from "../panels/MyDay"
import type { JarvisRole } from "../lib/jarvis-auth"
import { derivePresence } from "../kernel/presence"
import { D3_LONG_EXECUTION_MS, D3_NARRATION_TEXT, shouldFireD3Narration } from "../lib/d3-narration"
import type { Truth } from "../kernel/types"
import type { OrbLiveState } from "./Orb3D"

type OrbComponent = (props: { live: OrbLiveState; forceLowPower?: boolean }) => JSX.Element

const ReceiptContent = dynamic(() => import("../lib/ReceiptDrawer").then((m) => m.ReceiptContent), { ssr: false })

// Three.js is only needed after the Thread has mounted. A native import here,
// rather than next/dynamic, intentionally avoids preloading the renderer as an
// initial-route dependency; the original Orb also initialized only after mount.
function DeferredOrb({ live }: { live: OrbLiveState }) {
  const [Orb, setOrb] = useState<OrbComponent | null>(null)
  useEffect(() => {
    let active = true
    void import("./Orb3D").then(({ Orb3D }) => {
      if (active) setOrb(() => Orb3D)
    })
    return () => { active = false }
  }, [])
  return Orb ? <Orb live={live} /> : null
}

function LoadingGate() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-[#04070f]">
      <div className="flex items-center gap-3 text-lg font-black tracking-tight text-white">
        <span className="flex h-9 w-9 animate-pulse items-center justify-center rounded-xl bg-cyan-400/20 text-xs font-black text-cyan-200 shadow-lg">F</span>
        Waking JARVIS…
      </div>
    </div>
  )
}

function SignInGate() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-[#04070f] px-6 text-center">
      <h1 className="text-lg font-black text-white">Sign in required</h1>
      <p className="max-w-sm j-fs-sm text-[color:var(--j-text-dim)]">The Instruction Thread works with real vitals, real approvals, and real execution for your own tenant.</p>
      <a href="/jarvis/login" className="rounded-full bg-teal-300 px-4 py-1.5 j-fs-micro font-black text-slate-950 hover:bg-teal-200">
        Sign in
      </a>
    </div>
  )
}

function NotOwnerGate() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-[#04070f] px-6 text-center">
      <h1 className="text-lg font-black text-white">This view is for owners right now</h1>
      <a href="/jarvis" className="j-fs-sm text-cyan-200 underline">
        Back to JARVIS
      </a>
    </div>
  )
}

function StandaloneReceiptView({ receiptId, onBack }: { receiptId: string; onBack: () => void }) {
  // T11: "the whole receipt is addressable at /jarvis/next#receipt-{id} and
  // survives refresh". A receipt is a real, fetch-by-id backend record — this
  // renders it directly, with no live thread required, which is what actually
  // makes a reload survivable (the ephemeral in-memory Thread does not persist
  // across a reload until P3's instruction_sessions ships; the RECEIPT itself,
  // being real stored data, already can).
  return (
    <div className="mx-auto max-w-[720px] px-4 pb-40 pt-24">
      <button type="button" onClick={onBack} className="j-chip mb-3 border border-white/10 bg-white/[.035] text-[color:var(--j-text-dim)]">
        ← Back
      </button>
      <div className="j-panel rounded-xl border border-white/10 p-4">
        <ReceiptContent receiptId={receiptId} />
      </div>
    </div>
  )
}

function RestPrompt() {
  const kernel = useKernel()
  const overdue = kernel.overdueInvoices
  const pending = kernel.pendingApprovals
  const segments: string[] = []
  if (overdue.status === "known" || overdue.status === "stale") {
    segments.push(`${overdue.value.count} invoice${overdue.value.count === 1 ? "" : "s"} overdue · $${overdue.value.totalUsd.toLocaleString("en-US")}`)
  }
  if (pending.status === "known" || pending.status === "stale" || pending.status === "partial") {
    segments.push(`${pending.value} approval${pending.value === 1 ? "" : "s"} waiting`)
  }
  const errored = overdue.status === "unavailable"
  return (
    <div className="flex min-h-[38vh] flex-col items-center justify-center px-4 text-center">
      <p className="j-fs-lg font-bold text-[color:var(--j-text)]">Tell JARVIS what you need.</p>
      {errored ? (
        <p className="j-fs-sm mt-2 text-[color:var(--j-red)]">Can&rsquo;t reach JARVIS. <button type="button" className="underline">Retry</button></p>
      ) : (
        segments.length > 0 && <p className="j-fs-sm mt-2 text-[color:var(--j-text-dim)]">{segments.join(" · ")}</p>
      )}
    </div>
  )
}

/** Shared visual body — Field + Orb + Thread + (approval) Cockpit + Rail. Both
 *  the real, live page and the dev-only fixture harness below render through
 *  this SAME function, so a fixture screenshot is evidence about the real
 *  component tree, not a separate mock of it. `showRail` is false in fixture
 *  mode — the rail submits real instructions via the real kernel, which a
 *  fixture thread has no backing kernel state for. */
function ThreadBody({
  thread,
  threadHistory,
  presence,
  overdueInvoices,
  activeRunCount,
  reducedMotion,
  onCancel,
  onAnswer,
  onSkip,
  showRail,
  fixtureLabel,
  role = "owner",
  mode = "production",
}: {
  thread: ThreadData | null
  threadHistory: ThreadData[]
  presence: ReturnType<typeof derivePresence>
  overdueInvoices: Truth<{ count: number; totalUsd: number }>
  activeRunCount: number
  reducedMotion: boolean
  onCancel: () => void
  onAnswer: (text: string) => void
  onSkip: () => void
  showRail: boolean
  fixtureLabel?: string
  role?: JarvisRole
  mode?: "production" | "showcase" | "preview"
}) {
  const isApproving = role !== "technician" && thread?.machine.instructionState === "awaiting_approval"
  return (
    <div className="jarvis-root relative min-h-screen bg-[#04070f] text-[color:var(--j-text)]" data-jarvis-thread data-source={fixtureLabel ? "fixture" : undefined}>
      {fixtureLabel && (
        <div className="fixed left-1/2 top-2 z-50 -translate-x-1/2">
          <span className="j-chip border border-violet-300/40 bg-violet-400/15 text-violet-200">FIXTURE · {fixtureLabel}</span>
        </div>
      )}
      <div className="fixed right-4 top-4 z-20"><ModeChip mode={mode} /></div>
      <ThreadField overdueInvoices={overdueInvoices} />
      {/* §6⓪: desktop docks the Orb top-left of the thread (64px); mobile docks
          it 44px, above the rail, so it never overlaps the (here, full-width)
          thread column the way a top-left fixed position would at narrow
          widths. `isApproving`'s reposition-to-the-cockpit-corner (§6⑤: "it
          moves... docks to the cockpit's top-left") is desktop-only — the
          cockpit is a full-width bottom sheet on mobile (§6⑤ Mobile), so
          there's no "corner" to dock to there. */}
      <div
        className={`fixed z-10 h-11 w-11 bottom-24 left-1/2 -translate-x-1/2 lg:h-16 lg:w-16 lg:bottom-auto lg:translate-x-0 ${
          isApproving ? "lg:left-auto lg:top-24 lg:right-[calc(50%+380px)]" : "lg:left-6 lg:top-24"
        }`}
      >
        <DeferredOrb live={{ state: presence, activeRunCount, voiceAmplitude: undefined }} />
      </div>
      <div className="relative z-[1]">
        {role === "owner" && <FirstRunScene />}
        {role === "technician" ? (
          <main className="mx-auto max-w-lg px-4 pb-32 pt-8"><MyDay /></main>
        ) : (
          <>
            {!thread && <RestPrompt />}
            {thread && <ThreadStack thread={thread} threadHistory={threadHistory} onCancel={onCancel} onAnswer={onAnswer} onSkip={onSkip} />}
            {role === "dispatcher" && <aside className="mx-auto max-w-[720px] px-4 pb-32"><DispatchMap /></aside>}
          </>
        )}
      </div>
      {isApproving && thread && <ThreadApprovalCockpit thread={thread} onClose={() => {}} reducedMotion={reducedMotion} escalateOnly={role === "dispatcher"} />}
      {showRail && <CommandRail />}
    </div>
  )
}

// jarvis-v3 P5.T7 — D3 pilot: "while a long action runs, JARVIS may narrate
// once via say. Best-effort." §6⑥'s own "silent during execution — do not
// narrate STEPS" forbids per-step chatter, not a single, content-free
// check-in — the decision/content details live in `lib/d3-narration.ts`
// (pure, unit-tested; BLOCKER B-1 means this effect itself cannot be).
function ThreadPage({ role }: { role: JarvisRole }) {
  const kernel = useKernel()
  const voice = useVapiSession()
  const reducedMotion = useReducedMotion() ?? false
  const [standaloneReceiptId, setStandaloneReceiptId] = useState<string | null>(null)
  const executingNarratedThreadIdRef = useRef<string | null>(null)

  useEffect(() => {
    const match = window.location.hash.match(/^#receipt-([0-9a-fA-F-]{36})$/)
    if (match) setStandaloneReceiptId(match[1]!)
  }, [])

  useEffect(() => {
    // §3.4 point 4: JARVIS speaks the plan summary the instant it's ready, and
    // the outcome once the thread reaches its receipt — the only two moments it
    // speaks unprompted.
    const state = kernel.thread?.machine.instructionState
    if (!kernel.thread) return
    if (state === "awaiting_approval" && kernel.thread.nodes.length > 0) {
      const total = kernel.thread.nodes.reduce((sum, n) => (n.amountUsd !== null ? sum + n.amountUsd : sum), 0)
      voice.say(`I found ${kernel.thread.nodes.length} action${kernel.thread.nodes.length === 1 ? "" : "s"} totalling $${total.toLocaleString("en-US")}. Want me to go ahead?`)
    }
    if (state === "completed" || state === "partial") {
      const n = kernel.thread.nodes.length
      voice.say(state === "completed" ? `${n} of ${n} done. I'll tell you as anything changes.` : `Some of that went through. I'll show you exactly which.`)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kernel.thread?.machine.instructionState])

  // jarvis-v3 P5.T7 — D3 pilot (see D3_LONG_EXECUTION_MS's own header
  // comment for why this is content-free and one-shot). Separate effect from
  // the plan/outcome narration above: this one needs a real elapsed-time
  // trigger, not a state-transition edge.
  useEffect(() => {
    const thread = kernel.thread
    if (!shouldFireD3Narration(thread?.id, thread?.machine.instructionState, executingNarratedThreadIdRef.current)) return
    const timer = window.setTimeout(() => {
      executingNarratedThreadIdRef.current = thread!.id
      voice.say(D3_NARRATION_TEXT)
    }, D3_LONG_EXECUTION_MS)
    return () => window.clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kernel.thread?.id, kernel.thread?.machine.instructionState])

  if (standaloneReceiptId) {
    return (
      <StandaloneReceiptView
        receiptId={standaloneReceiptId}
        onBack={() => {
          setStandaloneReceiptId(null)
          window.history.replaceState(null, "", window.location.pathname)
        }}
      />
    )
  }

  return (
    <ThreadBody
      thread={kernel.thread}
      threadHistory={kernel.threadHistory}
      presence={kernel.presence}
      overdueInvoices={kernel.overdueInvoices}
      activeRunCount={kernel.selectorInput.runs.length}
      reducedMotion={reducedMotion}
      onCancel={kernel.cancelThread}
      onAnswer={kernel.answerClarification}
      onSkip={kernel.cancelThread}
      showRail
      role={role}
      mode={kernel.mode}
    />
  )
}

function PreviewThread() {
  const kernel = useKernel()
  const reducedMotion = useReducedMotion() ?? false
  return <><ThreadBody thread={null} threadHistory={[]} presence={kernel.presence} overdueInvoices={kernel.overdueInvoices} activeRunCount={0} reducedMotion={reducedMotion} onCancel={() => {}} onAnswer={() => {}} onSkip={() => {}} showRail={false} mode={kernel.mode} /><a href="/jarvis/login" className="fixed bottom-6 left-1/2 z-30 -translate-x-1/2 rounded-full bg-teal-300 px-4 py-2 j-fs-sm font-black text-slate-950">Sign in</a></>
}

// ---------------------------------------------------------------------------
// P2 exit-gate evidence harness — see thread-fixtures.ts's own header for why
// this exists and what it can and cannot prove. `NODE_ENV !== "production"` is
// the ONLY gate (no owner/session check), by design: the whole point is to be
// reachable without the credentials this environment does not have. This can
// never reach a production build regardless of query string.
// ---------------------------------------------------------------------------
function ThreadFixtureHarness({ fixtureKey }: { fixtureKey: string }) {
  const reducedMotion = useReducedMotion() ?? false
  const [fixture, setFixture] = useState<{ thread: ThreadData | undefined; history: ThreadData[]; keys: string[] } | null>(null)

  useEffect(() => {
    let active = true
    void import("./thread-fixtures").then(({ THREAD_FIXTURES, THREAD_HISTORY_FIXTURES, FIXTURE_STATE_KEYS }) => {
      if (!active) return
      setFixture({
        thread: THREAD_FIXTURES[fixtureKey],
        history: THREAD_HISTORY_FIXTURES[fixtureKey] ?? [],
        keys: FIXTURE_STATE_KEYS,
      })
    })
    return () => { active = false }
  }, [fixtureKey])

  if (!fixture) return null
  const { thread } = fixture
  if (!thread) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#04070f] text-center text-white">
        Unknown fixture &ldquo;{fixtureKey}&rdquo;. Known: {fixture.keys.join(", ")}
      </div>
    )
  }
  const presence = derivePresence({
    transport: "polling",
    activeInstructionState: thread.machine.instructionState,
    terminalDecayActive: true,
    voiceSpeaking: false,
    micOpen: false,
    blockedCount: 0,
    needsHumanReviewCount: 0,
  })
  return (
    <ThreadBody
      thread={thread}
      threadHistory={fixture.history}
      presence={presence}
      overdueInvoices={{ status: "known", value: { count: 6, totalUsd: 4200 }, source: "fixture", atMs: 0 }}
      activeRunCount={thread.machine.instructionState === "executing" ? thread.nodes.length : 0}
      reducedMotion={reducedMotion}
      onCancel={() => {}}
      onAnswer={() => {}}
      onSkip={() => {}}
      showRail={false}
      fixtureLabel={fixtureKey}
    />
  )
}

function ThreadGate() {
  const auth = useJarvisAuth()
  const [fixtureKey, setFixtureKey] = useState<string | null | undefined>(undefined)

  useEffect(() => {
    if (process.env.NODE_ENV === "production") {
      setFixtureKey(null)
      return
    }
    setFixtureKey(new URLSearchParams(window.location.search).get("fixture"))
  }, [])

  if (fixtureKey === undefined) return null // avoid a hydration flash either way
  if (fixtureKey) return <ThreadFixtureHarness fixtureKey={fixtureKey} />

  if (auth.loading) return <LoadingGate />
  if (!auth.session) return <PreviewThread />
  if (auth.role === null) return <LoadingGate />
  return <ThreadPage role={auth.role} />
}

export function Bridge() {
  return (
    <KernelProvider>
      <ThreadGate />
    </KernelProvider>
  )
}
