"use client"

// The Instruction Thread — top-level page (plan v3 §2.2/§6⓪, P2.T5).
//
// Mounts the kernel (which itself mounts JarvisAuthProvider/JarvisDataProvider —
// §4.1, the kernel wraps data-core, never replaces it) and gates on owner role.
// `VapiSessionProvider` is already mounted once at `src/app/jarvis/layout.tsx`
// for the whole /jarvis section — this page does not remount it.

import { useEffect, useState } from "react"
import { useReducedMotion } from "framer-motion"
import { KernelProvider, useKernel } from "../kernel/store"
import { useJarvisAuth } from "../lib/jarvis-auth"
import { useVapiSession } from "../lib/useVapiSession"
import { Orb3D } from "./Orb3D"
import { ThreadField } from "./ThreadField"
import { Thread } from "./Thread"
import { ThreadApprovalCockpit } from "./ThreadBlocks"
import { CommandRail } from "./CommandRail"
import { ReceiptContent } from "../lib/ReceiptDrawer"

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

  const thread = kernel.thread
  const isApproving = thread?.machine.instructionState === "awaiting_approval"

  return (
    <div className="jarvis-root relative min-h-screen bg-[#04070f] text-[color:var(--j-text)]" data-jarvis-thread>
      <ThreadField overdueInvoices={kernel.overdueInvoices} />
      <div className="fixed left-6 top-24 z-10 h-16 w-16" style={isApproving ? { left: "auto", right: "calc(50% + 380px)" } : undefined}>
        <Orb3D live={{ state: kernel.presence, activeRunCount: kernel.selectorInput.runs.length, voiceAmplitude: undefined }} />
      </div>
      <div className="relative z-[1]">
        {!thread && <RestPrompt />}
        {thread && (
          <Thread
            thread={thread}
            onCancel={kernel.cancelThread}
            onAnswer={kernel.answerClarification}
            onSkip={kernel.cancelThread}
          />
        )}
      </div>
      {isApproving && thread && <ThreadApprovalCockpit thread={thread} onClose={() => {}} reducedMotion={reducedMotion} />}
      <CommandRail />
    </div>
  )
}

function ThreadGate() {
  const auth = useJarvisAuth()
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
