"use client"

// D3.T3 — flagship 7/8: bulk_notify_existing_customers (bulk-notify plugin).
// "FLOW-19 radar + volume-safety meter + send-window."
//
// Real shape note: `targets: ConsentedTarget[]` only exists after draft() runs
// (bulk-notify/index.ts:168-196) — the raw approval payload the plugin schema
// validates is offerScript/channel/voicePersona/discount/window fields only. Renders
// whichever is present; the volume-safety meter uses the real target count against
// this plugin's own DAILY_VAPI_CALL_CAP constant when targets are present, never a
// fabricated cap.

import { motion, useReducedMotion } from "framer-motion"
import { Radio } from "lucide-react"
import { Panel } from "../../primitives/Panel"
import { choreo } from "../../motion/choreo"
import type { ActionRendererProps } from "../types"

const DAILY_VAPI_CALL_CAP = 500 // mirrors bulk-notify/index.ts's own real constant

interface ConsentedTarget {
  householdId: string
  label: string
  phone: string
  equipmentSummary?: string
}
interface BulkNotifyPayload {
  offerScript?: string
  channel?: "sms" | "call"
  voicePersona?: string
  minMonthsInactive?: number
  maxMonthsInactive?: number
  discountPercent?: number
  targets?: ConsentedTarget[]
}

export function BulkNotifyScene({ payload, compact }: ActionRendererProps) {
  const p = (payload && typeof payload === "object" ? payload : {}) as BulkNotifyPayload
  const reducedRaw = useReducedMotion()
  const reduced = reducedRaw ?? false
  const count = p.targets?.length ?? 0
  const cap = p.channel === "call" ? DAILY_VAPI_CALL_CAP : Infinity
  const overCap = Number.isFinite(cap) && count > cap

  if (compact) {
    return (
      <span className="inline-flex items-center gap-1.5 text-[11px]">
        <Radio className="h-3 w-3 shrink-0 text-amber-300" />
        <span className="truncate text-[color:var(--j-text)]">
          bulk notify · {p.channel ?? "sms"} {count > 0 ? `· ${count} targets` : ""}
        </span>
      </span>
    )
  }

  return (
    <Panel className="border border-amber-300/25 p-3">
      <div className="mb-2 flex items-center gap-1.5">
        <div className="relative flex h-4 w-4 shrink-0 items-center justify-center">
          <Radio className="relative z-10 h-3.5 w-3.5 text-amber-300" />
          {/* Real hydration bug found + fixed via this session's own Playwright
              emulateMedia({reducedMotion:'reduce'}) pass: `{!reduced && [...]}`
              conditioned the SPANS' EXISTENCE on `reduced`, and SSR always resolves
              `reduced=false` (no window), so a real reduced-motion client's first
              render (spans absent) genuinely differed from SSR's markup (spans
              present) — a real mismatch, not cosmetic. Same fix C2 already
              established for Enter/Flight: always mount the same elements; only the
              variants/transition differ (radarSweep's own reducedVariants already
              resolve to an invisible opacity:0 end-state, so reduced mode is
              visually inert without changing the tree shape). */}
          {[0, 0.6, 1.2].map((delay) => (
            <motion.span
              key={delay}
              className="absolute inset-0 rounded-full border border-amber-300/50"
              variants={reduced ? choreo.radarSweep.reducedVariants : choreo.radarSweep.variants}
              initial="initial"
              animate="animate"
              transition={reduced ? { duration: 0 } : { delay }}
            />
          ))}
        </div>
        <span className="text-[9px] font-black uppercase tracking-widest text-amber-200">Bulk Notify — {p.channel ?? "sms"}</span>
      </div>

      {p.offerScript && <div className="mb-2 rounded-lg bg-white/[0.03] p-2 text-[10.5px] text-[color:var(--j-text-dim)]">{p.offerScript}</div>}
      {typeof p.discountPercent === "number" && (
        <div className="mb-1 text-[10.5px] text-[color:var(--j-text-dim)]">
          discount: <span className="font-black text-[color:var(--j-text)]">{p.discountPercent}%</span>
        </div>
      )}

      <div className="mt-1">
        <div className="mb-1 flex items-center justify-between text-[9.5px] font-black uppercase tracking-wide text-[color:var(--j-text-faint)]">
          <span>volume safety</span>
          <span className={overCap ? "text-red-300" : "text-teal-300"}>
            {count} {Number.isFinite(cap) ? `/ ${cap}` : ""}
          </span>
        </div>
        <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/8">
          <div
            className={`h-full rounded-full ${overCap ? "bg-red-400/70" : "bg-teal-300/60"}`}
            style={{ width: `${Number.isFinite(cap) ? Math.min(100, (count / cap) * 100) : count > 0 ? 100 : 0}%` }}
          />
        </div>
      </div>

      {(typeof p.minMonthsInactive === "number" || typeof p.maxMonthsInactive === "number") && (
        <div className="mt-2 text-[9.5px] text-[color:var(--j-text-faint)]">
          send window: {p.minMonthsInactive ?? 0}–{p.maxMonthsInactive ?? "∞"} months inactive
        </div>
      )}
    </Panel>
  )
}
