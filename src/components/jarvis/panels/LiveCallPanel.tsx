"use client"

// Active Call panel — reference-image treatment. Live: green LIVE chip, scrolling
// waveform canvas fed by the REAL Vapi volume level (the page's single rAF loop, §9.2),
// green mono duration timer, mute/end controls, and a Live Transcript feed with an
// "AI is listening" pulse. Idle: the orb breathing + honest scope note.

import { useEffect, useRef, useState } from "react"
import { motion, useReducedMotion } from "framer-motion"
import { Mic, MicOff, PhoneOff } from "lucide-react"
import { JarvisOrb } from "./JarvisOrb"
import type { useVapiSession } from "../lib/useVapiSession"

function WaveformStrip({ volumeLevel, active }: { volumeLevel: number; active: boolean }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const rafRef = useRef<number>()
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
      if (t - last < 1000 / 30) {
        rafRef.current = requestAnimationFrame(draw)
        return
      }
      last = t
      ctx!.clearRect(0, 0, W, H)
      if (!active) {
        rafRef.current = requestAnimationFrame(draw)
        return
      }
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
        ctx!.fillStyle = `rgba(56,189,248,${alpha})`
        ctx!.beginPath()
        ctx!.roundRect(x, mid - h / 2, barW, h, 1.2)
        ctx!.fill()
      }
      rafRef.current = requestAnimationFrame(draw)
    }
    rafRef.current = requestAnimationFrame(draw)
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current)
    }
  }, [active])

  return <canvas ref={canvasRef} style={{ width: 340, height: 64, maxWidth: "100%" }} aria-hidden />
}

export function LiveCallPanel({ session }: { session: ReturnType<typeof useVapiSession> }) {
  const reduced = useReducedMotion()
  const { voiceState, volumeLevel, transcript, callDurationSec, muted, toggleVoice, toggleMute, configured } = session
  const [tab, setTab] = useState<"transcript" | "details">("transcript")
  const live = voiceState === "live" || voiceState === "speaking"
  const mm = String(Math.floor(callDurationSec / 60)).padStart(2, "0")
  const ss = String(callDurationSec % 60).padStart(2, "0")
  const feedRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    feedRef.current?.scrollTo({ top: feedRef.current.scrollHeight, behavior: "smooth" })
  }, [transcript])

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
          </>
        )}

        {live && (
          <>
            <div className="flex w-full items-center gap-3">
              <JarvisOrb size={52} voiceState={voiceState} volumeLevel={volumeLevel} />
              <div className="min-w-0 flex-1">
                <div className="text-[13px] font-black text-[color:var(--j-text)]">Browser voice session</div>
                <div className="text-[10.5px] text-[color:var(--j-text-dim)]">{voiceState === "speaking" ? "Finnor is speaking…" : "listening to you"}</div>
              </div>
              <div className="font-mono text-xl font-bold tabular-nums text-emerald-300 [text-shadow:0_0_14px_rgba(52,211,153,0.5)]">
                {mm}:{ss}
              </div>
            </div>
            <div className="mt-3 w-full rounded-xl border border-white/6 bg-black/25 px-2 py-1">
              <WaveformStrip volumeLevel={volumeLevel} active={live} />
            </div>
          </>
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
            onClick={toggleVoice}
            disabled={!configured}
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
            ) : (
              <>
                <Mic className="h-3.5 w-3.5" /> Start Session
              </>
            )}
          </motion.button>
        </div>

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
