"use client"

// The Instruction Thread — top-level page (plan v3 §2.2/§6⓪, P2.T5).
//
// Mounts the kernel (which itself mounts JarvisAuthProvider/JarvisDataProvider —
// §4.1, the kernel wraps data-core, never replaces it) and gates on owner role.
// `VapiSessionProvider` is already mounted once at `src/app/jarvis/layout.tsx`
// for the whole /jarvis section — this page does not remount it.

import { useEffect, useState } from "react"
import { useReducedMotion } from "framer-motion"
import "../jarvis-theme.css"
import { KernelProvider, useKernel, type Thread as ThreadData } from "../kernel/store"
import { useJarvisAuth } from "../lib/jarvis-auth"
import { useVapiSession } from "../lib/useVapiSession"
import { Orb3D } from "./Orb3D"
import { ThreadField } from "./ThreadField"
import { Thread } from "./Thread"
import { ThreadApprovalCockpit } from "./ThreadBlocks"
import { CommandRail } from "./CommandRail"
import { ReceiptContent } from "../lib/ReceiptDrawer"
import { derivePresence } from "../kernel/presence"
import { THREAD_FIXTURES, FIXTURE_STATE_KEYS } from "./thread-fixtures"
import type { Truth } from "../kernel/types"

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
      <p className="max-w-sm text-[12px] text-[color:var(--j-text-dim)]">The Instruction Thread works with real vitals, real approvals, and real execution for your own tenant.</p>
      <a href="/jarvis/login" className="rounded-full bg-teal-300 px-4 py-1.5 text-[11px] font-black text-slate-950 hover:bg-teal-200">
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
  presence,
  overdueInvoices,
  activeRunCount,
  reducedMotion,
  onCancel,
  onAnswer,
  onSkip,
  showRail,
  fixtureLabel,
}: {
  thread: ThreadData | null
  presence: ReturnType<typeof derivePresence>
  overdueInvoices: Truth<{ count: number; totalUsd: number }>
  activeRunCount: number
  reducedMotion: boolean
  onCancel: () => void
  onAnswer: (text: string) => void
  onSkip: () => void
  showRail: boolean
  fixtureLabel?: string
}) {
  const isApproving = thread?.machine.instructionState === "awaiting_approval"
  return (
    <div className="jarvis-root relative min-h-screen bg-[#04070f] text-[color:var(--j-text)]" data-jarvis-thread>
      {fixtureLabel && (
        <div className="fixed left-1/2 top-2 z-50 -translate-x-1/2">
          <span className="j-chip border border-violet-300/40 bg-violet-400/15 text-violet-200">FIXTURE · {fixtureLabel}</span>
        </div>
      )}
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
        <Orb3D live={{ state: presence, activeRunCount, voiceAmplitude: undefined }} />
      </div>
      <div className="relative z-[1]">
        {!thread && <RestPrompt />}
        {thread && <Thread thread={thread} onCancel={onCancel} onAnswer={onAnswer} onSkip={onSkip} />}
      </div>
      {isApproving && thread && <ThreadApprovalCockpit thread={thread} onClose={() => {}} reducedMotion={reducedMotion} />}
      {showRail && <CommandRail />}
    </div>
  )
}

function ThreadPage() {
  const kernel = useKernel()
  const voice = useVapiSession()
  const reducedMotion = useReducedMotion() ?? false
  const [standaloneReceiptId, setStandaloneReceiptId] = useState<string | null>(null)

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
      presence={kernel.presence}
      overdueInvoices={kernel.overdueInvoices}
      activeRunCount={kernel.selectorInput.runs.length}
      reducedMotion={reducedMotion}
      onCancel={kernel.cancelThread}
      onAnswer={kernel.answerClarification}
      onSkip={kernel.cancelThread}
      showRail
    />
  )
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
  const thread = THREAD_FIXTURES[fixtureKey]
  if (!thread) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#04070f] text-center text-white">
        Unknown fixture &ldquo;{fixtureKey}&rdquo;. Known: {FIXTURE_STATE_KEYS.join(", ")}
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
  if (!auth.session) return <SignInGate />
  if (auth.role !== null && auth.role !== "owner") return <NotOwnerGate />
  return <ThreadPage />
}

export function Bridge() {
  return (
    <KernelProvider>
      <ThreadGate />
    </KernelProvider>
  )
}
