// jarvis-v3 P4.T2 — a designed, non-JSON field renderer. Extracted as its own
// sibling file (§0.1: "whether a 10-line pure helper is inline or a sibling
// file" is the executor's own call) because both P4.T2 (the approval card's
// predicted-outcome chip) and P4.T3 (bridge/ThreadVerification.tsx's
// predicted<->actual diff, and lib/ReceiptDrawer.tsx's Expected/Actual
// sections) need the same "flatten an arbitrary object into displayable rows,
// never JSON.stringify it" logic — a real, live raw-JSON violation on the
// customer-facing receipt this session's own binding required finding (hard
// rule 8: no raw JSON on any customer-facing surface).

/** Flattens an arbitrary object into `path: value` rows — the same shape
 *  orchestration/src/prediction-diff.ts's own (server-side) `flatten()`
 *  produces, reimplemented here since frontend and backend don't share a
 *  runtime. Arrays are treated as a single leaf value (never expanded into
 *  indexed paths) — a plan's `steps: [...]` reads as one row, not N. */
export function flattenForDisplay(value: unknown, path = ""): Array<{ path: string; value: unknown }> {
  if (value === null || value === undefined) return path ? [{ path, value }] : []
  if (typeof value !== "object" || Array.isArray(value)) return [{ path: path || "value", value }]
  const entries = Object.entries(value as Record<string, unknown>)
  if (entries.length === 0) return path ? [{ path, value: {} }] : []
  return entries.flatMap(([key, child]) => flattenForDisplay(child, path ? `${path}.${key}` : key))
}

export function formatFieldValue(value: unknown): string {
  if (value === null || value === undefined) return "—"
  if (typeof value === "boolean") return value ? "yes" : "no"
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "—"
  if (typeof value === "object" && !Array.isArray(value)) return Object.keys(value as object).length === 0 ? "—" : "(nested)"
  if (Array.isArray(value)) return value.length === 0 ? "none" : value.map((v) => (typeof v === "string" ? v : JSON.stringify(v))).join(", ")
  return String(value)
}

/** A designed, non-JSON field list — never `<pre>{JSON.stringify()}</pre>`
 *  (hard rule 8). Used for a receipt's Expected/Actual sections and an
 *  approval card's predicted-outcome expand, wherever an arbitrary
 *  plugin-shaped object needs to render with dignity. */
export function FieldList({ value }: { value: unknown }) {
  const rows = flattenForDisplay(value)
  if (rows.length === 0) return <span className="text-[color:var(--j-text-faint)]">none yet</span>
  return (
    <div className="space-y-1">
      {rows.map((r) => (
        <div key={r.path} className="flex items-baseline justify-between gap-3 text-[11px]">
          <span className="text-[color:var(--j-text-faint)]">{r.path}</span>
          <span className="text-right font-mono text-[color:var(--j-text)]">{formatFieldValue(r.value)}</span>
        </div>
      ))}
    </div>
  )
}
