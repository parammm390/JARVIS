"use client"

// The command pill — the reference image's glowing bottom bar. Orb on the left,
// oversized input, animated gradient ring that visibly accelerates while a request
// is genuinely in flight. Routes through the same gated instruct pipeline.

import { useEffect, useState } from "react"
import { motion, useReducedMotion } from "framer-motion"
import { Send } from "lucide-react"
import { JarvisOrb } from "./JarvisOrb"
import { sfx } from "../sound"
import { jarvisPost, JarvisApiError } from "../lib/api"
import { SignInPrompt } from "../lib/SignInPrompt"
import type { useVapiSession } from "../lib/useVapiSession"
import { useJarvis, type PendingAction } from "../lib/data-core"

// Shape of POST /api/actions's "planned" array — real DomainAction rows
// (finnor-os apps/api/app/api/actions/route.ts), not yet narrowed to only the ones
// that actually landed as a gated pending row (that split only exists internally,
// see orchestration/src/index.ts's turnResults) — see the optimistic-injection note
// in run() below for how that's handled honestly without a backend change.
type PlannedAction = { id: string; actionType: string; payload: unknown; status: string; createdAt: string; groundedPayload?: PendingAction["groundedPayload"] }

export function CommandBar({
  session,
  prefill,
  onPlanned,
}: {
  session: ReturnType<typeof useVapiSession>
  prefill?: string
  onPlanned?: (n: number, summaries: string[]) => void
}) {
  const reduced = useReducedMotion()
  const data = useJarvis()
  const [command, setCommand] = useState(prefill ?? "")
  const [busy, setBusy] = useState(false)
  const [showKeyPrompt, setShowKeyPrompt] = useState(false)
  const [note, setNote] = useState<string | null>(null)
  const live = session.voiceState === "live" || session.voiceState === "speaking"
  useEffect(() => {
    if (prefill) setCommand(prefill)
  }, [prefill])

  async function run() {
    const instruction = command.trim()
    if (!instruction || busy) return
    sfx.send()
    setBusy(true)
    setNote(null)
    try {
      const body = await jarvisPost<{ planned?: PlannedAction[] }>("actions", { instruction })
      const planned = body.planned ?? []
      const n = planned.length
      onPlanned?.(n, planned.map((p) => p.actionType))
      // Phase 7 (§7.5): show the proposed action(s) in the Approval Inbox right now,
      // not after the next poll — this is the "talk to JARVIS" moment, it should
      // feel instant. Some of these may turn out to be ungated (already executed by
      // the time this response even returns) rather than a real pending row; the
      // provider's next fast-lane poll (≤4s) always wins with the server's actual
      // truth either way, so a wrong guess here is a brief flash, never a lasting one.
      if (n > 0) {
        data.injectOptimisticPending(
          planned.map((p) => ({ id: p.id, actionType: p.actionType, summary: null, payload: p.payload, status: p.status, createdAt: p.createdAt, groundedPayload: p.groundedPayload })),
        )
      }
      setNote(n === 0 ? "Couldn't map that to an action — try naming the customer, task, or item." : `Planned ${n} action${n === 1 ? "" : "s"} — check the approval dock.`)
      setCommand("")
    } catch (e) {
      if (e instanceof JarvisApiError && e.status === 401) {
        setShowKeyPrompt(true)
      } else {
        setNote(e instanceof Error ? e.message : "That hit a snag.")
      }
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="mx-auto w-full max-w-3xl">
      <motion.div
        className="rounded-full p-[1.5px]"
        style={{
          background: "linear-gradient(90deg, rgba(34,211,238,0.55), rgba(139,92,246,0.5), rgba(59,130,246,0.55), rgba(34,211,238,0.55))",
          backgroundSize: "300% 100%",
          boxShadow: "0 0 34px rgba(56,130,246,0.22), 0 0 80px rgba(34,211,238,0.1)",
        }}
        animate={reduced ? {} : { backgroundPosition: ["0% 50%", "300% 50%"] }}
        transition={{ duration: busy ? 1.4 : live ? 3 : 7, repeat: Infinity, ease: "linear" }}
      >
        <div className="flex items-center gap-3 rounded-full bg-[#070d1a]/95 py-2 pl-2.5 pr-2.5 backdrop-blur-xl">
          <JarvisOrb size={40} voiceState={session.voiceState} volumeLevel={session.volumeLevel} />
          <input
            value={command}
            onChange={(e) => setCommand(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && run()}
            placeholder="What would you like me to do?"
            className="h-11 min-w-0 flex-1 bg-transparent text-[14px] text-[color:var(--j-text)] placeholder:text-[color:var(--j-text-faint)] focus:outline-none"
          />
          <motion.button
            onClick={run}
            disabled={busy || !command.trim()}
            whileHover={reduced ? {} : { scale: 1.06 }}
            whileTap={reduced ? {} : { scale: 0.95 }}
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-cyan-300 to-blue-400 text-slate-950 shadow-[0_0_18px_rgba(34,211,238,0.4)] transition disabled:opacity-30 disabled:shadow-none"
            aria-label="Run command"
          >
            {busy ? (
              <motion.span animate={{ rotate: 360 }} transition={{ duration: 0.9, repeat: Infinity, ease: "linear" }} className="h-4 w-4 rounded-full border-2 border-slate-950/30 border-t-slate-950" />
            ) : (
              <Send className="h-4 w-4" />
            )}
          </motion.button>
        </div>
      </motion.div>
      <div className="mt-1.5 flex items-center justify-center gap-3 text-[10px] text-[color:var(--j-text-faint)]">
        {note ? <span className="text-[color:var(--j-text-dim)]">{note}</span> : <span>Enter to run · ⌘K for the palette · consequential actions wait for your approval</span>}
      </div>
      {showKeyPrompt && <SignInPrompt onClose={() => setShowKeyPrompt(false)} />}
    </div>
  )
}
