"use client"

// D3.T1 — the single dispatch component every consumer (approvals, feed, receipts)
// imports. Never branches per-caller: the SAME component/tier resolution runs in all
// three contexts, only `compact` differs — that's what makes "same renderer proven
// in feed + approval + receipt contexts" (the EXIT GATE wording) a real claim rather
// than three parallel implementations that happen to look similar.

import { StandardRenderer } from "./StandardRenderer"
import { FallbackRenderer } from "./FallbackRenderer"
import { getRendererEntry } from "./registry"
import type { ActionRendererProps } from "./types"

export function ActionRenderer({ actionType, payload, compact }: ActionRendererProps) {
  const entry = getRendererEntry(actionType)
  if (!entry) return <FallbackRenderer actionType={actionType} payload={payload} compact={compact} />
  if (entry.tier === "flagship" && entry.Component) {
    const Component = entry.Component
    return <Component actionType={actionType} payload={payload} compact={compact} />
  }
  return (
    <StandardRenderer actionType={actionType} payload={payload} compact={compact} plugin={entry.plugin} label={entry.label} fields={entry.fields ?? []} />
  )
}
