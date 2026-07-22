"use client"

// D3.T1 — the "standard tier": a schema-driven designed card for the 33 action types
// that don't get a bespoke flagship scene. Plugin-family icon/color (PluginMeta.ts) +
// a real field list per type (each hand-authored from that plugin's actual zod
// schema, not guessed) instead of a JSON dump. Any payload key not in the type's
// FieldSpec list still renders as a labeled row (fields.ts's formatUnknownValue) —
// real-world payloads carrying extra fields never fall back to raw JSON.

import { Enter, Stagger } from "../motion/primitives"
import { Panel } from "../primitives/Panel"
import { formatFieldValue, formatUnknownValue, prettifyKey } from "./fields"
import { ACCENT_CLASS, PLUGIN_META } from "./PluginMeta"
import type { ActionRendererProps, FieldSpec } from "./types"

function FieldRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-white/[0.04] py-1 last:border-0">
      <span className="shrink-0 text-[9.5px] font-bold uppercase tracking-wide text-[color:var(--j-text-faint)]">{label}</span>
      <span className="truncate text-right text-[11px] text-[color:var(--j-text)]">{value}</span>
    </div>
  )
}

export function StandardRenderer({
  actionType,
  payload,
  plugin,
  label,
  fields,
  compact,
}: ActionRendererProps & { plugin: string; label: string; fields: FieldSpec[] }) {
  const meta = PLUGIN_META[plugin]
  const accent = ACCENT_CLASS[meta?.accent ?? "cyan"]!
  const Icon = meta?.icon
  const obj = payload && typeof payload === "object" ? (payload as Record<string, unknown>) : {}
  const knownKeys = new Set(fields.map((f) => f.key))
  const extraKeys = Object.keys(obj).filter((k) => !knownKeys.has(k) && obj[k] !== undefined)

  if (compact) {
    const first = fields.find((f) => obj[f.key] !== undefined && obj[f.key] !== null)
    const preview = first ? formatFieldValue(first.kind, obj[first.key]) : label
    return (
      <span className="inline-flex min-w-0 items-center gap-1.5 text-[11px]">
        {Icon && <Icon className={`h-3 w-3 shrink-0 ${accent.text}`} />}
        <span className="truncate text-[color:var(--j-text)]">{preview}</span>
      </span>
    )
  }

  return (
    <Enter>
      <Panel className={`border p-3 ${accent.border}`}>
        <div className="mb-2 flex items-center gap-1.5">
          {Icon && <Icon className={`h-3.5 w-3.5 ${accent.text}`} />}
          <span className={`text-[9px] font-black uppercase tracking-widest ${accent.text}`}>{meta?.label ?? label}</span>
          <span className="ml-auto rounded-full bg-white/6 px-2 py-0.5 text-[8.5px] font-black uppercase text-white/40">
            {actionType.replaceAll("_", " ")}
          </span>
        </div>
        <Stagger staggerMs={20} className="space-y-0">
          {[
            ...fields
              .filter((f) => obj[f.key] !== undefined)
              .map((f) => <FieldRow key={f.key} label={f.label} value={formatFieldValue(f.kind, obj[f.key])} />),
            ...extraKeys.map((k) => <FieldRow key={k} label={prettifyKey(k)} value={formatUnknownValue(obj[k])} />),
          ]}
        </Stagger>
        {fields.every((f) => obj[f.key] === undefined) && extraKeys.length === 0 && (
          <div className="py-2 text-center text-[10px] text-[color:var(--j-text-faint)]">No payload fields set yet</div>
        )}
      </Panel>
    </Enter>
  )
}
