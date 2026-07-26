"use client"

// F1.T3 — FLOW-26..37 (Band F1 — Interaction Grammar) demoed on the Stage, same
// card-chrome convention as FlowCatalog/FlowCatalogAmbient/EffectsCatalog (FlowCard).
// Each card states its data source honestly: most of Band F1 is UI-state-driven by
// design (hover/focus/scroll/selection are real interaction state, not fabricated
// data) — F2: real state or labeled fixture doesn't require every behavior to bind
// to a backend value, only that it never fakes one it doesn't have.

import { useState } from "react"
import { FlowCard, ReplayButton } from "./FlowCard"
import { Tooltip } from "../primitives/Tooltip"
import { ScrollGlow } from "../primitives/ScrollGlow"
import { CountBadgePop, useCopyFlash, useInlineEditRipple } from "../primitives/Grammar"
import { useToastQueue } from "../primitives/Toast"
import { SkeletonRow } from "../primitives/Skeletons"
import { Drawer } from "../primitives/Drawer"

function HoverLiftDemo() {
  return (
    <FlowCard id="FLOW-26" title="HoverLift" reducedFallback="border color only, no translateY">
      <div className="j-lift j-panel w-40 p-3 text-center text-[10px] text-[color:var(--j-text-dim)]">hover me</div>
    </FlowCard>
  )
}

function FocusHaloDemo() {
  return (
    <FlowCard id="FLOW-27" title="FocusHalo" reducedFallback="plain ring, no glow bloom">
      <button className="rounded-full border border-white/15 bg-white/5 px-4 py-1.5 text-[10px] font-bold text-white">tab to me</button>
    </FlowCard>
  )
}

function PressSinkDemo() {
  return (
    <FlowCard id="FLOW-28" title="PressSink" reducedFallback="no scale change">
      <button className="j-sink rounded-full border border-white/15 bg-white/5 px-4 py-1.5 text-[10px] font-bold text-white">click and hold</button>
    </FlowCard>
  )
}

function SkeletonTideDemo() {
  return (
    <FlowCard id="FLOW-29" title="SkeletonTide" reducedFallback="static blocks, no water-sweep">
      <div className="w-full space-y-1.5">
        <SkeletonRow index={0} />
        <SkeletonRow index={1} />
        <SkeletonRow index={2} />
      </div>
    </FlowCard>
  )
}

function ToastSurfaceDemo() {
  const { push, ToastStack } = useToastQueue()
  return (
    <FlowCard id="FLOW-30" title="ToastSurface" reducedFallback="fade only, no spring/stack compression">
      <ReplayButton onClick={() => push(<span>Fixture toast — stack compresses on repeat</span>)} />
      <ToastStack />
    </FlowCard>
  )
}

function CopyFlashDemo() {
  const { copy, Overlay } = useCopyFlash()
  return (
    <FlowCard id="FLOW-31" title="CopyFlash" reducedFallback="chip appears/disappears without rise animation">
      <button
        onClick={(e) => void copy("flow-31-fixture-value", e)}
        className="rounded-full border border-white/15 bg-white/5 px-3 py-1 text-[10px] font-bold text-white"
      >
        copy value
      </button>
      {Overlay}
    </FlowCard>
  )
}

function TooltipBloomDemo() {
  return (
    <FlowCard id="FLOW-32" title="TooltipBloom" reducedFallback="n/a — tooltip is instant show/hide either way, only the bloom scale is reduced">
      <Tooltip label="hand-rolled tooltip, 400ms delay">
        <span className="rounded-full border border-white/15 bg-white/5 px-3 py-1 text-[10px] font-bold text-white">hover/focus me</span>
      </Tooltip>
    </FlowCard>
  )
}

function DrawerBreathDemo() {
  const [open, setOpen] = useState(false)
  return (
    <FlowCard id="FLOW-33" title="DrawerBreath" reducedFallback="plain slide/fade, no caustic dim or overshoot">
      <ReplayButton onClick={() => setOpen(true)} />
      {open && (
        <Drawer title="FLOW-33 fixture drawer" onClose={() => setOpen(false)}>
          <p className="text-[11px] text-[color:var(--j-text-dim)]">Backdrop caustic dim + overshoot-settle panel entrance.</p>
        </Drawer>
      )}
    </FlowCard>
  )
}

function ScrollGlowDemo() {
  return (
    <FlowCard id="FLOW-34" title="ScrollGlow" reducedFallback="static fade, no scroll-position toggling change">
      <ScrollGlow className="h-16 w-full rounded-lg border border-white/8">
        <div className="space-y-1 p-2">
          {Array.from({ length: 8 }, (_, i) => (
            <div key={i} className="rounded bg-white/5 px-2 py-1 text-[9px] text-[color:var(--j-text-faint)]">
              scrollable row {i + 1}
            </div>
          ))}
        </div>
      </ScrollGlow>
    </FlowCard>
  )
}

function SelectionCurrentDemo() {
  const [selected, setSelected] = useState(0)
  return (
    <FlowCard id="FLOW-35" title="SelectionCurrent" reducedFallback="static bar, no flowing dash current">
      <div className="w-full space-y-1">
        {["Row A", "Row B", "Row C"].map((label, i) => (
          <button
            key={label}
            onClick={() => setSelected(i)}
            className={`w-full rounded-md px-3 py-1.5 pl-4 text-left text-[10px] text-white ${i === selected ? "j-selection-current bg-white/8" : "bg-white/[0.02]"}`}
          >
            {label}
          </button>
        ))}
      </div>
    </FlowCard>
  )
}

function CountBadgePopDemo() {
  const [count, setCount] = useState(3)
  const [pulse, setPulse] = useState(0)
  return (
    <FlowCard id="FLOW-36" title="CountBadgePop" reducedFallback="color tick only, no scale pop">
      <div className="flex items-center gap-3">
        <CountBadgePop
          count={count}
          event="new-pending-action"
          fixturePulse={pulse}
          className="rounded-full bg-cyan-400/15 px-2.5 py-1 text-[11px] font-black text-cyan-200"
        />
        <ReplayButton
          onClick={() => {
            setCount((c) => c + 1)
            setPulse((p) => p + 1)
          }}
        />
      </div>
    </FlowCard>
  )
}

function InlineEditRippleDemo() {
  const { ref, trigger } = useInlineEditRipple<HTMLDivElement>()
  return (
    <FlowCard id="FLOW-37" title="InlineEditRipple" reducedFallback="underline color only, no ripple sweep">
      <div className="flex items-center gap-3">
        <div ref={ref} className="border-b border-white/20 px-1 pb-1 text-[11px] text-white">
          fixture field value
        </div>
        <ReplayButton onClick={trigger} />
      </div>
    </FlowCard>
  )
}

export function GrammarCatalogSection() {
  return (
    <section className="j-panel space-y-3 p-5" data-flow-band="F1">
      <div className="mb-1 flex items-center justify-between">
        <h2 className="j-label">F1 — Interaction Grammar (FLOW-26..37)</h2>
        <span className="j-chip bg-cyan-400/12 text-cyan-300">12 entries</span>
      </div>
      <p className="text-[11px] text-[color:var(--j-text-dim)]">
        Real UI interaction state throughout (hover/focus/scroll/selection/clipboard/form-save) — nothing here fabricates a metric.
      </p>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <HoverLiftDemo />
        <FocusHaloDemo />
        <PressSinkDemo />
        <SkeletonTideDemo />
        <ToastSurfaceDemo />
        <CopyFlashDemo />
        <TooltipBloomDemo />
        <DrawerBreathDemo />
        <ScrollGlowDemo />
        <SelectionCurrentDemo />
        <CountBadgePopDemo />
        <InlineEditRippleDemo />
      </div>
    </section>
  )
}
