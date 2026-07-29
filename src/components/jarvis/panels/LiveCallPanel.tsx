"use client"

// Active Call panel — reference-image treatment. Live: green LIVE chip, scrolling
// waveform canvas fed by the REAL Vapi volume level (the page's single rAF loop, §9.2),
// green mono duration timer, mute/end controls, and a Live Transcript feed with an
// "AI is listening" pulse. Idle: the orb breathing + honest scope note.
//
// F4 (Voice Theater) additions, all real-state-driven, catalogued in flow-index.ts:
// FLOW-67 WaveformTruth is the `WaveformStrip` below, unchanged — already real-
// levels-only (draws nothing while `active` is false, never a synthesized fallback),
// now exported so Stage can mount the SAME component. FLOW-68 TranscriptTide is the
// existing per-line `motion.div` entrance further down — re-probed per discovery: the
// Vapi `message` event's `transcript`/`transcriptType` fields carry no per-word
// timestamps (grepped the SDK's message shape in useVapiSession.tsx), so this
// honestly takes the plan's own documented "else line-enter" branch rather than a
// fabricated per-word cadence. FLOW-69 IntentSpark, FLOW-70 CallOrbit, and FLOW-73
// HangupSettle are new below. FLOW-71 VoiceMoodWash lives in JarvisCommandCenter.tsx/
// Bridge.tsx (the mood attribute's own consumer). FLOW-72 HoldBreath is `cut` in
// flow-index.ts — @vapi-ai/web's own `VapiEventNames` union (node_modules/@vapi-ai/web/
// dist/vapi.d.ts) has no hold/resume client event; only a server-side "put the
// customer on hold" experimental transfer flag exists, which this browser-mic session
// never uses. No fake amplitude was built for a state the SDK doesn't expose.

import { useEffect, useRef, useState } from "react"
import Link from "next/link"
import { motion, useReducedMotion } from "framer-motion"
import { AlertTriangle, Lock, Mic, MicOff, PhoneOff } from "lucide-react"
import { JarvisOrb } from "./JarvisOrb"
import type { useVapiSession } from "../lib/useVapiSession"
import { onFrame } from "../lib/raf-bus"
import { EASE } from "../ui/motion/tokens"
import { getAnchorRect } from "../lib/pulse-bus"
import { useJarvis, type PendingAction } from "../lib/data-core"
import { useJarvisAuth } from "../lib/jarvis-auth"

export function WaveformStrip({ volumeLevel, active, color = "rgba(56,189,248," }: { volumeLevel: number; active: boolean; color?: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const volRef = useRef(volumeLevel)
  const historyRef = useRef<number[]>([])
  volRef.current = volumeLevel

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext("2d")
    if (!ctx) return
    const W = 340
    const H = 64
    canvas.width = W * 2
    canvas.height = H * 2
    ctx.scale(2, 2)
    let last = 0

    function draw(t: number) {
      if (t - last < 1000 / 30) return
      last = t
      ctx!.clearRect(0, 0, W, H)
      if (!active) return
      historyRef.current.push(volRef.current)
      if (historyRef.current.length > 85) historyRef.current.shift()
      const hist = historyRef.current
      const barW = 2.4
      const gap = 1.6
      const mid = H / 2
      for (let i = 0; i < hist.length; i++) {
        const v = hist[i]!
        const h = Math.max(2, v * (H - 8))
        const x = W - (hist.length - i) * (barW + gap)
        const alpha = 0.35 + (i / hist.length) * 0.65
        ctx!.fillStyle = `${color}${alpha})`
        ctx!.beginPath()
        ctx!.roundRect(x, mid - h / 2, barW, h, 1.2)
        ctx!.fill()
      }
    }
    return onFrame(draw)
  }, [active, color])

  return <canvas ref={canvasRef} style={{ width: 340, height: 64, maxWidth: "100%" }} aria-hidden />
}

// FLOW-70 CallOrbit — a small DOM ring orbiting the orb container (SVG transform,
// not WebGL — the plan's own explicit scope, distinct from Bridge's Orb3D). One
// continuous loop, only while genuinely live; pauses (no `animate`) otherwise, so it
// never adds to the ambient budget when the panel is idle.
export function CallOrbitRing({ size, active }: { size: number; active: boolean }) {
  const reduced = useReducedMotion()
  if (!active) return null
  return (
    <motion.div
      className="pointer-events-none absolute rounded-full border border-dashed border-cyan-300/35"
      style={{ inset: -9, width: size + 18, height: size + 18 }}
      animate={reduced ? {} : { rotate: 360 }}
      transition={{ duration: 13, repeat: Infinity, ease: "linear" }}
    >
      <span className="absolute -top-[3px] left-1/2 h-1.5 w-1.5 -translate-x-1/2 rounded-full bg-cyan-300 shadow-[0_0_9px_rgba(34,211,238,0.85)]" />
    </motion.div>
  )
}

// FLOW-73 HangupSettle — the orbit satellite's one-shot flight into the legacy
// Shell's real ActivityRail panel (anchor registered there via F2's own pulse-bus
// registry, "legacy-activity-rail" — no new transport). `from` is captured the
// instant the call ends, before the live block (and its ref) unmounts.
function HangupSettleChip({ from, reduced, onDone }: { from: DOMRect; reduced: boolean; onDone: () => void }) {
  const to = getAnchorRect("legacy-activity-rail")
  const dx = to ? to.left + to.width / 2 - (from.left + from.width / 2) : 0
  const dy = to ? to.top + to.height / 2 - (from.top + from.height / 2) : 60
  return (
    <motion.div
      initial={{ opacity: 1, x: 0, y: 0, scale: 1, rotate: 0 }}
      animate={reduced ? { opacity: 0 } : { opacity: [1, 1, 0], x: dx, y: dy, scale: 0.25, rotate: 200 }}
      transition={{ duration: reduced ? 0.2 : 0.6, ease: EASE.accelerate }}
      onAnimationComplete={onDone}
      style={{ position: "fixed", top: from.top + from.height / 2 - 5, left: from.left + from.width / 2 - 5, zIndex: 60 }}
      className="pointer-events-none h-2.5 w-2.5 rounded-full bg-cyan-300 shadow-[0_0_10px_rgba(34,211,238,0.85)]"
    />
  )
}

// FLOW-69 IntentSpark — a real spawned-actions tray for this call. No `correlation_id`
// column persists a callId onto `domain_actions` (re-probed, not assumed: `packages/
// orchestration/src/index.ts` tags `correlationId` onto the in-memory DomainAction for
// job threading only, "never a DB column" per its own comment) — so this correlates
// honestly by time window (any real pending action created since the call started),
// and says so in the UI copy rather than implying a stored call link that doesn't exist.
function IntentSparkChip({ from, to, label, reduced, onDone }: { from: DOMRect; to: DOMRect; label: string; reduced: boolean; onDone: () => void }) {
  const dx = to.left + to.width / 2 - (from.left + from.width / 2)
  const dy = to.top + to.height / 2 - (from.top + from.height / 2)
  return (
    <motion.div
      initial={{ opacity: 1, x: 0, y: 0, scale: 1 }}
      animate={reduced ? { opacity: 0 } : { opacity: [1, 1, 0], x: dx, y: dy, scale: 0.6 }}
      transition={{ duration: reduced ? 0.2 : 0.5, ease: EASE.accelerate }}
      onAnimationComplete={onDone}
      style={{ position: "fixed", top: from.top, left: from.left, zIndex: 60 }}
      className="pointer-events-none whitespace-nowrap rounded-full bg-violet-300/85 px-2 py-0.5 text-[8.5px] font-black text-slate-950"
    >
      {label}
    </motion.div>
  )
}

export function IntentSparkTray({
  pendingActions,
  sinceMs,
  active,
  sourceRef,
}: {
  pendingActions: PendingAction[]
  sinceMs: number | null
  active: boolean
  sourceRef: { current: HTMLElement | null }
}) {
  const trayRef = useRef<HTMLDivElement>(null)
  const seenRef = useRef<Set<string>>(new Set())
  const [items, setItems] = useState<PendingAction[]>([])
  const [chips, setChips] = useState<Array<{ id: string; from: DOMRect; to: DOMRect; label: string }>>([])
  const reduced = useReducedMotion()

  useEffect(() => {
    if (!active || sinceMs == null) {
      return
    }
    const matched = pendingActions.filter((a) => new Date(a.createdAt).getTime() >= sinceMs)
    const fresh = matched.filter((a) => !seenRef.current.has(a.id))
    if (fresh.length > 0) {
      fresh.forEach((a) => seenRef.current.add(a.id))
      const from = sourceRef.current?.getBoundingClientRect()
      const to = trayRef.current?.getBoundingClientRect()
      if (from && to) {
        setChips((c) => [...c, ...fresh.map((a) => ({ id: a.id, from, to, label: a.actionType.replaceAll("_", " ") }))])
      }
    }
    if (matched.length !== items.length) setItems(matched)
  }, [pendingActions, active, sinceMs, sourceRef, items.length])

  useEffect(() => {
    if (!active) {
      seenRef.current.clear()
      setItems([])
    }
  }, [active])

  if (!active) return null

  return (
    <div ref={trayRef} className="relative mt-2 w-full rounded-lg border border-violet-400/20 bg-violet-400/5 p-2">
      <div className="mb-1 text-[9px] font-black uppercase tracking-widest text-violet-300">
        Actions from this call{items.length > 0 ? ` (${items.length})` : ""}
      </div>
      {items.length === 0 ? (
        <div className="text-[10px] text-[color:var(--j-text-faint)]">Nothing created yet.</div>
      ) : (
        <div className="space-y-1">
          {items.map((a) => (
            <motion.div key={a.id} layout initial={{ opacity: 0, scale: 0.85 }} animate={{ opacity: 1, scale: 1 }} className="text-[10.5px] text-white/75">
              {a.actionType.replaceAll("_", " ")} <span className="text-white/35">· {a.status}</span>
            </motion.div>
          ))}
        </div>
      )}
      <p className="mt-1 text-[8.5px] text-white/25">matched by time window since call start, not a stored call id</p>
      {chips.map((c) => (
        <IntentSparkChip key={c.id} from={c.from} to={c.to} label={c.label} reduced={!!reduced} onDone={() => setChips((cur) => cur.filter((x) => x.id !== c.id))} />
      ))}
    </div>
  )
}

export function LiveCallPanel({ session }: { session: ReturnType<typeof useVapiSession> }) {
  const reduced = useReducedMotion()
  const { voiceState, volumeLevel, transcript, callDurationSec, muted, toggleVoice, toggleMute, configured, lastError, micSilenceWarning } = session
  // Every other panel on this page is safely public — it calls the finnor-os backend,
  // which 401s an unauthenticated request for free. Voice is the one exception: it
  // talks directly to Vapi from the browser with a public client key, entirely
  // bypassing that backend gate, so a signed-out visitor could otherwise start a
  // real, billable voice session with no sign-in at all. Gated here, at the one
  // control that actually opens a session, rather than hiding the whole panel — the
  // page stays the "intentionally public" demo surface jarvis-auth.tsx documents.
  const { session: authSession, loading: authLoading } = useJarvisAuth()
  const signedIn = !!authSession
  const [tab, setTab] = useState<"transcript" | "details">("transcript")
  const live = voiceState === "live" || voiceState === "speaking"
  const mm = String(Math.floor(callDurationSec / 60)).padStart(2, "0")
  const ss = String(callDurationSec % 60).padStart(2, "0")
  const feedRef = useRef<HTMLDivElement>(null)
  const data = useJarvis()

  useEffect(() => {
    feedRef.current?.scrollTo({ top: feedRef.current.scrollHeight, behavior: "smooth" })
  }, [transcript])

  // FLOW-73 HangupSettle — capture the orb's real rect continuously while live (cheap,
  // layout here is static once mounted) so a rect is still available the instant
  // `live` flips false and the live block (with its own ref) unmounts.
  const orbContainerRef = useRef<HTMLDivElement>(null)
  const lastOrbRectRef = useRef<DOMRect | null>(null)
  const prevLiveRef = useRef(false)
  const [settleChip, setSettleChip] = useState<{ id: number; from: DOMRect } | null>(null)
  const callStartAtRef = useRef<number | null>(null)

  useEffect(() => {
    if (live) lastOrbRectRef.current = orbContainerRef.current?.getBoundingClientRect() ?? null
  }, [live, volumeLevel])

  useEffect(() => {
    if (live && callStartAtRef.current == null) callStartAtRef.current = Date.now()
    if (prevLiveRef.current && !live) {
      if (lastOrbRectRef.current) setSettleChip({ id: Date.now(), from: lastOrbRectRef.current })
      callStartAtRef.current = null
    }
    prevLiveRef.current = live
  }, [live])

  return (
    <div className={`j-panel relative flex h-full flex-col overflow-hidden xl:col-span-1 ${live ? "j-panel-hot" : ""}`}>
      <div className="flex items-center justify-between border-b border-white/6 px-4 py-3">
        <span className="j-label">{live ? "Active Call" : "Voice Channel"}</span>
        {live ? (
          <span className="j-chip bg-emerald-400/12 text-emerald-300">
            <span className="relative flex h-1.5 w-1.5">
              <span className="absolute h-full w-full animate-ping rounded-full bg-emerald-300 opacity-70" />
              <span className="relative h-1.5 w-1.5 rounded-full bg-emerald-300" />
            </span>
            Live
          </span>
        ) : (
          <span className="j-chip bg-white/5 text-[color:var(--j-text-dim)]">standing by</span>
        )}
      </div>

      <div className="flex flex-1 flex-col items-center px-4 py-4">
        {!live && (
          <>
            <div className="my-3">
              <JarvisOrb size={104} voiceState={voiceState} volumeLevel={volumeLevel} />
            </div>
            <div className="text-sm font-black uppercase tracking-widest text-[color:var(--j-text)]">
              {voiceState === "connecting" ? "Connecting…" : "Speak to Finnor"}
            </div>
            <p className="mt-1.5 max-w-[240px] text-center text-[11px] leading-relaxed text-[color:var(--j-text-dim)]">
              Book work, draft invoices, check stock — it plans, you approve.
            </p>
            {!configured && (
              <div className="mt-3 rounded-lg border border-amber-400/25 bg-amber-400/5 px-3 py-2 text-center text-[11px] text-amber-200">
                Voice keys not configured on this deployment.
              </div>
            )}
            {lastError && (
              <div className="mt-3 flex items-start gap-2 rounded-lg border border-amber-400/25 bg-amber-400/5 px-3 py-2 text-left text-[11px] text-amber-200">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                <span>{lastError}</span>
              </div>
            )}
          </>
        )}

        {live && (
          <>
            <div className="flex w-full items-center gap-3">
              <div ref={orbContainerRef} className="relative shrink-0">
                <CallOrbitRing size={52} active={live} />
                <JarvisOrb size={52} voiceState={voiceState} volumeLevel={volumeLevel} />
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-[13px] font-black text-[color:var(--j-text)]">Browser voice session</div>
                <div className="text-[10.5px] text-[color:var(--j-text-dim)]">{voiceState === "speaking" ? "Finnor is speaking…" : "listening to you"}</div>
              </div>
              <div className="font-mono text-xl font-bold tabular-nums text-emerald-300 [text-shadow:0_0_14px_rgba(52,211,153,0.5)]">
                {mm}:{ss}
              </div>
            </div>
            <div className="mt-3 w-full rounded-xl border border-white/6 bg-black/25 px-2 py-1">
              <WaveformStrip volumeLevel={volumeLevel} active={live} color={voiceState === "speaking" ? "rgba(34,211,238," : "rgba(45,212,191,"} />
            </div>
            {micSilenceWarning && (
              <div className="mt-2 flex w-full items-start gap-2 rounded-lg border border-amber-400/25 bg-amber-400/5 px-3 py-2 text-left text-[11px] text-amber-200">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                <span>Not picking up your mic — check it isn&apos;t muted or blocked, then try speaking again.</span>
              </div>
            )}
            <IntentSparkTray pendingActions={data.pendingActions} sinceMs={callStartAtRef.current} active={live} sourceRef={feedRef} />
          </>
        )}
        {settleChip && (
          <HangupSettleChip from={settleChip.from} reduced={!!reduced} onDone={() => setSettleChip((c) => (c?.id === settleChip.id ? null : c))} />
        )}

        <div className="mt-4 flex items-center gap-2.5">
          {live && (
            <button
              onClick={toggleMute}
              className={`flex h-10 w-10 items-center justify-center rounded-full border transition ${
                muted ? "border-amber-400/50 bg-amber-400/10 text-amber-300" : "border-white/12 bg-white/5 text-white/70 hover:text-white"
              }`}
              aria-label={muted ? "Unmute" : "Mute"}
            >
              {muted ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
            </button>
          )}
          <motion.button
            onClick={() => toggleVoice()}
            // Starting is asynchronous. Keep the control inert while it joins so
            // a second tap cannot open a competing Daily microphone session. A
            // signed-out visitor can still END a call already in progress (can't
            // happen in practice since it can never start signed out) but can never
            // START a fresh one — real Vapi minutes cost real money per use.
            disabled={!configured || voiceState === "connecting" || (!live && (!signedIn || authLoading))}
            whileHover={reduced ? {} : { scale: 1.04 }}
            whileTap={reduced ? {} : { scale: 0.97 }}
            className={`inline-flex h-10 items-center gap-2 rounded-full px-6 text-[11px] font-black transition disabled:opacity-40 ${
              live
                ? "bg-red-400 text-slate-950 shadow-[0_0_20px_rgba(248,113,113,0.35)]"
                : "bg-gradient-to-r from-teal-300 to-cyan-300 text-slate-950 shadow-[0_0_22px_rgba(34,211,238,0.3)]"
            }`}
          >
            {live ? (
              <>
                <PhoneOff className="h-3.5 w-3.5" /> End Call
              </>
            ) : !signedIn && !authLoading ? (
              <>
                <Lock className="h-3.5 w-3.5" /> Sign in to talk
              </>
            ) : (
              <>
                <Mic className="h-3.5 w-3.5" /> Start Session
              </>
            )}
          </motion.button>
        </div>
        {!live && !signedIn && !authLoading && (
          <p className="mt-2 text-center text-[10.5px] leading-relaxed text-[color:var(--j-text-faint)]">
            <Link href="/jarvis/login" className="text-cyan-300/80 hover:text-cyan-200">
              Sign in
            </Link>{" "}
            to start a live voice session — every other panel here is a public preview.
          </p>
        )}

        {/* transcript */}
        <div className="mt-4 flex w-full flex-1 flex-col">
          <div className="flex gap-4 border-b border-white/6 pb-1.5">
            <button
              onClick={() => setTab("transcript")}
              className={`text-[10.5px] font-bold uppercase tracking-widest ${tab === "transcript" ? "text-cyan-300" : "text-[color:var(--j-text-faint)]"}`}
            >
              Live Transcript
            </button>
            <button
              onClick={() => setTab("details")}
              className={`text-[10.5px] font-bold uppercase tracking-widest ${tab === "details" ? "text-cyan-300" : "text-[color:var(--j-text-faint)]"}`}
            >
              Session
            </button>
          </div>
          <div ref={feedRef} className="mt-2 max-h-44 min-h-[88px] flex-1 space-y-2 overflow-y-auto pr-1">
            {tab === "transcript" ? (
              <>
                {transcript.length === 0 && (
                  <div className="pt-4 text-center text-[11px] text-[color:var(--j-text-faint)]">
                    {live ? "Say something — the transcript streams here." : "Start a session and the conversation streams here, word for word."}
                  </div>
                )}
                {transcript.slice(-10).map((m, i) => (
                  <motion.div key={i} initial={{ opacity: 0, y: 5 }} animate={{ opacity: 1, y: 0 }} className="flex gap-2 text-[11.5px] leading-snug">
                    <span className={`shrink-0 font-black ${m.role === "jarvis" ? "text-cyan-300" : "text-white/60"}`}>{m.role === "jarvis" ? "FINNOR" : "YOU"}</span>
                    <span className="text-white/80">{m.text}</span>
                  </motion.div>
                ))}
                {live && voiceState !== "speaking" && (
                  <div className="flex items-center gap-1.5 pt-1 text-[10.5px] text-cyan-300/80">
                    <JarvisOrb size={14} voiceState="live" volumeLevel={volumeLevel} />
                    Finnor is listening
                    {[0, 1, 2].map((i) => (
                      <span key={i} className="h-1 w-1 rounded-full bg-cyan-300" style={{ animation: reduced ? undefined : `jarvis-dot-blink 1.2s ${i * 0.2}s infinite` }} />
                    ))}
                  </div>
                )}
              </>
            ) : (
              <div className="space-y-1.5 pt-1 text-[11px] text-[color:var(--j-text-dim)]">
                <div className="flex justify-between"><span>State</span><span className="font-mono text-[color:var(--j-text)]">{voiceState}</span></div>
                <div className="flex justify-between"><span>Duration</span><span className="font-mono text-[color:var(--j-text)]">{mm}:{ss}</span></div>
                <div className="flex justify-between"><span>Lines captured</span><span className="font-mono text-[color:var(--j-text)]">{transcript.length}</span></div>
                <div className="flex justify-between"><span>Mic</span><span className="font-mono text-[color:var(--j-text)]">{muted ? "muted" : "open"}</span></div>
              </div>
            )}
          </div>
        </div>

        {!live && (
          <p className="mt-3 text-center text-[9.5px] text-[color:var(--j-text-faint)]">Browser session. Customer phone calls run server-side.</p>
        )}
      </div>
    </div>
  )
}
