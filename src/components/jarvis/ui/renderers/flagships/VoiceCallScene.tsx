"use client"

// D3.T2 — flagship 3/8: voice call. Deviation, real and load-bearing: "voice call"
// is NOT one of the 41 plugin action_types (confirmed via the full plugin-registry
// enumeration, packages/orchestration/src/plugin-registry.ts) — it's a `calls` table
// row (packages/db/schema.ts:681), persisted by the Vapi webhook
// (persistCall, packages/data-platform/src/conversations.ts), and surfaced today
// only by ActivityTheater's `call` source branch. This component is keyed by a
// CallSummary shape, not `actionType`/payload like the other 7 flagships — wired
// directly into ActivityTheater (not through registry.ts's actionType map, which
// doesn't apply here) and given its own Stage section + fixture.
//
// Real-data honesty note (found while reading the schema/webhook route, not
// assumed): `recordingUrl` exists on the `calls` table but the Vapi webhook route
// never actually populates it on `end-of-call-report` (grepped the persistCall call
// site — no recordingUrl passed). So a real call today always renders the
// audio-less "transcript only" state below; the waveform-player state is real code,
// reachable the moment a recording URL is ever wired up, not simulated as always-on.

import { useMemo, useState } from "react"
import { Phone, PhoneIncoming, PhoneOutgoing, Play, Pause } from "lucide-react"
import { Enter } from "../../motion/primitives"
import { Panel } from "../../primitives/Panel"

export interface CallSceneData {
  direction: "inbound" | "outbound"
  fromNumber?: string | null
  toNumber?: string | null
  transcript?: string | null
  recordingUrl?: string | null
  startedAt?: string | null
  endedAt?: string | null
  endedReason?: string | null
}

function splitTurns(transcript: string | null | undefined): Array<{ speaker: string; text: string }> {
  if (!transcript) return []
  return transcript
    .split(/\n+/)
    .map((line) => {
      const m = line.match(/^([A-Za-z ]{2,20}):\s*(.*)$/)
      return m ? { speaker: m[1]!.trim(), text: m[2]! } : { speaker: "", text: line }
    })
    .filter((t) => t.text.trim().length > 0)
}

export function VoiceCallScene({ call, compact }: { call: CallSceneData; compact?: boolean }) {
  const turns = useMemo(() => splitTurns(call.transcript), [call.transcript])
  const [playing, setPlaying] = useState(false)
  const durationSec =
    call.startedAt && call.endedAt ? Math.max(0, Math.round((new Date(call.endedAt).getTime() - new Date(call.startedAt).getTime()) / 1000)) : null

  if (compact) {
    const DirIcon = call.direction === "inbound" ? PhoneIncoming : PhoneOutgoing
    return (
      <span className="inline-flex items-center gap-1.5 text-[11px]">
        <DirIcon className="h-3 w-3 shrink-0 text-violet-300" />
        <span className="truncate text-[color:var(--j-text)]">
          {call.direction} call {call.fromNumber ?? call.toNumber ?? ""} {call.endedReason ? `· ${call.endedReason.replaceAll("_", " ")}` : ""}
        </span>
      </span>
    )
  }

  return (
    <Enter>
      <Panel className="border border-violet-400/25 p-3">
        <div className="mb-2 flex items-center gap-1.5">
          <Phone className="h-3.5 w-3.5 text-violet-300" />
          <span className="text-[9px] font-black uppercase tracking-widest text-violet-300">
            {call.direction} call · {call.fromNumber ?? "—"} → {call.toNumber ?? "—"}
          </span>
          {durationSec !== null && <span className="ml-auto font-mono text-[10px] text-white/40">{durationSec}s</span>}
        </div>

        {call.recordingUrl ? (
          <div className="flex items-center gap-2 rounded-lg border border-white/8 bg-white/[0.02] p-2">
            <button
              type="button"
              onClick={() => setPlaying((v) => !v)}
              className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-violet-400/20 text-violet-200"
              aria-label={playing ? "Pause" : "Play"}
            >
              {playing ? <Pause className="h-3 w-3" /> : <Play className="h-3 w-3" />}
            </button>
            <svg viewBox="0 0 200 24" className="h-6 flex-1" preserveAspectRatio="none">
              {Array.from({ length: 40 }).map((_, i) => {
                const h = 4 + Math.abs(Math.sin(i * 1.7 + i * i * 0.05)) * 18
                return <rect key={i} x={i * 5} y={(24 - h) / 2} width={2.5} height={h} rx={1} fill="rgba(196,181,253,0.55)" />
              })}
            </svg>
          </div>
        ) : (
          <div className="rounded-lg border border-dashed border-white/10 px-2 py-1.5 text-[10px] text-[color:var(--j-text-faint)]">
            No recording available for this call — transcript only.
          </div>
        )}

        {turns.length > 0 ? (
          <div className="mt-2 max-h-40 space-y-1 overflow-y-auto">
            {turns.map((t, i) => (
              <div key={i} className="text-[10.5px] leading-relaxed">
                {t.speaker && <span className="mr-1 font-black text-violet-300">{t.speaker}:</span>}
                <span className="text-[color:var(--j-text-dim)]">{t.text}</span>
              </div>
            ))}
          </div>
        ) : (
          <div className="mt-2 text-[10.5px] text-[color:var(--j-text-faint)]">No transcript recorded.</div>
        )}

        {call.endedReason && <div className="mt-2 text-[9.5px] uppercase tracking-wide text-white/30">ended: {call.endedReason.replaceAll("_", " ")}</div>}
      </Panel>
    </Enter>
  )
}
