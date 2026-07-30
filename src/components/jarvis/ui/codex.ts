// F1.T1 — the codex: elevation ladder, type scale, z-map, spacing rhythm, icon
// rules. Every value here is EXTRACTED from real call sites (grepped 2026-07-27
// across src/components/jarvis/**/*.tsx), not invented — the plan's own rule (§2,
// F1.T1: "extracted stops, not invented"). This is the single source of truth F1+
// components read from; no new ad-hoc px/z-index literal should appear in jarvis
// code after this file exists without a reason to deviate noted inline.

// ---- TYPE — extracted stops (grep counts as of 2026-07-27) ----
// j-fs-micro (131), j-fs-micro (122), j-fs-micro (84), j-fs-sm (41),
// j-fs-micro (30), j-fs-micro (24), j-fs-sm (18), j-fs-sm (11),
// j-fs-sm (8), j-fs-micro (7), j-fs-micro (5), j-fs-base (5, headers),
// text-xl/2xl/3xl (14, hero metrics via Tailwind scale not px literals).
export const TYPE = {
  display: { size: "15px", weight: 900, tracking: "-0.01em" },
  metric: { size: "22px", weight: 900, tracking: "0", numeric: "tabular-nums" as const },
  metricHero: { size: "28px", weight: 900, tracking: "0", numeric: "tabular-nums" as const },
  title: { size: "12.5px", weight: 700, tracking: "0" },
  body: { size: "11px", weight: 500, tracking: "0" },
  bodyDim: { size: "11px", weight: 500, tracking: "0", color: "var(--j-text-dim)" },
  label: { size: "11px", weight: 700, tracking: "0.18em", transform: "uppercase" as const },
  micro: { size: "9px", weight: 700, tracking: "0.28em", transform: "uppercase" as const, color: "var(--j-text-faint)" },
} as const

// ---- ELEVATION — E0-E4 ladder (plan §2). Every surface declares its tier; two
// adjacent surfaces never share a tier by accident. ----
export type ElevationTier = "E0" | "E1" | "E2" | "E3" | "E4"

export const ELEVATION: Record<ElevationTier, { border: string; blur: string; glow: boolean; shadow: string }> = {
  // E0 flush — ticker chips, rail meta. No border, no blur.
  E0: { border: "none", blur: "none", glow: false, shadow: "none" },
  // E1 utility — compressed cards, thin border, no glow.
  E1: { border: "1px solid rgba(59, 130, 246, 0.10)", blur: "none", glow: false, shadow: "0 4px 12px rgba(2, 6, 16, 0.3)" },
  // E2 standard — .j-panel as shipped.
  E2: { border: "1px solid var(--j-border)", blur: "18px", glow: false, shadow: "0 18px 44px rgba(2, 6, 16, 0.55)" },
  // E3 hero — .j-panel + j-hud brackets + ambient (max 1-2 per scene).
  E3: { border: "1px solid var(--j-border-hot)", blur: "18px", glow: true, shadow: "0 0 26px rgba(34, 211, 238, 0.18), 0 18px 44px rgba(2, 6, 16, 0.55)" },
  // E4 overlay — drawers, palette, toasts. Deepest shadow, backdrop dim.
  E4: { border: "1px solid var(--j-border-hot)", blur: "20px", glow: true, shadow: "0 30px 80px rgba(0, 0, 0, 0.6)" },
}

// ---- Z-MAP — extracted from real z-* usage (z-10 ×5, z-20 ×3, z-30 ×1, z-40 ×1,
// z-50 ×4, z-60/61 ×3, z-70 ×1, z-100 ×2, z-[9999] ×2). Named so new work reaches
// for a layer by intent instead of picking an arbitrary number. ----
export const Z = {
  base: 0,
  rise: 10, // rising ambient elements (bubbles, meteors) above panel content
  sticky: 20, // sticky section nav, in-panel pinned headers
  dropdown: 30, // menus, popovers, tooltips
  bar: 40, // fixed bars (nav, command bar)
  overlayBackdrop: 60,
  overlayPanel: 61,
  toast: 70,
  modal: 100,
  devHud: 9999, // FPS meter, debug-only overlays — never shipped to customers
} as const

// ---- SPACING RHYTHM — the 4px-stepped scale already implicit in existing
// p-3/p-4/p-5 + gap-2/gap-3 usage; named so new panels pick from this, not a
// one-off arbitrary value. ----
export const SPACE = {
  xs: "0.375rem", // 6px — chip/badge internal padding
  sm: "0.5rem", // 8px
  md: "0.75rem", // 12px — default panel gap
  lg: "1rem", // 16px — default panel padding
  xl: "1.25rem", // 20px — section padding
} as const

// ---- ICON RULES — sizes observed at real call sites (lucide icons sized via
// className, predominantly h-3.5/h-4 in labels+chips, h-5/h-6 in headers). ----
export const ICON = {
  inline: "0.875rem", // 14px — inline with label/body text
  standard: "1rem", // 16px — default control icon
  header: "1.25rem", // 20px — section/header icon
} as const
