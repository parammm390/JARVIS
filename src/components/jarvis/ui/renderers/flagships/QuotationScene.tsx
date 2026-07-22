"use client"

// D3.T2 — flagship 2/8: generate_quote (quotation plugin). "Document assembles: line
// items cascade, total ticks, PDF prints into embed."
//
// Real shape note: the DRAFT payload approved through the gate is just
// QuotePayloadSchema (householdLabel, items: string[], notes?) — `lines`/`totalUsd`
// only exist on generate_quote's EXECUTE() output (QuoteExecutionResult), which
// isn't part of `payload` at all (it's expectedResult/actualResult on the receipt).
// This scene honestly handles both shapes it might actually be handed: a pre-
// execution draft (items only, no computed total — cascades the raw item strings,
// no fake total ticker) and a post-execution shape if the caller ever passes the
// richer object (lines + totalUsd) — never invents numbers when only items exist.

import { FileText } from "lucide-react"
import { Stagger, Ticker } from "../../motion/primitives"
import { Panel } from "../../primitives/Panel"
import type { ActionRendererProps } from "../types"

interface QuoteLine {
  item: string
  priceUsd: number
}
interface QuotePayload {
  householdLabel?: string
  items?: string[]
  notes?: string
  lines?: QuoteLine[]
  totalUsd?: number
  pricingNote?: string
}

export function QuotationScene({ payload, compact }: ActionRendererProps) {
  const p = (payload && typeof payload === "object" ? payload : {}) as QuotePayload
  const hasComputedLines = Array.isArray(p.lines) && p.lines.length > 0
  const itemCount = hasComputedLines ? p.lines!.length : (p.items?.length ?? 0)

  if (compact) {
    return (
      <span className="inline-flex items-center gap-1.5 text-[11px]">
        <FileText className="h-3 w-3 shrink-0 text-teal-300" />
        <span className="truncate text-[color:var(--j-text)]">
          quote for {p.householdLabel ?? "household"} · {itemCount} item{itemCount === 1 ? "" : "s"}
        </span>
      </span>
    )
  }

  return (
    <Panel className="border border-teal-300/25 p-3">
      <div className="mb-2 flex items-center gap-1.5">
        <FileText className="h-3.5 w-3.5 text-teal-300" />
        <span className="text-[9px] font-black uppercase tracking-widest text-teal-300">Quotation — {p.householdLabel ?? "household"}</span>
      </div>

      {/* the "document" sheet */}
      <div className="rounded-lg border border-white/10 bg-white/[0.02] p-3">
        {hasComputedLines ? (
          <Stagger staggerMs={40} className="space-y-1">
            {p.lines!.map((l, i) => (
              <div key={i} className="flex items-center justify-between text-[11px]">
                <span className="truncate text-[color:var(--j-text-dim)]">{l.item}</span>
                <span className="shrink-0 font-mono tabular-nums text-[color:var(--j-text)]">${l.priceUsd.toFixed(2)}</span>
              </div>
            ))}
          </Stagger>
        ) : p.items && p.items.length > 0 ? (
          <Stagger staggerMs={40} className="space-y-1">
            {p.items.map((item, i) => (
              <div key={i} className="text-[11px] text-[color:var(--j-text-dim)]">
                {item}
              </div>
            ))}
          </Stagger>
        ) : (
          <div className="text-[10.5px] text-[color:var(--j-text-faint)]">No line items drafted yet</div>
        )}

        {typeof p.totalUsd === "number" && (
          <div className="mt-2 flex items-center justify-between border-t border-white/8 pt-2">
            <span className="text-[9.5px] font-black uppercase tracking-wide text-[color:var(--j-text-faint)]">Total</span>
            <span className="font-black tabular-nums text-[color:var(--j-text)]">
              $<Ticker value={p.totalUsd} format={(v) => v.toFixed(2)} />
            </span>
          </div>
        )}
      </div>

      {p.pricingNote && <div className="mt-1.5 text-[10px] italic text-[color:var(--j-text-faint)]">{p.pricingNote}</div>}
      {p.notes && !p.pricingNote && <div className="mt-1.5 text-[10px] text-[color:var(--j-text-faint)]">{p.notes}</div>}
    </Panel>
  )
}
