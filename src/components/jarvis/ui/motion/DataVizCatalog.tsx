"use client"

// F5.T1/T2/T5 — FLOW-81..87 (Band F5 — Data-Viz Language) demoed on the Stage, same
// FlowCard chrome convention as GrammarCatalog/CommandSurfaceCatalog/
// DecisionTheaterCatalog. Every demo reuses the SAME real chart primitives
// AnalyticsRow/KpiStrip/PulseBar mount (AreaSparkline/Donut/GradientBar/DeltaChip/
// ForecastBand/AnomalyFlare from lib/charts.tsx) — no Stage-only lookalikes.
// BandBreath/AnomalyFlare are FIXTURE-labeled here (the real production wiring in
// AnalyticsRow.tsx stays graceful-absent against Insights.forecastBand/anomalies,
// neither shipped by any real API deploy yet — B3's job, per plan §7).

import { useState, type ReactNode } from "react"
import { FlowCard, ReplayButton } from "./FlowCard"
import { AnomalyFlare, AreaSparkline, DeltaChip, Donut, ForecastBand, GradientBar } from "../../lib/charts"

const FIXTURE_SPARK = [12, 18, 15, 22, 19, 27, 24, 31, 28, 36]
const FIXTURE_SEGMENTS = [
  { label: "email", value: 42, color: "#3b82f6" },
  { label: "sms", value: 27, color: "#22d3ee" },
  { label: "call", value: 14, color: "#8b5cf6" },
]
const FIXTURE_BAND = FIXTURE_SPARK.map((v) => ({ lo: v - 6, hi: v + 6 }))

// FlowCard's content wrapper is a flex ROW (`items-center justify-center`, no
// flex-wrap) — passing multiple top-level children (a content div + a <p>) lets
// them lay out side-by-side instead of stacking, overlapping at narrower widths.
// Every demo below wraps its content in this flex-col so it stacks regardless of
// the parent's own flex-direction, at any card width.
function DemoStack({ children }: { children: ReactNode }) {
  return <div className="flex w-full flex-col items-center gap-2">{children}</div>
}

function AxisEtchDemo() {
  const [key, setKey] = useState(0)
  return (
    <FlowCard id="FLOW-81" title="AxisEtch" reducedFallback="axis + data both shown instantly, no sequenced draw-in">
      <DemoStack>
        <div className="flex items-center gap-3">
          <AreaSparkline key={key} values={FIXTURE_SPARK} width={140} height={44} color="var(--j-cyan)" axisEtch />
          <ReplayButton onClick={() => setKey((k) => k + 1)} />
        </div>
        <p className="text-[9px] text-white/30">FIXTURE spark — the real one lives on AnalyticsRow&apos;s System Performance panel.</p>
      </DemoStack>
    </FlowCard>
  )
}

function BarSettleDemo() {
  const [seed, setSeed] = useState(0)
  const rows = [
    { label: "quote_sent", pct: 90 - seed * 4 },
    { label: "invoice_created", pct: 62 },
    { label: "follow_up", pct: 38 + seed * 3 },
  ]
  return (
    <FlowCard id="FLOW-82" title="BarSettle" reducedFallback="instant width, no spring/stagger">
      <DemoStack>
        <div className="w-full space-y-2">
          {rows.map((r, i) => (
            <div key={r.label}>
              <div className="mb-0.5 text-[9px] text-white/40">{r.label}</div>
              <GradientBar pct={Math.max(4, Math.min(100, r.pct))} from="#22d3ee" to="#3b82f6" index={i} />
            </div>
          ))}
        </div>
        <ReplayButton onClick={() => setSeed((s) => s + 1)} />
        <p className="text-[9px] text-white/30">FIXTURE rows — the real one is AnalyticsRow&apos;s ActionMixBars, sorted by real planner counts.</p>
      </DemoStack>
    </FlowCard>
  )
}

function DonutCarveDemo() {
  const [active, setActive] = useState<string | null>(null)
  return (
    <FlowCard id="FLOW-83" title="DonutCarve" reducedFallback="static ring, no lathe draw-in or hover lift">
      <DemoStack>
        <div className="flex items-center gap-4">
          <Donut segments={FIXTURE_SEGMENTS} size={84} thickness={10} active={active} />
          <div className="space-y-1">
            {FIXTURE_SEGMENTS.map((s) => (
              <button
                key={s.label}
                onMouseEnter={() => setActive(s.label)}
                onMouseLeave={() => setActive(null)}
                onFocus={() => setActive(s.label)}
                onBlur={() => setActive(null)}
                className="flex items-center gap-1.5 text-[9px] text-white/50"
              >
                <span className="h-1.5 w-1.5 rounded-full" style={{ background: s.color }} />
                {s.label}
              </button>
            ))}
          </div>
        </div>
        <p className="text-[9px] text-white/30">FIXTURE segments — the real one is AnalyticsRow&apos;s ChannelDonut, hover a legend row to lift its arc.</p>
      </DemoStack>
    </FlowCard>
  )
}

function SparkPulseDemo() {
  return (
    <FlowCard id="FLOW-84" title="SparkPulse" reducedFallback="static latest point, no blink">
      <DemoStack>
        <AreaSparkline values={FIXTURE_SPARK} width={140} height={44} color="var(--j-green)" />
        <p className="text-[9px] text-white/30">Always-on inside AreaSparkline — watch the trailing dot blink (LiveDot lineage).</p>
      </DemoStack>
    </FlowCard>
  )
}

function DeltaShimmerDemo() {
  const [n, setN] = useState(3)
  return (
    <FlowCard id="FLOW-85" title="DeltaShimmer" reducedFallback="color tick only, no sweep">
      <DemoStack>
        <div className="flex items-center gap-3">
          <DeltaChip label={`+${n} this session`} tone="up" />
          <ReplayButton onClick={() => setN((v) => v + 1)} />
        </div>
        <p className="text-[9px] text-white/30">The real one is KpiStrip&apos;s delta chip, shimmers when the real underlying count changes.</p>
      </DemoStack>
    </FlowCard>
  )
}

function BandBreathDemo() {
  return (
    <FlowCard id="FLOW-86" title="BandBreath" reducedFallback="static band, no opacity breathing">
      <DemoStack>
        <div className="relative h-11 w-[140px]">
          <ForecastBand band={FIXTURE_BAND} width={140} height={44} />
          <AreaSparkline values={FIXTURE_SPARK} width={140} height={44} color="var(--j-violet)" />
        </div>
        <p className="text-[9px] text-white/30">
          FIXTURE band — real production wiring (AnalyticsRow) is graceful-absent against Insights.forecastBand until B3 ships it.
        </p>
      </DemoStack>
    </FlowCard>
  )
}

function AnomalyFlareDemo() {
  return (
    <FlowCard id="FLOW-87" title="AnomalyFlare" reducedFallback="static ring, no flare loop">
      <DemoStack>
        <div className="relative h-11 w-[140px]">
          <AreaSparkline values={FIXTURE_SPARK} width={140} height={44} color="var(--j-cyan)" />
          <AnomalyFlare point={{ x: 108, y: 14 }} label="FIXTURE spike" />
        </div>
        <p className="text-[9px] text-white/30">
          FIXTURE point — real production wiring (AnalyticsRow) is graceful-absent against Insights.anomalies until B3 ships it.
        </p>
      </DemoStack>
    </FlowCard>
  )
}

export function DataVizCatalogSection() {
  return (
    <section className="j-panel space-y-3 p-5" data-flow-band="F5">
      <div className="mb-1 flex items-center justify-between">
        <h2 className="j-label">F5 — Data-Viz Language (FLOW-81..87)</h2>
        <span className="j-chip bg-cyan-400/12 text-cyan-300">7 entries</span>
      </div>
      <p className="text-[11px] text-[color:var(--j-text-dim)]">
        Every demo below reuses the same real chart primitive AnalyticsRow/KpiStrip/PulseBar mount — no Stage-only lookalikes. BandBreath and
        AnomalyFlare are FIXTURE-labeled (no B3 forecast/anomaly data exists yet); every other card is the exact component shipping in
        production today.
      </p>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <AxisEtchDemo />
        <BarSettleDemo />
        <DonutCarveDemo />
        <SparkPulseDemo />
        <DeltaShimmerDemo />
        <BandBreathDemo />
        <AnomalyFlareDemo />
      </div>
    </section>
  )
}
