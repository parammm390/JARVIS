"use client"

// The Instruction Thread — Command Rail (plan v3 §2.2/§6⓪/§3.4, P2.T6).
//
// Pinned, always focusable, `/` · `⌘K` · push-to-talk. Voice and text are one
// code path (§3.2): both end at the SAME `kernel.submit(text, source)`.

import { useCallback, useEffect, useRef, useState } from "react"
import { motion } from "framer-motion"
import { useKernel } from "../kernel/store"
import { useVapiSession, VAPI_WEB_ASSISTANT_ID } from "../lib/useVapiSession"
import { railCommitVariants } from "../kernel/choreography"
import { sfx } from "../sound"
import { CommandPaletteV2, useCommandPaletteV2 } from "../lib/CommandPaletteV2"
import { OpsPanel } from "./OpsPanel"
import type { InstructionState } from "../kernel/types"

const DOT_COLOR: Record<"live" | "polling" | "reconnecting" | "offline", string> = {
  live: "bg-cyan-300",
  polling: "bg-cyan-300/70",
  reconnecting: "bg-amber-300",
  offline: "bg-red-400",
}

function railBusy(state: InstructionState | null): { disabled: boolean; placeholder?: string } {
  switch (state) {
    case "understanding":
    case "planning":
      return { disabled: true, placeholder: "JARVIS is planning…" }
    case "clarifying":
      return { disabled: false, placeholder: "Answer above, or ask something else" }
    case "awaiting_approval":
    case "executing":
    case "verifying":
      return { disabled: true }
    default:
      return { disabled: false }
  }
}

export function CommandRail() {
  const kernel = useKernel()
  const voice = useVapiSession()
  const palette = useCommandPaletteV2()
  const [opsOpen, setOpsOpen] = useState(false)
  const [value, setValue] = useState("")
  const [committing, setCommitting] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const spaceHeldRef = useRef(false)

  const threadState = kernel.thread?.machine.instructionState ?? null
  const busy = railBusy(threadState)

  const submitTyped = useCallback(async () => {
    const text = value.trim()
    if (!text || busy.disabled) return
    setCommitting(true)
    sfx.commit()
    setValue("")
    if (threadState === "clarifying") {
      await kernel.answerClarification(text)
    } else {
      await kernel.submit(text, "typed")
    }
    setCommitting(false)
  }, [value, busy.disabled, threadState, kernel])

  // `/` focuses the rail from anywhere except while already typing in a field.
  // `⌘K` is NOT handled here — `useCommandPaletteV2()` already owns that
  // shortcut globally (own `keydown` listener); adding a second one here would
  // race it. `palette.open` is only consumed below to mount the palette.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null
      const typing = target?.tagName === "INPUT" || target?.tagName === "TEXTAREA" || target?.isContentEditable
      if (e.key === "/" && !typing) {
        e.preventDefault()
        inputRef.current?.focus()
        return
      }
      // Hold-Space push-to-talk (§3.4 point 1) — never while typing (a normal
      // space keystroke in the input must stay a space, not start a call).
      if (e.code === "Space" && !typing && !spaceHeldRef.current && !busy.disabled) {
        e.preventDefault()
        spaceHeldRef.current = true
        void voice.toggleVoice(VAPI_WEB_ASSISTANT_ID)
      }
    }
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.code === "Space" && spaceHeldRef.current) {
        spaceHeldRef.current = false
        void voice.toggleVoice(VAPI_WEB_ASSISTANT_ID)
      }
    }
    window.addEventListener("keydown", onKeyDown)
    window.addEventListener("keyup", onKeyUp)
    return () => {
      window.removeEventListener("keydown", onKeyDown)
      window.removeEventListener("keyup", onKeyUp)
    }
  }, [voice, busy.disabled])

  // On a final transcript, submit exactly like a typed Enter — one code path.
  const lastFinalRef = useRef<string | null>(null)
  useEffect(() => {
    const last = voice.transcript[voice.transcript.length - 1]
    if (!last || last.role !== "you") return
    if (lastFinalRef.current === last.text) return
    lastFinalRef.current = last.text
    sfx.commit()
    if (threadState === "clarifying") void kernel.answerClarification(last.text)
    else void kernel.submit(last.text, "voice")
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [voice.transcript])

  useEffect(() => {
    kernel.setVoiceIndicators({ micOpen: voice.voiceState === "live" || voice.voiceState === "connecting", speaking: voice.voiceState === "speaking" })
  }, [voice.voiceState, kernel])

  const showingPartial = Boolean(voice.partialTranscript)
  const commitVariants = railCommitVariants(false)

  return (
    <div className="fixed inset-x-0 bottom-0 z-20 flex flex-col items-center gap-1.5 pb-[max(env(safe-area-inset-bottom),16px)]">
      <motion.div
        initial={false}
        animate={committing ? commitVariants.animate : commitVariants.initial}
        transition={commitVariants.transition}
        className="flex w-[calc(100%-32px)] max-w-[720px] items-center gap-2 rounded-2xl border bg-[#05090f]/90 px-4 py-3.5 shadow-[0_10px_40px_rgba(0,0,0,0.5)] backdrop-blur-xl"
        style={{ borderColor: "rgba(34,211,238,0.25)" }}
      >
        <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${DOT_COLOR[kernel.transport]}`} data-connection-dot={kernel.transport} aria-label={`Connection: ${kernel.transport}`} />
        <input
          ref={inputRef}
          value={showingPartial ? voice.partialTranscript ?? "" : value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") void submitTyped()
          }}
          disabled={busy.disabled || showingPartial}
          placeholder={busy.placeholder ?? "Tell JARVIS what you need"}
          className={`j-fs-base w-full flex-1 bg-transparent text-[color:var(--j-text)] outline-none placeholder:text-[color:var(--j-text-faint)] disabled:opacity-60 ${
            showingPartial ? "italic text-[color:var(--j-text-dim)]" : ""
          }`}
          aria-label="Tell JARVIS what you need"
        />
        {voice.voiceState !== "idle" && voice.voiceState !== "error" && (
          <span className="j-chip border border-cyan-300/30 bg-cyan-400/10 text-cyan-200">{voice.voiceState}</span>
        )}
      </motion.div>
      <div className="j-fs-micro text-[color:var(--j-text-faint)]">/ to type · hold Space to talk · ⌘K for anything else</div>
      {palette.open && (
        // P4.T7: the real "⌘K → Ops" destination opens OpsPanel below — a
        // single deliberate overlay, never a route, never a landing page
        // (§2.4/§8 PHASE 4). Navigate's scene switches ("Overview"/"Pipeline
        // theater") are legacy-Bridge-specific and stay a no-op on this page.
        <CommandPaletteV2 onClose={() => palette.setOpen(false)} onNavigate={() => palette.setOpen(false)} onOpenOps={() => setOpsOpen(true)} />
      )}
      <OpsPanel open={opsOpen} onClose={() => setOpsOpen(false)} />
    </div>
  )
}
