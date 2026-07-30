"use client"

// jarvis-v3 P5.T4 (§7.2) — the designed generic renderer for "every other
// action type": a genuinely UNREGISTERED action type (`getRendererEntry()`
// returns undefined — every one of the 41+1 real types this repo has today
// IS registered, so this is the honest backstop for a future/typo'd type,
// same posture `FallbackRenderer` documented for itself). Spec: plugin-family
// accent stripe (left, 3px), human-cased title, a field list with typed
// formatting, an evidence footer, a "Show details" disclosure — never raw
// JSON. Reuses `fields.ts`'s existing formatters (the exact ones
// `StandardRenderer` already uses for the 30 hand-authored types) rather than
// a second formatting implementation; StandardRenderer itself is untouched
// — this is the NEW default/fallback tier, not a replacement for the
// already-working "standard" tier.
//
// FallbackRenderer -> owner-debug only (closes DEFECT LEDGER NEW-8): raw
// JSON is still real code (unchanged, same file), but it is only ever
// mounted from behind THIS card's own owner-gated toggle now — never
// ActionRenderer's automatic default for an unregistered type.

import { useState } from "react"
import { ChevronDown } from "lucide-react"
import { Panel } from "../primitives/Panel"
import { formatFieldValue, formatUnknownValue, prettifyKey } from "./fields"
import { ACCENT_CLASS, PLUGIN_META } from "./PluginMeta"
import { useJarvisAuth } from "../../lib/jarvis-auth"
import { FallbackRenderer } from "./FallbackRenderer"
import type { ActionRendererProps, FieldSpec } from "./types"

const NEUTRAL_ACCENT = { bg: "bg-white/6", text: "text-white/55", border: "border-white/15" }
const STRIPE_CLASS: Record<string, string> = {
  cyan: "bg-cyan-400/70",
  teal: "bg-teal-300/70",
  violet: "bg-violet-400/70",
  amber: "bg-amber-300/70",
}
const VISIBLE_ROWS_COLLAPSED = 4

function humanizeActionType(actionType: string): string {
  return actionType.replaceAll("_", " ").replace(/^./, (c) => c.toUpperCase())
}

interface SchemaCardProps extends ActionRendererProps {
  /** Supplied when the registry DOES know the plugin (kept optional — the
   *  true fallback path, `ActionRenderer.tsx`'s own `!entry` branch, has no
   *  plugin to give it, since that's exactly what "unregistered" means). */
  plugin?: string
  label?: string
  fields?: FieldSpec[]
}

interface Row {
  key: string
  label: string
  value: string
}

export function SchemaCard({ actionType, payload, compact, plugin, label, fields = [] }: SchemaCardProps) {
  const { role } = useJarvisAuth()
  const [expanded, setExpanded] = useState(false)
  const [showRawDebug, setShowRawDebug] = useState(false)

  const meta = plugin ? PLUGIN_META[plugin] : undefined
  const accent = meta ? (ACCENT_CLASS[meta.accent] ?? NEUTRAL_ACCENT) : NEUTRAL_ACCENT
  const stripe = meta ? (STRIPE_CLASS[meta.accent] ?? "bg-white/25") : "bg-white/25"
  const Icon = meta?.icon
  const title = meta?.label ?? label ?? humanizeActionType(actionType)

  const obj = payload && typeof payload === "object" ? (payload as Record<string, unknown>) : {}
  const knownKeys = new Set(fields.map((f) => f.key))
  const rows: Row[] = [
    ...fields.filter((f) => obj[f.key] !== undefined).map((f) => ({ key: f.key, label: f.label, value: formatFieldValue(f.kind, obj[f.key]) })),
    ...Object.keys(obj)
      .filter((k) => !knownKeys.has(k) && obj[k] !== undefined)
      .map((k) => ({ key: k, label: prettifyKey(k), value: formatUnknownValue(obj[k]) })),
  ]
  const visibleRows = expanded ? rows : rows.slice(0, VISIBLE_ROWS_COLLAPSED)
  const hiddenCount = rows.length - visibleRows.length

  if (compact) {
    const first = rows[0]
    return (
      <span className="inline-flex min-w-0 items-center gap-1.5 text-[11px]">
        {Icon && <Icon className={`h-3 w-3 shrink-0 ${accent.text}`} />}
        <span className="truncate text-[color:var(--j-text)]">{first ? `${first.label}: ${first.value}` : title}</span>
      </span>
    )
  }

  return (
    <Panel className={`relative overflow-hidden border p-3 pl-4 ${accent.border}`}>
      <span className={`absolute inset-y-0 left-0 w-[3px] ${stripe}`} aria-hidden />
      <div className="mb-2 flex items-center gap-1.5">
        {Icon && <Icon className={`h-3.5 w-3.5 ${accent.text}`} />}
        <span className={`text-[9px] font-black uppercase tracking-widest ${accent.text}`}>{title}</span>
      </div>

      {rows.length === 0 ? (
        <div className="py-2 text-center text-[10px] text-[color:var(--j-text-faint)]">No payload fields set yet</div>
      ) : (
        <div className="space-y-0">
          {visibleRows.map((r) => (
            <div key={r.key} className="flex items-baseline justify-between gap-3 border-b border-white/[0.04] py-1 last:border-0">
              <span className="shrink-0 text-[9.5px] font-bold uppercase tracking-wide text-[color:var(--j-text-faint)]">{r.label}</span>
              <span className="truncate text-right text-[11px] text-[color:var(--j-text)]">{r.value}</span>
            </div>
          ))}
        </div>
      )}

      {rows.length > VISIBLE_ROWS_COLLAPSED && (
        <button
          type="button"
          onClick={() => setExpanded((e) => !e)}
          className="mt-2 inline-flex items-center gap-1 text-[9.5px] font-black uppercase tracking-wide text-cyan-300"
          aria-expanded={expanded}
        >
          <ChevronDown className={`h-2.5 w-2.5 transition-transform ${expanded ? "rotate-180" : ""}`} />
          {expanded ? "Show less" : `Show details (${hiddenCount} more)`}
        </button>
      )}

      <div className="mt-2 border-t border-white/[0.06] pt-2 text-[9px] text-[color:var(--j-text-faint)]">
        Rendered from the real action payload — no dedicated card exists yet for <span className="font-mono">{actionType}</span>.
      </div>

      {role === "owner" && (
        <div className="mt-1">
          <button
            type="button"
            onClick={() => setShowRawDebug((s) => !s)}
            className="text-[9px] font-black uppercase tracking-wide text-white/25 hover:text-white/50"
          >
            {showRawDebug ? "Hide owner debug view" : "Owner debug: view raw payload"}
          </button>
          {showRawDebug && (
            <div className="mt-1">
              <FallbackRenderer actionType={actionType} payload={payload} />
            </div>
          )}
        </div>
      )}
    </Panel>
  )
}
