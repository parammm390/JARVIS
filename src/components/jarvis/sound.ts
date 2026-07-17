"use client"

// Micro-sound design for the console: tiny synthesized cues, no audio assets.
// Volumes are deliberately low; everything routes through one mutable gain node.

let ctx: AudioContext | null = null
let master: GainNode | null = null
let muted = false

function ensure(): { ctx: AudioContext; master: GainNode } | null {
  if (typeof window === "undefined") return null
  try {
    if (!ctx) {
      ctx = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)()
      master = ctx.createGain()
      master.gain.value = 0.12
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

function tone(freq: number, dur: number, delay = 0, type: OscillatorType = "sine", vol = 1): void {
  if (muted) return
  const a = ensure()
  if (!a) return
  const t = a.ctx.currentTime + delay
  const osc = a.ctx.createOscillator()
  const g = a.ctx.createGain()
  osc.type = type
  osc.frequency.setValueAtTime(freq, t)
  g.gain.setValueAtTime(0, t)
  g.gain.linearRampToValueAtTime(vol, t + 0.012)
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur)
  osc.connect(g)
  g.connect(a.master)
  osc.start(t)
  osc.stop(t + dur + 0.05)
}

export const sfx = {
  approve: () => {
    tone(523, 0.12)
    tone(784, 0.18, 0.07)
  },
  reject: () => {
    tone(196, 0.2, 0, "triangle")
  },
  tick: () => {
    tone(1244, 0.05, 0, "sine", 0.35)
  },
  voiceOn: () => {
    tone(440, 0.1)
    tone(660, 0.12, 0.08)
    tone(880, 0.16, 0.16)
  },
  voiceOff: () => {
    tone(660, 0.1)
    tone(440, 0.16, 0.08)
  },
  send: () => {
    tone(880, 0.07, 0, "sine", 0.5)
  },
  stepTick: () => {
    tone(1568, 0.06, 0, "sine", 0.3)
  },
  runDone: () => {
    tone(659, 0.1)
    tone(988, 0.16, 0.09)
  },
  eventPing: () => {
    tone(2093, 0.04, 0, "sine", 0.15)
  },
  bootHum: () => {
    tone(110, 1.2, 0, "sine", 0.08)
    tone(165, 1.2, 0.1, "sine", 0.05)
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
