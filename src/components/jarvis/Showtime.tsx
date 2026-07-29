"use client"

// D8 — Showtime is deliberately a presentation of B4's read-only Dealer Zero
// script, never a simulator trigger.  Every inspect affordance is backed by a real
// decision_receipts id supplied by that owner-only API; missing receipts stay visibly
// unavailable instead of receiving a made-up stand-in.

import { useEffect, useMemo, useRef, useState } from "react"
import Link from "next/link"
import { motion, useReducedMotion } from "framer-motion"
import { CirclePause, CirclePlay, Eye, RotateCcw, Sparkles } from "lucide-react"
import "./jarvis-theme.css"
import { JarvisAuthProvider, useJarvisAuth } from "./lib/jarvis-auth"
import { jarvisClient, type DealerZeroScenario, type ShowtimeFrame, type TimeCompressedDemo } from "@/lib/jarvis-client"
import { ReceiptDrawer } from "./lib/ReceiptDrawer"
import { Orb3D, type OrbState } from "./bridge/Orb3D"
import { GridBackdrop } from "./ui/fx/GridBackdrop"

const SCENARIOS: Array<{ value: DealerZeroScenario; label: string }> = [
  { value: "normal_day", label: "Normal day" },
  { value: "brutal_summer", label: "Brutal summer" },
  { value: "payment_crunch", label: "Payment crunch" },
  { value: "equipment_recall", label: "Equipment recall" },
  { value: "chaos_day", label: "Chaos day" },
]

function today() { return new Date().toISOString().slice(0, 10) }

// P2.T12: `OrbState` is now an alias for the kernel's 12-value `Presence`
// (Orb3D.tsx). Mapped from the old 5-value equivalents this file used before:
// idle->dormant, planning->thinking, executing->working, blocked->obstructed.
function frameState(frame: ShowtimeFrame | undefined): OrbState {
  if (!frame || frame.kind === "day_start" || frame.kind === "day_end") return "dormant"
  if (frame.kind === "intake") return "thinking"
  if (frame.kind === "workflow") return "working"
  return "obstructed"
}

function ShowtimeShell() {
  const { session, loading, role } = useJarvisAuth()
  const reduced = useReducedMotion()
  const [scenario, setScenario] = useState<DealerZeroScenario>("normal_day")
  const [demo, setDemo] = useState<TimeCompressedDemo | null>(null)
  const [elapsed, setElapsed] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [receiptId, setReceiptId] = useState<string | null>(null)
  const startedAt = useRef<number | null>(null)

  async function loadDemo(nextScenario = scenario) {
    setError(null)
    setPlaying(false)
    setElapsed(0)
    startedAt.current = null
    try {
      const script = await jarvisClient.dealerZeroTimeCompression({ dateSeed: today(), scenario: nextScenario, multiplier: 60 })
      setDemo(script)
      setPlaying(true)
      startedAt.current = performance.now()
    } catch (cause) {
      setDemo(null)
      setError(cause instanceof Error ? cause.message : "Couldn’t load the Dealer Zero demo.")
    }
  }

  useEffect(() => {
    if (!playing || !demo) return
    let raf = 0
    const tick = () => {
      const next = Math.min(demo.durationMs, performance.now() - (startedAt.current ?? performance.now()))
      setElapsed(next)
      if (next < demo.durationMs) raf = requestAnimationFrame(tick)
      else setPlaying(false)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [demo, playing])

  const activeIndex = useMemo(() => {
    if (!demo) return -1
    return demo.frames.reduce((last, frame, index) => frame.atMs <= elapsed ? index : last, -1)
  }, [demo, elapsed])
  const active = demo?.frames[activeIndex]
  const progress = demo ? Math.min(100, (elapsed / demo.durationMs) * 100) : 0

  // The server cannot inspect browser-local Supabase storage. Render the same
  // restrictive gate while that client check settles rather than an indefinite
  // loading state; a real owner session replaces it once it is resolved.
  if (loading) return <Gate title="Sign in required" detail="Showtime is available only to the labeled Dealer Zero demo tenant." />
  if (!session) return <Gate title="Sign in required" detail="Showtime is available only to the labeled Dealer Zero demo tenant." />
  // `loading` covers only the local Supabase session.  The tenant role is fetched
  // immediately afterward, so treating its brief null state as a non-owner would
  // reject a real owner before `/api/me` can resolve.
  if (role === null) return <div className="flex min-h-screen items-center justify-center bg-[#04070f] text-sm font-black text-white">Checking account access…</div>
  if (role !== "owner") return <Gate title="Owner access required" detail="Dealer Zero time-compression is owner-only because its receipts are tenant records." />

  return (
    <main className="jarvis-root min-h-screen overflow-hidden bg-[#04070f] text-[color:var(--j-text)]" data-mood="idle" data-daypart="night">
      <div className="pointer-events-none fixed inset-0 opacity-60"><GridBackdrop /></div>
      <section className="relative mx-auto flex min-h-screen max-w-7xl flex-col px-5 py-6 md:px-8">
        <header className="flex flex-wrap items-start justify-between gap-5 border-b border-white/10 pb-5">
          <div>
            <div className="mb-2 flex flex-wrap gap-2"><span className="j-chip bg-amber-300/15 text-amber-100">DEMO</span><span className="j-chip bg-amber-300/10 text-amber-100">SYNTHETIC · DEALER ZERO</span></div>
            <h1 className="text-2xl font-black tracking-tight text-white">Showtime</h1>
            <p className="mt-1 max-w-xl text-[12px] leading-relaxed text-[color:var(--j-text-dim)]">A B4 time-compressed script. It never sends a call, approves an action, or changes business data. Pause any marked beat to inspect its real receipt.</p>
          </div>
          <Link href="/jarvis/bridge" className="rounded-full border border-white/15 px-3 py-1.5 text-[11px] font-bold text-white/70 hover:border-cyan-200/60 hover:text-cyan-100">Return to Bridge</Link>
        </header>

        <div className="mt-5 flex flex-wrap items-center gap-3">
          <label className="text-[11px] font-bold text-[color:var(--j-text-dim)]">Scenario <select value={scenario} onChange={(event) => setScenario(event.target.value as DealerZeroScenario)} className="ml-2 rounded-lg border border-white/12 bg-[#0b1423] px-2 py-1 text-white" disabled={playing}>{SCENARIOS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label>
          <button type="button" onClick={() => void loadDemo()} className="inline-flex items-center gap-2 rounded-full bg-cyan-300 px-3 py-1.5 text-[11px] font-black text-slate-950 hover:bg-cyan-200"><Sparkles className="h-3.5 w-3.5" />{demo ? "Restart 60× demo" : "Start 60× demo"}</button>
          {demo && <button type="button" onClick={() => { if (!playing) startedAt.current = performance.now() - elapsed; setPlaying((value) => !value) }} className="inline-flex items-center gap-2 rounded-full border border-white/15 px-3 py-1.5 text-[11px] font-bold text-white/80">{playing ? <><CirclePause className="h-3.5 w-3.5" />Pause</> : <><CirclePlay className="h-3.5 w-3.5" />Resume</>}</button>}
          {demo && !playing && elapsed >= demo.durationMs && <button type="button" onClick={() => { setElapsed(0); startedAt.current = performance.now(); setPlaying(true) }} className="inline-flex items-center gap-2 text-[11px] font-bold text-cyan-200"><RotateCcw className="h-3.5 w-3.5" />Run again</button>}
        </div>
        {error && <div className="mt-4 rounded-xl border border-red-400/30 bg-red-400/5 p-3 text-sm text-red-200">{error}</div>}

        {!demo && !error && <div className="flex flex-1 items-center justify-center"><p className="max-w-md text-center text-sm text-[color:var(--j-text-dim)]">Start the labeled synthetic day when you’re ready. The API will refuse this outside the Dealer Zero demo tenant.</p></div>}
        {demo && <>
          <div className="mt-6 grid flex-1 gap-5 lg:grid-cols-[1.1fr_.9fr]">
            <section className="j-panel relative min-h-[420px] overflow-hidden p-5">
              <div className="flex items-start justify-between gap-4"><div><div className="j-label">NOW PLAYING</div><h2 className="mt-1 text-lg font-black text-white">{active?.label ?? "Loading script…"}</h2><p className="mt-1 text-[11px] text-[color:var(--j-text-dim)]">{Math.round(elapsed / 100) / 10}s of {Math.round(demo.durationMs / 100) / 10}s · {demo.multiplier}× presentation speed</p></div><div className="h-24 w-24"><Orb3D live={{ state: frameState(active), activeRunCount: active?.kind === "workflow" ? 1 : 0 }} /></div></div>
              <div className="relative mt-12 h-40 overflow-hidden rounded-2xl border border-cyan-200/15 bg-[radial-gradient(circle_at_50%_115%,rgba(34,211,238,.28),transparent_45%),#071321]">
                <div className="absolute bottom-7 left-8 right-8 h-px bg-cyan-200/30" />
                <motion.div className="absolute bottom-5 h-5 w-5 rounded-full border-2 border-cyan-100 bg-cyan-300 shadow-[0_0_22px_rgba(103,232,249,.9)]" animate={{ left: `${10 + progress * .78}%` }} transition={reduced ? { duration: 0 } : { type: "tween", ease: "linear", duration: .12 }} />
                <div className="absolute bottom-12 left-[14%] text-[9px] font-black uppercase tracking-widest text-cyan-100/60">calls</div><div className="absolute bottom-12 left-[47%] text-[9px] font-black uppercase tracking-widest text-cyan-100/60">gate</div><div className="absolute bottom-12 right-[12%] text-[9px] font-black uppercase tracking-widest text-cyan-100/60">workflow</div>
              </div>
              <p className="mt-4 text-[11px] leading-relaxed text-[color:var(--j-text-dim)]">The route line is visual timing for this scripted synthetic day, not a claimed road route or live operational movement.</p>
            </section>

            <section className="j-panel p-5"><div className="j-label">DAY TIMELINE</div><ol className="mt-4 space-y-3">{demo.frames.map((frame, index) => {
              const reached = index <= activeIndex
              const inspectable = Boolean(frame.receiptId)
              return <li key={`${frame.atMs}-${frame.kind}`} className={`rounded-xl border p-3 transition ${reached ? "border-cyan-200/30 bg-cyan-300/[.06]" : "border-white/8 bg-white/[.015] opacity-55"}`}><div className="flex items-start gap-3"><span className={`mt-1 h-2 w-2 shrink-0 rounded-full ${reached ? "bg-cyan-200 shadow-[0_0_10px_rgba(103,232,249,.9)]" : "bg-white/25"}`} /><div className="min-w-0 flex-1"><div className="text-[11px] font-bold text-white">{frame.label}</div><div className="mt-1 text-[10px] text-[color:var(--j-text-dim)]">{(frame.atMs / 1000).toFixed(1)}s · {frame.kind.replaceAll("_", " ")}</div></div>{inspectable ? <button type="button" onClick={() => { setPlaying(false); setReceiptId(frame.receiptId) }} className="inline-flex shrink-0 items-center gap-1 rounded-full border border-cyan-200/30 px-2 py-1 text-[9px] font-black text-cyan-100 hover:bg-cyan-200/10"><Eye className="h-3 w-3" />Inspect receipt</button> : <span className="shrink-0 text-[9px] text-[color:var(--j-text-faint)]">No receipt linked</span>}</div></li>
            })}</ol><p className="mt-4 text-[10px] leading-relaxed text-[color:var(--j-text-faint)]">“Inspect receipt” appears only when the tenant’s real receipt ledger supplied an ID. It is intentionally absent rather than fabricated.</p></section>
          </div>
          <div className="mt-5 h-1.5 overflow-hidden rounded-full bg-white/8"><div className="h-full bg-gradient-to-r from-cyan-400 via-teal-300 to-amber-200 transition-[width] duration-100" style={{ width: `${progress}%` }} /></div>
        </>}
      </section>
      {receiptId && <ReceiptDrawer receiptId={receiptId} onClose={() => setReceiptId(null)} />}
    </main>
  )
}

function Gate({ title, detail }: { title: string; detail: string }) { return <main className="flex min-h-screen flex-col items-center justify-center bg-[#04070f] px-6 text-center text-white"><h1 className="text-xl font-black">{title}</h1><p className="mt-2 max-w-sm text-sm text-white/60">{detail}</p><Link href="/jarvis" className="mt-5 rounded-full border border-white/15 px-4 py-2 text-xs font-bold text-cyan-100">Back to JARVIS</Link></main> }

export function Showtime() { return <JarvisAuthProvider><ShowtimeShell /></JarvisAuthProvider> }
