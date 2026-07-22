// D3.T1 — value formatters for the StandardRenderer's field rows. Every FieldKind
// gets a real formatter; there is no "just stringify it" kind, which is the actual
// mechanism behind "zero raw-JSON default surfaces" for the 33 non-flagship types.
//
// Real bug found + fixed via this session's own browser hydration check (same
// technique C2/D1 established): `toLocaleString()`/`toLocaleTimeString()` called
// with an undefined/`[]` locale resolve DIFFERENTLY in Node (SSR) than in a browser
// (client) for the exact same Date value — reproduced: server rendered "07:30 PM",
// client rendered "19:30", same instant, just a 12h/24h format disagreement, not a
// value drift. Every date/time formatter here and in the 2 flagships that format
// dates inline (SchedulingScene, LeadToWaterTestScene) now pins an explicit "en-US"
// locale so server and client always agree — this isn't fixture-specific, it would
// have bitten real live payloads identically.

import type { FieldKind } from "./types"

export function prettifyKey(key: string): string {
  return key
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/_/g, " ")
    .toLowerCase()
    .replace(/^./, (c) => c.toUpperCase())
}

function truncateUuid(v: string): string {
  return v.length > 12 ? `${v.slice(0, 8)}…` : v
}

/** Explicit "en-US" everywhere — never rely on the runtime default locale, which
 *  genuinely differs between Node's SSR pass and the browser's client pass. */
export function formatDateTime(iso: string): string {
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" })
}
export function formatDateOnly(iso: string): string {
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString("en-US")
}
export function formatTimeOnly(iso: string): string {
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" })
}

export function formatFieldValue(kind: FieldKind, value: unknown): string {
  if (value === null || value === undefined || value === "") return "—"
  switch (kind) {
    case "currency": {
      const n = typeof value === "number" ? value : Number(value)
      return Number.isFinite(n) ? n.toLocaleString("en-US", { style: "currency", currency: "USD" }) : "—"
    }
    case "number": {
      const n = typeof value === "number" ? value : Number(value)
      return Number.isFinite(n) ? n.toLocaleString("en-US") : String(value)
    }
    case "date":
      return formatDateTime(String(value))
    case "boolean":
      return value ? "yes" : "no"
    case "uuid":
      return truncateUuid(String(value))
    case "enum":
      return String(value).replaceAll("_", " ")
    case "phone":
    case "email":
    case "text":
    case "longtext":
    default:
      return String(value)
  }
}

/** Renders any payload key not covered by a type's hand-authored FieldSpec list —
 *  keeps real-world payloads carrying extra/unexpected fields honest (still labeled
 *  rows, never a JSON blob) instead of silently dropping them. */
export function formatUnknownValue(value: unknown): string {
  if (value === null || value === undefined) return "—"
  if (typeof value === "object") {
    if (Array.isArray(value)) return value.length === 0 ? "(empty list)" : value.map((v) => formatUnknownValue(v)).join(", ")
    const entries = Object.entries(value as Record<string, unknown>)
    return entries.length === 0 ? "{}" : entries.map(([k, v]) => `${prettifyKey(k)}: ${formatUnknownValue(v)}`).join("; ")
  }
  return String(value)
}
