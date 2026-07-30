"use client"

import type { JarvisMode } from "../kernel/types"

const LABEL: Record<JarvisMode, string | null> = {
  production: null,
  showcase: "SYNTHETIC DAY · 60×",
  preview: "PUBLIC PREVIEW",
}

export function ModeChip({ mode }: { mode: JarvisMode }) {
  const label = LABEL[mode]
  if (!label) return null
  return <span className="j-chip border border-amber-300/30 bg-amber-300/10 font-black tracking-wider text-amber-100" role="status">{label}</span>
}
