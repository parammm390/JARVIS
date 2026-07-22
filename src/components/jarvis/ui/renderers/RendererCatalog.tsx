"use client"

// D3 — Stage catalog: all 41 action types resolve (registry-driven grid) + the 8
// flagship scenes get their own FlowCard-chromed section (Playwright's snapshot
// target for the EXIT GATE's "8 flagship snapshots" bullet). Same convention as
// C2/C3's catalogs (FlowCard chrome, fixture data, explicit tier labeling).

import { FlowCard } from "../motion/FlowCard"
import { ActionRenderer } from "./ActionRenderer"
import { VoiceCallScene } from "./flagships/VoiceCallScene"
import { ACTION_FIXTURES, CALL_FIXTURE } from "./fixtures"
import { ACTION_RENDERERS, REGISTERED_ACTION_TYPES } from "./registry"

const FLAGSHIP_DEMOS: Array<{ id: string; title: string; actionType: string; reducedFallback: string }> = [
  { id: "D3-FS-01", title: "water_test", actionType: "schedule_water_test", reducedFallback: "needle snaps to final angle, no sweep" },
  { id: "D3-FS-02", title: "quotation", actionType: "generate_quote", reducedFallback: "line items appear at once, no cascade; total snaps, no roll" },
  { id: "D3-FS-04", title: "inventory", actionType: "flag_reorder_needed", reducedFallback: "tank fills to final level instantly, no wobble" },
  { id: "D3-FS-05", title: "scheduling", actionType: "check_technician_availability", reducedFallback: "slots appear at once, no cascade" },
  { id: "D3-FS-06", title: "invoice_to_cash", actionType: "start_invoice_to_cash_workflow", reducedFallback: "progress rail static, no flowing gradient" },
  { id: "D3-FS-07", title: "bulk-notify", actionType: "bulk_notify_existing_customers", reducedFallback: "radar rings hidden, count shown static" },
  { id: "D3-FS-08", title: "lead_to_water_test", actionType: "start_water_test_workflow", reducedFallback: "funnel stages appear at once, no stagger" },
]

function RegistryGridEntry({ actionType }: { actionType: string }) {
  const entry = ACTION_RENDERERS[actionType]!
  return (
    <div className="rounded-lg border border-white/8 bg-black/15 p-2">
      <div className="mb-1.5 flex items-center justify-between">
        <span className="truncate font-mono text-[9px] text-white/40">{actionType}</span>
        <span
          className={`shrink-0 rounded-full px-1.5 py-0.5 text-[8px] font-black uppercase ${
            entry.tier === "flagship" ? "bg-cyan-400/15 text-cyan-300" : "bg-white/8 text-white/50"
          }`}
        >
          {entry.tier}
        </span>
      </div>
      <ActionRenderer actionType={actionType} payload={ACTION_FIXTURES[actionType]} compact />
    </div>
  )
}

export function RendererCatalogSection() {
  return (
    <section className="j-panel space-y-4 p-5">
      <div className="mb-1 flex items-center justify-between">
        <h2 className="j-label">D3 — Action Renderer Registry</h2>
        <span className="j-chip bg-cyan-400/12 text-cyan-300">{REGISTERED_ACTION_TYPES.length} / 41 registered</span>
      </div>
      <p className="text-[11px] text-[color:var(--j-text-dim)]">
        Every one of the 41 real action types (packages/orchestration/src/plugin-registry.ts) resolves to a flagship scene or a
        schema-driven standard card — zero raw-JSON default surfaces. 8 flagships below get the full, non-compact treatment; the
        remaining 33 render compact in the grid beneath.
      </p>

      <div>
        <h3 className="mb-2 text-[10px] font-black uppercase tracking-widest text-cyan-300">8 Flagship Scenes</h3>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {FLAGSHIP_DEMOS.map((d) => (
            <FlowCard key={d.id} id={d.id} title={d.title} reducedFallback={d.reducedFallback}>
              <ActionRenderer actionType={d.actionType} payload={ACTION_FIXTURES[d.actionType]} />
            </FlowCard>
          ))}
          <FlowCard id="D3-FS-03" title="voice call" reducedFallback="waveform bars static (decorative only, no loop to reduce)">
            <VoiceCallScene call={CALL_FIXTURE} />
          </FlowCard>
        </div>
      </div>

      <div>
        <h3 className="mb-2 text-[10px] font-black uppercase tracking-widest text-white/50">All 41 registered types (compact)</h3>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
          {REGISTERED_ACTION_TYPES.map((actionType) => (
            <RegistryGridEntry key={actionType} actionType={actionType} />
          ))}
        </div>
      </div>
    </section>
  )
}
