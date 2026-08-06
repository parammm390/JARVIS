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
  return <span className="j-environment-label j-fs-micro max-w-full whitespace-nowrap font-bold uppercase tracking-[.1em]" data-jarvis-environment-label aria-label={`Environment: ${label}`}>{label}</span>
}
