"use client"

// D3.T1 — the "designed fallback" tier, per plan spec: "payload behind debug toggle."
// Should never actually trigger for the 41 known types (registry.ts maps all of
// them) — this exists as the honest, designed backstop for a genuinely unregistered
// type (a future 42nd action type, a typo, a workflow-step name mistakenly passed
// here) rather than either crashing or silently rendering raw JSON by default.
//
// jarvis-v3 P5.T4 (§7.2, DEFECT LEDGER NEW-8): owner-debug only as of this
// phase. `ActionRenderer.tsx` no longer mounts this automatically for an
// unregistered type — `SchemaCard.tsx` is the new automatic default, and this
// component is now reachable only through SchemaCard's own owner-role-gated
// "view raw payload" toggle. Unchanged otherwise: same component, same
// internal showRaw toggle, just no longer the default customer-facing path.

import { useState } from "react"
import { AlertTriangle, ChevronDown } from "lucide-react"
import { Panel } from "../primitives/Panel"
import type { ActionRendererProps } from "./types"

export function FallbackRenderer({ actionType, payload, compact }: ActionRendererProps) {
  const [showRaw, setShowRaw] = useState(false)

  if (compact) {
    return (
      <span className="inline-flex items-center gap-1.5 j-fs-micro text-amber-300">
        <AlertTriangle className="h-3 w-3 shrink-0" />
        <span className="truncate">{actionType.replaceAll("_", " ")}</span>
      </span>
    )
  }

  return (
    <Panel className="border border-amber-300/25 p-3">
      <div className="mb-1 flex items-center gap-1.5 j-fs-micro font-black uppercase tracking-widest text-amber-200">
        <AlertTriangle className="h-3.5 w-3.5" /> unmapped action type
      </div>
      <div className="j-fs-micro text-[color:var(--j-text-dim)]">
        <span className="font-mono">{actionType}</span> isn&rsquo;t in the renderer registry yet — designed fallback, not a crash.
      </div>
      <button
        type="button"
        onClick={() => setShowRaw((v) => !v)}
        className="mt-2 inline-flex items-center gap-1 rounded-full border border-white/12 px-2 py-0.5 j-fs-micro font-bold text-white/50 hover:text-white/80"
      >
        <ChevronDown className={`h-2.5 w-2.5 transition-transform ${showRaw ? "rotate-180" : ""}`} /> {showRaw ? "hide" : "show"} raw payload (debug)
      </button>
      {showRaw && (
        <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap rounded-lg bg-black/25 p-2 font-mono j-fs-micro text-[color:var(--j-text-dim)]">
          {JSON.stringify(payload, null, 2)}
        </pre>
      )}
    </Panel>
  )
}
