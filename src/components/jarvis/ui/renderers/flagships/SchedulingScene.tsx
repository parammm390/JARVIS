"use client"

// D3.T3 — flagship 5/8: scheduling plugin's 3 action types (assign_technician_to_visit,
// check_technician_availability, reschedule_visit) share one scene. "Slots
// materialize, chosen slot locks with click animation, load bars."
//
// Real shape note: only check_technician_availability's EXECUTE() output carries the
// actual slot/load data (workingHours, bookedThatDay[], openForBooking) — its own
// draft payload is just {technicianId?, technicianName?, date}. reschedule_visit's
// payload (visitId, newTime, reason?) is the "chosen slot locks" case. This scene
// renders whichever real shape is present rather than always assuming the richer one.

import { CalendarClock, Lock } from "lucide-react"
import { Stagger } from "../../motion/primitives"
import { Panel } from "../../primitives/Panel"
import { formatDateTime, formatTimeOnly } from "../fields"
import type { ActionRendererProps } from "../types"

interface BookedSlot {
  at: string
  type: string
  address?: string
}
interface SchedulingPayload {
  visitId?: string
  technicianId?: string
  technicianName?: string
  date?: string
  newTime?: string
  reason?: string
  workingHours?: { start: string; end: string }
  bookedThatDay?: BookedSlot[]
  openForBooking?: boolean
}

export function SchedulingScene({ payload, compact }: ActionRendererProps) {
  const p = (payload && typeof payload === "object" ? payload : {}) as SchedulingPayload
  const hasAvailability = Array.isArray(p.bookedThatDay) || p.workingHours
  const isReschedule = !!p.newTime
  // Real bug found + fixed via this session's own Stage screenshot verification:
  // assign_technician_to_visit's real payload ({visitId, technicianId?,
  // technicianName?}) has neither newTime nor availability fields, so it used to
  // silently fall into "technician availability" — wrong for an assignment. A third,
  // explicit "assign" kind (visitId present, no reschedule/availability fields)
  // keeps all 3 action types honestly distinguishable, not just 2.
  const isAssign = !isReschedule && !hasAvailability && !!p.visitId

  if (compact) {
    return (
      <span className="inline-flex items-center gap-1.5 text-[11px]">
        <CalendarClock className="h-3 w-3 shrink-0 text-cyan-300" />
        <span className="truncate text-[color:var(--j-text)]">
          {isReschedule
            ? `reschedule → ${formatDateTime(p.newTime!)}`
            : isAssign
              ? `assigned ${p.technicianName ?? "technician"} to visit`
              : (p.technicianName ?? "technician") + " availability"}
        </span>
      </span>
    )
  }

  return (
    <Panel className="border border-cyan-400/25 p-3">
      <div className="mb-2 flex items-center gap-1.5">
        <CalendarClock className="h-3.5 w-3.5 text-cyan-300" />
        <span className="text-[9px] font-black uppercase tracking-widest text-cyan-300">
          {isReschedule ? "Reschedule Visit" : isAssign ? "Assign Technician to Visit" : "Technician Availability"}
        </span>
      </div>

      {isAssign ? (
        <div className="flex items-center gap-2 rounded-lg border border-cyan-400/30 bg-cyan-400/[0.06] px-3 py-2">
          <CalendarClock className="h-3.5 w-3.5 shrink-0 text-cyan-200" />
          <div className="min-w-0">
            <div className="text-[11px] font-black text-cyan-100">{p.technicianName ?? "technician"}</div>
            <div className="truncate text-[10px] text-[color:var(--j-text-faint)]">visit {p.visitId!.slice(0, 8)}…</div>
          </div>
        </div>
      ) : isReschedule ? (
        <div className="flex items-center gap-2 rounded-lg border border-cyan-400/30 bg-cyan-400/[0.06] px-3 py-2">
          <Lock className="h-3.5 w-3.5 shrink-0 text-cyan-200" />
          <div className="min-w-0">
            <div className="text-[11px] font-black text-cyan-100">{formatDateTime(p.newTime!)}</div>
            {p.reason && <div className="truncate text-[10px] text-[color:var(--j-text-faint)]">{p.reason}</div>}
          </div>
        </div>
      ) : hasAvailability ? (
        <>
          {p.workingHours && (
            <div className="mb-1.5 text-[10.5px] text-[color:var(--j-text-dim)]">
              working hours: <span className="font-black text-[color:var(--j-text)]">{p.workingHours.start}–{p.workingHours.end}</span>
            </div>
          )}
          <Stagger staggerMs={25} className="space-y-1">
            {(p.bookedThatDay ?? []).map((slot, i) => (
              <div key={i} className="flex items-center justify-between rounded-lg bg-white/[0.03] px-2 py-1 text-[10.5px]">
                <span className="text-[color:var(--j-text-dim)]">{formatTimeOnly(slot.at)}</span>
                <span className="truncate text-[color:var(--j-text)]">{slot.type}</span>
              </div>
            ))}
          </Stagger>
          {(p.bookedThatDay ?? []).length === 0 && <div className="text-[10.5px] text-[color:var(--j-text-faint)]">No bookings that day</div>}
          <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-white/8">
            <div
              className={`h-full rounded-full ${p.openForBooking === false ? "bg-red-400/60" : "bg-teal-300/60"}`}
              style={{ width: `${Math.min(100, ((p.bookedThatDay?.length ?? 0) / 8) * 100)}%` }}
            />
          </div>
          <div className="mt-1 text-[9.5px] text-[color:var(--j-text-faint)]">{p.openForBooking === false ? "fully booked" : "open for booking"}</div>
        </>
      ) : (
        <div className="text-[10.5px] text-[color:var(--j-text-faint)]">{p.technicianName ?? "technician"} · {p.date ?? "date pending"}</div>
      )}
    </Panel>
  )
}
