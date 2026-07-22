"use client"

// D3.T2 — flagship 1/8: schedule_water_test (water-test plugin).
//
// Deviation from the plan's literal wording ("gauge cluster, staggered needle sweep,
// unsafe bands pulse, recommendation callout"): schedule_water_test's real payload
// (water-test/policy.schema.ts's WaterTestPayloadSchema) is a SCHEDULING action —
// address/contact/requestedAt/technicianId/notes — it carries no water-quality
// readings (hardness/iron/pfoa/etc). Those readings belong to a different action
// type entirely (generate_compliance_summary, compliance-documentation plugin — a
// D7-wave-2 flagship, not this one). Rather than fabricate synthetic reading numbers
// on this type's real payload (hard rule #7: never fake data, "honest spectacle"),
// this keeps the plan's visual vocabulary — a radial gauge + needle + banded
// severity + callout — but points it at what's REAL here: a "time until this test"
// gauge banded past-due/imminent/comfortable, and the real `notes` field as the
// recommendation callout (verbatim, not synthesized).

import { useEffect, useState } from "react"
import { Droplets, User, Phone, MapPin } from "lucide-react"
import { motion, useReducedMotion } from "framer-motion"
import { Enter } from "../../motion/primitives"
import { Panel } from "../../primitives/Panel"
import { EASE } from "../../motion/tokens"
import type { ActionRendererProps } from "../types"

interface WaterTestPayload {
  address?: string
  contactName?: string
  contactPhone?: string
  requestedAt?: string
  technicianId?: string
  notes?: string
}

type Band = "past_due" | "imminent" | "comfortable" | "unscheduled"

function bandFor(requestedAt?: string): { band: Band; hoursOut: number | null } {
  if (!requestedAt) return { band: "unscheduled", hoursOut: null }
  const hoursOut = (new Date(requestedAt).getTime() - Date.now()) / 3_600_000
  if (hoursOut < 0) return { band: "past_due", hoursOut }
  if (hoursOut < 48) return { band: "imminent", hoursOut }
  return { band: "comfortable", hoursOut }
}

const BAND_COLOR: Record<Band, string> = {
  past_due: "#f87171",
  imminent: "#fbbf24",
  comfortable: "#34d399",
  unscheduled: "#64809f",
}
const BAND_LABEL: Record<Band, string> = {
  past_due: "past due",
  imminent: "imminent",
  comfortable: "scheduled ahead",
  unscheduled: "not yet scheduled",
}

/** Needle angle: -90deg (far past due) through 0 (now) to +90 (7 days out), clamped. */
function needleAngle(hoursOut: number | null): number {
  if (hoursOut === null) return 0
  const days = hoursOut / 24
  const clamped = Math.max(-2, Math.min(7, days))
  return (clamped / 7) * 90
}

export function WaterTestScene({ payload, compact }: ActionRendererProps) {
  const p = (payload && typeof payload === "object" ? payload : {}) as WaterTestPayload
  const reducedRaw = useReducedMotion()
  const reduced = reducedRaw ?? false
  const { band, hoursOut } = bandFor(p.requestedAt)
  const angle = needleAngle(hoursOut)
  const [swept, setSwept] = useState(reduced ? angle : -90)

  useEffect(() => {
    if (reduced) {
      setSwept(angle)
      return
    }
    const t = window.setTimeout(() => setSwept(angle), 50)
    return () => window.clearTimeout(t)
  }, [angle, reduced])

  if (compact) {
    return (
      <span className="inline-flex items-center gap-1.5 text-[11px]">
        <Droplets className="h-3 w-3 shrink-0 text-cyan-300" />
        <span className="truncate text-[color:var(--j-text)]">
          water test · {p.address ?? "address pending"} · {BAND_LABEL[band]}
        </span>
      </span>
    )
  }

  return (
    <Enter>
      <Panel className="border border-cyan-400/25 p-3">
        <div className="mb-2 flex items-center gap-1.5">
          <Droplets className="h-3.5 w-3.5 text-cyan-300" />
          <span className="text-[9px] font-black uppercase tracking-widest text-cyan-300">Water Test Scheduled</span>
        </div>

        <div className="flex items-center gap-4">
          <svg viewBox="0 0 100 60" width={110} height={66} className="shrink-0 overflow-visible">
            <path d="M 10 55 A 40 40 0 0 1 90 55" fill="none" stroke="rgba(248,113,113,0.35)" strokeWidth={8} strokeLinecap="round" />
            <path d="M 22 26 A 40 40 0 0 1 78 26" fill="none" stroke="rgba(251,191,36,0.35)" strokeWidth={8} strokeLinecap="round" />
            <path d="M 50 15 A 40 40 0 0 1 90 55" fill="none" stroke="rgba(52,211,153,0.35)" strokeWidth={8} strokeLinecap="round" />
            <motion.line
              x1={50}
              y1={55}
              x2={50}
              y2={18}
              stroke={BAND_COLOR[band]}
              strokeWidth={2.5}
              strokeLinecap="round"
              style={{ originX: "50px", originY: "55px" }}
              animate={{ rotate: swept }}
              transition={reduced ? { duration: 0 } : { duration: 0.9, ease: EASE.decelerate }}
            />
            <circle cx={50} cy={55} r={3.5} fill={BAND_COLOR[band]} />
          </svg>
          <div className="min-w-0 flex-1">
            <div className="text-[11px] font-black" style={{ color: BAND_COLOR[band] }}>
              {BAND_LABEL[band]}
            </div>
            <div className="mt-1 flex items-center gap-1 text-[10.5px] text-[color:var(--j-text-dim)]">
              <MapPin className="h-2.5 w-2.5 shrink-0" /> <span className="truncate">{p.address ?? "—"}</span>
            </div>
            {p.contactName && (
              <div className="mt-0.5 flex items-center gap-1 text-[10.5px] text-[color:var(--j-text-dim)]">
                <User className="h-2.5 w-2.5 shrink-0" /> {p.contactName}
              </div>
            )}
            {p.contactPhone && (
              <div className="mt-0.5 flex items-center gap-1 text-[10.5px] text-[color:var(--j-text-dim)]">
                <Phone className="h-2.5 w-2.5 shrink-0" /> {p.contactPhone}
              </div>
            )}
          </div>
        </div>

        {p.notes && (
          <div className="mt-2 rounded-lg border border-white/8 bg-white/[0.02] p-2 text-[10.5px] leading-relaxed text-[color:var(--j-text-dim)]">
            {p.notes}
          </div>
        )}
      </Panel>
    </Enter>
  )
}
