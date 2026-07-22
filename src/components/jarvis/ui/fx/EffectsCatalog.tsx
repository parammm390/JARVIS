"use client"

// C3.T1 — fx toolkit demoed on the Stage, same card-chrome convention as C2's FLOW
// catalogs (FlowCard, imported from ui/motion — generic chrome, not FLOW-specific,
// reused rather than building a second card shell for this section).

import { useState } from "react"
import { FlowCard, ReplayButton } from "../motion/FlowCard"
import { Glow } from "./Glow"
import { Glass } from "./Glass"
import { GridBackdrop } from "./GridBackdrop"
import { DecryptText } from "./DecryptText"
import { BorderBeam } from "./BorderBeam"

function GlowDemo() {
  return (
    <FlowCard id="FX-01" title="Glow" reducedFallback="n/a — static box-shadow, no animation to reduce">
      <div className="flex items-center gap-3">
        {(["cyan", "teal", "green", "amber", "red"] as const).map((tier) => (
          <Glow key={tier} tier={tier} className="h-6 w-6 rounded-full bg-[color:var(--j-panel-solid)]">
            <span />
          </Glow>
        ))}
      </div>
    </FlowCard>
  )
}

function GlassDemo() {
  return (
    <FlowCard id="FX-02" title="Glass + noise" reducedFallback="n/a — static material, no animation to reduce">
      <div className="flex gap-3">
        <Glass className="h-14 w-24" glow="cyan">
          <div className="flex h-full items-center justify-center text-[9px] text-[color:var(--j-text-dim)]">plain</div>
        </Glass>
        <Glass className="h-14 w-24" glow="teal" noise>
          <div className="flex h-full items-center justify-center text-[9px] text-[color:var(--j-text-dim)]">+noise</div>
        </Glass>
      </div>
    </FlowCard>
  )
}

function GridBackdropDemo() {
  return (
    <FlowCard id="FX-03" title="GridBackdrop (Bridge-only)" reducedFallback="grid static, scan sweep removed by jarvis-scan's own reduced-motion rule">
      <div className="relative h-16 w-full overflow-hidden rounded-lg border border-white/10 bg-[color:var(--j-bg-deep)]">
        <GridBackdrop />
      </div>
    </FlowCard>
  )
}

function DecryptTextDemo() {
  const [key, setKey] = useState(0)
  return (
    <FlowCard id="FX-04" title="DecryptText" reducedFallback="final text shown immediately, no scramble/typewriter reveal">
      <div className="flex w-full items-center justify-between gap-3">
        <DecryptText key={key} text="binding=native" mode="decrypt" cursor className="font-mono text-[11px] text-[color:var(--j-text)]" />
        <ReplayButton onClick={() => setKey((k) => k + 1)} />
      </div>
    </FlowCard>
  )
}

function BorderBeamFxDemo() {
  return (
    <FlowCard id="FX-05" title="BorderBeam (component)" reducedFallback="static border, no 3s conic-gradient loop (same CSS as FLOW-17)">
      <BorderBeam className="w-full rounded-lg border border-white/10 bg-black/20 px-4 py-2 text-center text-[11px] text-[color:var(--j-text)]">
        wrapped via &lt;BorderBeam&gt;
      </BorderBeam>
    </FlowCard>
  )
}

export function EffectsCatalogSection() {
  return (
    <section className="j-panel space-y-3 p-5">
      <div className="mb-1 flex items-center justify-between">
        <h2 className="j-label">C3.T1 — ui/fx/ toolkit</h2>
        <span className="j-chip bg-cyan-400/12 text-cyan-300">5 entries</span>
      </div>
      <p className="text-[11px] text-[color:var(--j-text-dim)]">
        Glow/Glass/GridBackdrop/DecryptText/BorderBeam. The particle micro-burst engine (also part of this task) already existed as{" "}
        <code>panels/ParticleField.tsx</code> — see FLOW-08&apos;s Replay button above, which now triggers it for real.
      </p>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <GlowDemo />
        <GlassDemo />
        <GridBackdropDemo />
        <DecryptTextDemo />
        <BorderBeamFxDemo />
      </div>
    </section>
  )
}
