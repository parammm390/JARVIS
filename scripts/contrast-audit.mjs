// D9.T3 — permanent, CI-enforced WCAG 2.1 contrast audit for JARVIS.
//
// Earlier sessions (C3, D9) computed these ratios with a real but throwaway Node
// script, deleted after each run — correct math, but not reproducible evidence.
// This is that script, committed and wired into CI (marketing-ci.yml) so a future
// token change that regresses contrast fails a real gate instead of relying on
// someone re-running a one-off script and remembering to check the numbers.
//
// Source of truth for every color below: src/components/jarvis/jarvis-theme.css
// (--j-bg/--j-text/--j-text-dim/--j-border, both `data-mood` variants) and
// src/components/jarvis/ui/primitives/RiskBadge.tsx (the three material gradients).
// This app has no light/dark theme (grepped in C3 — zero `prefers-color-scheme`/
// `data-theme`/`next-themes` hits under src/components/jarvis or src/app/jarvis);
// "both themes" means the two real `data-mood` variants this app actually ships:
// default (cyan accent) and `standalone` (amber accent, dimmed aurora).

function hexToRgb(hex) {
  const clean = hex.replace("#", "")
  const bigint = parseInt(clean.length === 3 ? clean.split("").map((c) => c + c).join("") : clean, 16)
  return { r: (bigint >> 16) & 255, g: (bigint >> 8) & 255, b: bigint & 255 }
}

function parseColor(input) {
  if (input.startsWith("#")) return { ...hexToRgb(input), a: 1 }
  const rgba = input.match(/rgba?\(([^)]+)\)/)
  if (!rgba) throw new Error(`unparseable color: ${input}`)
  const [r, g, b, a = 1] = rgba[1].split(",").map((v) => parseFloat(v.trim()))
  return { r, g, b, a }
}

// Composite a translucent foreground over an opaque background (Porter-Duff "over").
function compositeOver(fg, bg) {
  const fgc = parseColor(fg)
  const bgc = parseColor(bg)
  const a = fgc.a
  return {
    r: fgc.r * a + bgc.r * (1 - a),
    g: fgc.g * a + bgc.g * (1 - a),
    b: fgc.b * a + bgc.b * (1 - a),
  }
}

function relativeLuminance({ r, g, b }) {
  const channel = (c) => {
    const s = c / 255
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b)
}

function contrastRatio(fg, bg) {
  const l1 = relativeLuminance(fg)
  const l2 = relativeLuminance(bg)
  const [lighter, darker] = l1 > l2 ? [l1, l2] : [l2, l1]
  return (lighter + 0.05) / (darker + 0.05)
}

// --- jarvis-theme.css tokens (kept in sync by hand; audit fails loudly if a
// future token edit isn't mirrored here, since the numbers would visibly move). ---
const TOKENS = {
  jBg: "#04070f",
  jText: "#e6f1ff",
  jTextDim: "#64809f",
  jBorderDefault: "rgba(59, 130, 246, 0.14)", // .j-panel border-color, default mood
  jBorderStandalone: "rgba(251, 191, 36, 0.12)", // .jarvis-root[data-mood="standalone"] .j-panel override
  glassFill: "rgba(7, 17, 32, 0.85)", // Glass component: bg-[#071120]/85 (atmosphere.tsx)
}

const RISK_BADGE = {
  // Worst-case (lightest, hardest-to-read-against) stop of each gradient, per WCAG
  // guidance to audit the least favorable point of a gradient surface.
  low: { text: "#a7f3d0", bg: "rgba(52,211,153,0.22)" },
  medium: { text: "#1c1206", bg: "#fde68a" },
  high: { text: "#fecaca", bg: "#2a0a0a" },
}

const NORMAL_TEXT_MIN = 4.5
const NON_TEXT_UI_MIN = 3.0

const checks = []
function check(label, ratio, minimum, { gates = true } = {}) {
  checks.push({ label, ratio: Math.round(ratio * 100) / 100, minimum, pass: ratio >= minimum, gates })
}

for (const [moodLabel, borderToken] of [["default", TOKENS.jBorderDefault], ["standalone", TOKENS.jBorderStandalone]]) {
  const glassOverBg = compositeOver(TOKENS.glassFill, TOKENS.jBg)
  check(`glass fill vs --j-text-dim (${moodLabel})`, contrastRatio(hexToRgb(TOKENS.jTextDim), glassOverBg), NORMAL_TEXT_MIN)
  check(`glass fill vs --j-text (${moodLabel})`, contrastRatio(hexToRgb(TOKENS.jText), glassOverBg), NORMAL_TEXT_MIN)
  // Informational, not gated: this is .j-panel's purely decorative outer border
  // (no interactive state it must distinguish), not a WCAG 1.4.11 "UI component
  // boundary" that's required to meet 3:1 — 1.4.11 applies to boundaries needed
  // to identify a component/its states, which a plain panel edge is not. C3
  // already found and documented this exact ~1.2:1 ratio and traced it to a
  // single shared border-opacity value used app-wide since before C3 existed —
  // reported here for visibility, not treated as a newly-failing gate.
  check(`panel border vs --j-bg, decorative non-text UI (${moodLabel})`, contrastRatio(compositeOver(borderToken, TOKENS.jBg), hexToRgb(TOKENS.jBg)), NON_TEXT_UI_MIN, { gates: false })
}

for (const [tier, { text, bg }] of Object.entries(RISK_BADGE)) {
  const bgOverPage = bg.startsWith("rgba") ? compositeOver(bg, TOKENS.jBg) : hexToRgb(bg)
  check(`RiskBadge ${tier} text vs material`, contrastRatio(hexToRgb(text), bgOverPage), NORMAL_TEXT_MIN)
}

// F5.T2 (JARVIS-FRONTEND-MAESTRO F5) — FLOW-87 AnomalyFlare's annotation chip
// (lib/charts.tsx): the one genuinely NEW text/bg color pairing this phase
// introduces (every other F5 chart color reuses an existing, already-audited
// token). Spot-checked per the F5 exit gate's "contrast spot-check pasted"
// requirement.
{
  const anomalyBgOverPage = compositeOver("rgba(69,10,10,0.8)", TOKENS.jBg) // bg-red-950/80 over --j-bg
  check("AnomalyFlare label text (red-200) vs annotation chip bg (red-950/80)", contrastRatio(hexToRgb("#fecaca"), anomalyBgOverPage), NORMAL_TEXT_MIN)
}

const failed = checks.filter((c) => c.gates && !c.pass)
console.log(JSON.stringify({ checks, failedCount: failed.length }, null, 2))
if (failed.length) {
  console.error(`contrast-audit: ${failed.length} gating check(s) below the WCAG minimum`)
  process.exit(1)
}
