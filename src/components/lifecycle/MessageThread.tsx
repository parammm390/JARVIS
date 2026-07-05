"use client"

import { useEffect, useRef, useState } from "react"
import { motion, useReducedMotion } from "framer-motion"
import { CheckCheck, MessageSquare } from "lucide-react"
import { applySlot, type SmsMessage } from "@/lib/lifecycle/scenario"

const EASE = [0.16, 1, 0.3, 1]
const MONO = "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace"

export function MessageThread({
  thread,
  contactName,
  contactMeta,
  interactive = false,
  autoPilot = false,
  chosenSlot,
  onChipChosen,
}: {
  thread: SmsMessage[]
  contactName: string
  contactMeta: string
  interactive?: boolean
  autoPilot?: boolean
  chosenSlot?: string
  onChipChosen?: (chip: string) => void
}) {
  const reduceMotion = useReducedMotion()
  const chipGateIndex = interactive ? thread.findIndex((message) => message.chips?.length) : -1
  const gated = interactive && chipGateIndex >= 0 && !chosenSlot
  const targetCount = gated ? chipGateIndex + 1 : thread.length

  const visibleRef = useRef(0)
  const threadRef = useRef(thread)
  if (threadRef.current !== thread) {
    threadRef.current = thread
    visibleRef.current = 0
  }

  const [visibleCount, setVisibleCount] = useState(reduceMotion ? targetCount : 0)
  const [typingFrom, setTypingFrom] = useState<SmsMessage["from"] | null>(null)

  useEffect(() => {
    if (reduceMotion) {
      visibleRef.current = targetCount
      setVisibleCount(targetCount)
      setTypingFrom(null)
      return
    }

    let cancelled = false
    const timers: number[] = []
    const later = (callback: () => void, ms: number) => {
      timers.push(
        window.setTimeout(() => {
          if (!cancelled) callback()
        }, ms)
      )
    }

    setVisibleCount(visibleRef.current)
    const step = () => {
      const index = visibleRef.current
      if (index >= targetCount) {
        setTypingFrom(null)
        return
      }
      const message = thread[index]
      setTypingFrom(message.from)
      later(() => {
        setTypingFrom(null)
        visibleRef.current = index + 1
        setVisibleCount(index + 1)
        later(step, message.from === "finnor" ? 700 : 560)
      }, message.from === "finnor" ? 1150 : 820)
    }
    later(step, visibleRef.current === 0 ? 480 : 320)

    return () => {
      cancelled = true
      timers.forEach(window.clearTimeout)
    }
  }, [thread, targetCount, reduceMotion])

  const waitingAtGate = gated && visibleCount >= chipGateIndex + 1

  useEffect(() => {
    if (!waitingAtGate || !autoPilot) return
    const timer = window.setTimeout(() => {
      const gateMessage = thread[chipGateIndex]
      const chip = gateMessage?.chosenChip || gateMessage?.chips?.[0]
      if (chip) onChipChosen?.(chip)
    }, 2600)
    return () => window.clearTimeout(timer)
  }, [waitingAtGate, autoPilot, thread, chipGateIndex, onChipChosen])

  const lastFinnorIndex = (() => {
    let last = -1
    thread.forEach((message, index) => {
      if (message.from === "finnor" && index < visibleCount) last = index
    })
    return last
  })()

  return (
    <div className="overflow-hidden rounded-[2rem] border border-slate-200 bg-white shadow-[0_22px_58px_rgba(15,38,62,0.08)]">
      <div className="flex items-center justify-between border-b border-slate-200 bg-slate-50/80 px-5 py-4">
        <div className="flex items-center gap-3">
          <span className="grid h-10 w-10 place-items-center rounded-2xl bg-slate-950 text-xs font-black text-white">
            {contactName
              .split(" ")
              .map((part) => part[0])
              .join("")
              .slice(0, 2)}
          </span>
          <div>
            <p className="text-sm font-black text-slate-950">{contactName}</p>
            <p className="text-[10px] font-black uppercase tracking-widest text-slate-500">
              {contactMeta}
            </p>
          </div>
        </div>
        <MessageSquare className="h-4 w-4 text-slate-400" />
      </div>

      <div className="min-h-[280px] space-y-3 p-5">
        {thread.slice(0, visibleCount).map((message, index) => (
          <div key={`${message.from}-${index}`}>
            <motion.div
              initial={reduceMotion ? false : { opacity: 0, y: 12, scale: 0.97 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              transition={{ duration: 0.5, ease: EASE }}
              className={
                message.from === "finnor"
                  ? "ml-auto w-fit max-w-[88%] rounded-2xl rounded-br-md bg-slate-950 px-4 py-3"
                  : "mr-auto w-fit max-w-[88%] rounded-2xl rounded-bl-md border border-slate-200 bg-slate-100 px-4 py-3"
              }
            >
              <p
                className={`text-sm font-semibold leading-relaxed ${
                  message.from === "finnor" ? "text-white" : "text-slate-800"
                }`}
              >
                {applySlot(message.text, chosenSlot)}
              </p>
              {message.chips?.length ? (
                <div className="mt-3 flex flex-wrap gap-2">
                  {message.chips.map((chip) => {
                    const chosen = chosenSlot
                      ? chip === chosenSlot
                      : chip === message.chosenChip && visibleCount >= index + 2
                    const clickable = interactive && index === chipGateIndex && !chosenSlot
                    return (
                      <button
                        key={chip}
                        type="button"
                        disabled={!clickable}
                        onClick={() => onChipChosen?.(chip)}
                        data-cursor={clickable ? "hover" : undefined}
                        className={`rounded-full border px-3 py-1.5 text-xs font-black transition-all duration-400 ${
                          chosen
                            ? "border-teal-200/70 bg-teal-400/25 text-teal-100"
                            : clickable
                              ? "border-white/40 bg-white/[0.06] text-white hover:border-teal-200/70 hover:bg-teal-400/15"
                              : "border-white/25 text-white/80"
                        } ${clickable && waitingAtGate && !autoPilot ? "animate-pulse" : ""}`}
                      >
                        {chip}
                      </button>
                    )
                  })}
                </div>
              ) : null}
            </motion.div>
            {message.from === "finnor" && index === lastFinnorIndex && !waitingAtGate ? (
              <motion.p
                initial={reduceMotion ? false : { opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: 0.35 }}
                className="mt-1.5 flex items-center justify-end gap-1 text-[10px] font-bold text-slate-400"
                style={{ fontFamily: MONO }}
              >
                <CheckCheck className="h-3 w-3 text-teal-600" />
                Delivered
              </motion.p>
            ) : null}
            {interactive && index === chipGateIndex && waitingAtGate && !autoPilot ? (
              <motion.p
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: 0.4 }}
                className="mt-1.5 text-right text-[10px] font-black uppercase tracking-widest text-teal-700"
              >
                Your call, tap a slot
              </motion.p>
            ) : null}
          </div>
        ))}

        {typingFrom ? <TypingIndicator from={typingFrom} /> : null}
      </div>
    </div>
  )
}

function TypingIndicator({ from }: { from: SmsMessage["from"] }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className={
        from === "finnor"
          ? "ml-auto w-fit rounded-2xl rounded-br-md bg-slate-950 px-4 py-3.5"
          : "mr-auto w-fit rounded-2xl rounded-bl-md border border-slate-200 bg-slate-100 px-4 py-3.5"
      }
    >
      <span className="flex items-center gap-1">
        {[0, 1, 2].map((dot) => (
          <motion.span
            key={dot}
            animate={{ y: [0, -3.5, 0], opacity: [0.4, 1, 0.4] }}
            transition={{ duration: 0.9, repeat: Infinity, delay: dot * 0.14, ease: "easeInOut" }}
            className={`h-1.5 w-1.5 rounded-full ${
              from === "finnor" ? "bg-white/70" : "bg-slate-400"
            }`}
          />
        ))}
      </span>
    </motion.div>
  )
}
