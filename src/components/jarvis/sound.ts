"use client"

// Micro-sound design for the console: tiny synthesized cues, no audio assets.
// Volumes are deliberately low; everything routes through one mutable gain node.

let ctx: AudioContext | null = null
let master: GainNode | null = null
// Sound is opt-in. This module is shared by the signed-out console as well as the
// authenticated surfaces, so the safe default must live here rather than in one UI.
let muted = true

// F11.T1 — Soundscape v2's master-ducking half. `BASE_GAIN` is the pre-F11
// constant unchanged; `duckFactor` is the real -6dB attenuation (10^(-6/20))
// applied only while a voice call is genuinely live, so cues never compete
// with the assistant's own speech. Nothing here changes cue volume at rest.
const BASE_GAIN = 0.12
const DUCK_GAIN = BASE_GAIN * 10 ** (-6 / 20)
let voiceLive = false

function ensure(): { ctx: AudioContext; master: GainNode } | null {
  if (typeof window === "undefined") return null
  try {
    if (!ctx) {
      ctx = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)()
      master = ctx.createGain()
      master.gain.value = voiceLive ? DUCK_GAIN : BASE_GAIN
      master.connect(ctx.destination)
    }
    if (ctx.state === "suspended") void ctx.resume()
    return { ctx, master: master! }
  } catch {
    return null
  }
}

export function setMuted(m: boolean): void {
  muted = m
}

/** F11.T1 — real voice-live signal, set from `useVapiSession`'s own real
 *  `call-start`/`call-end`/manual-stop transitions (never a fabricated timer).
 *  Ramps the shared master gain by -6dB while live and restores it after, so
 *  every subsequent cue (not just ones fired mid-transition) is ducked. */
export function setVoiceLive(active: boolean): void {
  voiceLive = active
  if (master && ctx) {
    master.gain.linearRampToValueAtTime(active ? DUCK_GAIN : BASE_GAIN, ctx.currentTime + 0.15)
  }
}

// F11.T1 — per-family timbre map (plan §5: "decision/flow/alert/ambient").
// Families don't add new cues; they classify the existing ones so each has a
// consistent, genuinely distinct oscillator character rather than the pre-F11
// file's arbitrary per-cue sine-by-default choice. decision = triangle (a
// human choice landing — rounder, more "mechanical valve" per F3's GateValve
// metaphor; approve/reject); flow = sine (bright, liquid — ticks/sends/steps/
// pings, the motion-semantics table's "value changed"/"causality" rows); alert
// = sawtooth (voice state changes — the one texture reserved for "something
// about the call changed", distinct from decision/flow so it's never confused
// with either); ambient = sine (soft, sustained — the one long boot wash).
type SfxFamily = "decision" | "flow" | "alert" | "ambient"
const TIMBRE: Record<SfxFamily, OscillatorType> = {
  decision: "triangle",
  flow: "sine",
  alert: "sawtooth",
  ambient: "sine",
}

function tone(freq: number, dur: number, delay = 0, family: SfxFamily = "flow", vol = 1): void {
  if (muted) return
  const a = ensure()
  if (!a) return
  const t = a.ctx.currentTime + delay
  const osc = a.ctx.createOscillator()
  const g = a.ctx.createGain()
  osc.type = TIMBRE[family]
  osc.frequency.setValueAtTime(freq, t)
  g.gain.setValueAtTime(0, t)
  g.gain.linearRampToValueAtTime(vol, t + 0.012)
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur)
  osc.connect(g)
  g.connect(a.master)
  osc.start(t)
  osc.stop(t + dur + 0.05)
}

// F11.T1 — refined cue lengths: every cue's own tone duration is now ≤180ms
// (plan §5's explicit ceiling), boot hum exempt by the plan's own wording since
// it's a one-shot ambient wash, not a reactive cue. Only `reject` actually
// exceeded the ceiling before (200ms → 180ms here); every other cue was
// already compliant and is reclassified by family, not retimed.
export const sfx = {
  approve: () => {
    tone(523, 0.12, 0, "decision")
    tone(784, 0.18, 0.07, "decision")
  },
  reject: () => {
    tone(196, 0.18, 0, "decision")
  },
  tick: () => {
    tone(1244, 0.05, 0, "flow", 0.35)
  },
  voiceOn: () => {
    tone(440, 0.1, 0, "alert")
    tone(660, 0.12, 0.08, "alert")
    tone(880, 0.16, 0.16, "alert")
  },
  voiceOff: () => {
    tone(660, 0.1, 0, "alert")
    tone(440, 0.16, 0.08, "alert")
  },
  send: () => {
    tone(880, 0.07, 0, "flow", 0.5)
  },
  stepTick: () => {
    tone(1568, 0.06, 0, "flow", 0.3)
  },
  runDone: () => {
    tone(659, 0.1, 0, "flow")
    tone(988, 0.16, 0.09, "flow")
  },
  eventPing: () => {
    tone(2093, 0.04, 0, "flow", 0.15)
  },
  bootHum: () => {
    tone(110, 1.2, 0, "ambient", 0.08)
    tone(165, 1.2, 0.1, "ambient", 0.05)
  },
  // ---------------------------------------------------------------------
  // P2.T14 — the Instruction Thread's own cue set (plan v3 §5.4). `approve`/
  // `reject` above already match this table exactly and are reused unchanged.
  // ---------------------------------------------------------------------
  /** M1 RailCommit — "one soft rising two-note". */
  commit: () => {
    tone(660, 0.06, 0, "flow", 0.4)
    tone(880, 0.09, 0.05, "flow", 0.4)
  },
  /** `understanding` begins — "a single low tick, then silence". */
  think: () => {
    tone(220, 0.05, 0, "flow", 0.3)
  },
  /** Cockpit rises (§6⑤) — "two-note rising, brighter". Clarify (§6④) fires the
   *  SAME shape "at lower pitch" rather than a second, unrelated cue. */
  propose: (opts?: { lower?: boolean }) => {
    const base = opts?.lower ? 440 : 587
    tone(base, 0.09, 0, "decision", 0.5)
    tone(base * 1.335, 0.14, 0.06, "decision", 0.5)
  },
  /** M12 StepSpark — "short high tick, ≤1 per 400ms" (throttled by the caller,
   *  same shape `stepTick` already used; named to match §5.4's table). */
  step: () => {
    tone(1568, 0.06, 0, "flow", 0.3)
  },
  /** M15 ReceiptSeal, terminal success — "low resolved chord, 600ms". */
  seal: () => {
    tone(261.6, 0.6, 0, "ambient", 0.5)
    tone(329.6, 0.6, 0, "ambient", 0.4)
    tone(392.0, 0.6, 0, "ambient", 0.4)
  },
}

let lastEventPing = 0
/** Rate-limited to max 1 per 3s regardless of burst (§8). */
export function eventPingThrottled(): void {
  const now = Date.now()
  if (now - lastEventPing < 3000) return
  lastEventPing = now
  sfx.eventPing()
}

let lastStep = 0
/** P2.T14 — §5.4's own rule: "max one cue per 400 ms, throttle and drop, never
 *  queue", regardless of how many execution lanes complete a step at once. */
export function stepCueThrottled(): void {
  const now = Date.now()
  if (now - lastStep < 400) return
  lastStep = now
  sfx.step()
}
