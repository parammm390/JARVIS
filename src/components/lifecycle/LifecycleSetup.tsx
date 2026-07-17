"use client"

import { useRef, useState } from "react"
import { AnimatePresence, motion } from "framer-motion"
import { Check, CheckCircle2, ChevronRight, Loader2, Play } from "lucide-react"
import type { LifecycleScenario } from "@/lib/lifecycle/scenario"
import { PRICING_TIERS, TIER_DEFINITIONS, type PricingTier } from "@/lib/lifecycle/pricing"
import type { WaterLookup } from "@/lib/lifecycle/water-data"

const EASE = [0.16, 1, 0.3, 1]
const MONO = "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace"

const SERVICE_OPTIONS = [
  "Water softeners",
  "Whole-house filtration",
  "RO drinking water",
  "Iron & sulfur treatment",
  "UV disinfection",
  "Well pump service",
]

const CONCERN_OPTIONS = [
  "Rotten-egg smell + hard water",
  "Iron staining",
  "Scale on fixtures + spotting",
  "Taste & odor",
]

const HOUSEHOLD_OPTIONS = [2, 4, 6]

const GENERATION_STEPS = [
  "Locating the water system, EPA SDWIS",
  "Sampling county wells, USGS records",
  "Running the sizing math",
  "Writing the diagnosis + range",
]

type Phase = "form" | "generating" | "error"

export type LifecyclePrefill = {
  zip?: string
  shopName?: string
  tier?: PricingTier
  services?: string[]
  onWell?: boolean
  banner?: string
}

export function LifecycleSetup({
  onReady,
  onRunSample,
  prefill,
}: {
  onReady: (scenario: LifecycleScenario) => void
  onRunSample: () => void
  prefill?: LifecyclePrefill
}) {
  const [phase, setPhase] = useState<Phase>("form")
  const [zip, setZip] = useState(prefill?.zip || "")
  const [shopName, setShopName] = useState(prefill?.shopName || "")
  const [services, setServices] = useState<string[]>(
    prefill?.services?.length ? prefill.services : SERVICE_OPTIONS.slice(0, 4)
  )
  const [tier, setTier] = useState<PricingTier>(prefill?.tier || "standard")
  const [household, setHousehold] = useState(4)
  const [concern, setConcern] = useState(CONCERN_OPTIONS[0])
  const [onWell, setOnWell] = useState(prefill?.onWell ?? true)
  const [formError, setFormError] = useState("")
  const [stepIndex, setStepIndex] = useState(0)
  const [provenance, setProvenance] = useState<string[]>([])
  const [generationError, setGenerationError] = useState("")
  const runIdRef = useRef(0)

  function toggleService(service: string) {
    setServices((current) =>
      current.includes(service)
        ? current.filter((item) => item !== service)
        : [...current, service]
    )
  }

  async function generate(event: React.FormEvent) {
    event.preventDefault()
    if (!/^\d{5}$/.test(zip.trim())) {
      setFormError("Enter the 5-digit ZIP where most of your customers are.")
      return
    }
    if (!services.length) {
      setFormError("Pick at least one service you actually install.")
      return
    }

    setFormError("")
    setGenerationError("")
    setProvenance([])
    setStepIndex(0)
    setPhase("generating")
    const runId = (runIdRef.current += 1)
    const timers: number[] = []
    const later = (callback: () => void, ms: number) => {
      timers.push(
        window.setTimeout(() => {
          if (runIdRef.current === runId) callback()
        }, ms)
      )
    }
    later(() => setStepIndex(1), 1400)

    try {
      const waterResponse = await fetch("/api/lifecycle/water", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ zip: zip.trim() }),
      })
      const waterData = (await waterResponse.json()) as { water?: WaterLookup; error?: string }
      timers.forEach(window.clearTimeout)
      if (runIdRef.current !== runId) return
      if (!waterResponse.ok || !waterData.water) {
        throw new Error(waterData.error || "The water lookup failed.")
      }

      setProvenance(waterData.water.provenance)
      setStepIndex(2)

      later(() => setStepIndex(3), 1600)
      const diagnoseResponse = await fetch("/api/lifecycle/diagnose", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          water: waterData.water,
          dealerName: shopName.trim(),
          services,
          tier,
          householdSize: household,
          concernLabel: concern,
          onWell,
        }),
      })
      const diagnoseData = (await diagnoseResponse.json()) as {
        scenario?: LifecycleScenario
        error?: string
      }
      timers.forEach(window.clearTimeout)
      if (runIdRef.current !== runId) return
      if (!diagnoseResponse.ok || !diagnoseData.scenario) {
        throw new Error(diagnoseData.error || "The diagnosis could not be generated.")
      }

      setStepIndex(4)
      later(() => onReady(diagnoseData.scenario as LifecycleScenario), 650)
    } catch (error) {
      timers.forEach(window.clearTimeout)
      if (runIdRef.current !== runId) return
      setGenerationError(
        error instanceof Error ? error.message : "Something failed while building the diagnosis."
      )
      setPhase("error")
    }
  }

  const inputClass =
    "h-13 min-h-[3.25rem] w-full rounded-xl border border-slate-200 bg-white px-4 text-base font-semibold text-slate-900 outline-none transition focus:border-sky-400 focus:ring-2 focus:ring-sky-100 placeholder:text-slate-400"
  const labelClass = "text-[10px] font-black uppercase tracking-[0.2em] text-slate-500"

  return (
    <div className="ops-card soft-edge relative overflow-hidden rounded-[1.8rem] bg-white/88 p-5 md:p-7">
      <div className="pointer-events-none absolute right-0 top-0 h-64 w-64 rounded-full bg-sky-100/80 blur-[92px]" />
      <div className="relative z-10">
        <AnimatePresence mode="wait">
          {phase === "form" ? (
            <motion.form
              key="form"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0, y: -12 }}
              transition={{ duration: 0.5, ease: EASE }}
              onSubmit={generate}
              className="space-y-5"
            >
              <div>
                <div className="mb-4 inline-flex items-center rounded-full border border-sky-100 bg-sky-50 px-4 py-1.5 text-[10px] font-black uppercase tracking-[0.2em] text-sky-800">
                  <span className="mr-2 h-1.5 w-1.5 rounded-full bg-teal-500" />
                  Build it around your shop
                </div>
                {prefill?.banner ? (
                  <div className="mb-4 rounded-2xl border border-teal-200 bg-teal-50 p-4 text-sm font-bold leading-relaxed text-teal-900">
                    {prefill.banner}
                  </div>
                ) : null}
                <h2 className="text-2xl font-black tracking-tight text-slate-950 md:text-3xl">
                  Real water. Real math. Your prices.
                </h2>
                <p className="mt-2 text-sm font-semibold leading-relaxed text-slate-600">
                  The diagnosis, range, and two-year ledger below get computed from live public
                  water records for your area and the pricing tier you actually sell at.
                </p>
              </div>

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <label className="space-y-2.5">
                  <span className={labelClass}>Service-area ZIP</span>
                  <input
                    value={zip}
                    onChange={(event) => setZip(event.target.value.replace(/[^\d]/g, "").slice(0, 5))}
                    inputMode="numeric"
                    placeholder="22801"
                    className={inputClass}
                    style={{ fontFamily: MONO }}
                  />
                </label>
                <label className="space-y-2.5">
                  <span className={labelClass}>Shop name (optional)</span>
                  <input
                    value={shopName}
                    onChange={(event) => setShopName(event.target.value)}
                    placeholder="Clean Water of Virginia"
                    className={inputClass}
                  />
                </label>
              </div>

              <div className="space-y-2.5">
                <p className={labelClass}>Services you install</p>
                <div className="flex flex-wrap gap-2">
                  {SERVICE_OPTIONS.map((service) => {
                    const active = services.includes(service)
                    return (
                      <button
                        key={service}
                        type="button"
                        onClick={() => toggleService(service)}
                        className={`inline-flex items-center gap-2 rounded-full border px-3.5 py-2 text-xs font-black transition ${
                          active
                            ? "border-teal-200 bg-teal-50 text-teal-800 shadow-sm"
                            : "border-slate-200 bg-white text-slate-600 hover:border-sky-200"
                        }`}
                      >
                        {active ? <Check className="h-3.5 w-3.5" /> : null}
                        {service}
                      </button>
                    )
                  })}
                </div>
              </div>

              <div className="space-y-2.5">
                <p className={labelClass}>Where you price</p>
                <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-3">
                  {PRICING_TIERS.map((tierOption) => {
                    const definition = TIER_DEFINITIONS[tierOption]
                    const active = tier === tierOption
                    return (
                      <button
                        key={tierOption}
                        type="button"
                        aria-pressed={active}
                        onClick={() => setTier(tierOption)}
                        className={`rounded-2xl border p-3.5 text-left transition-all ${
                          active
                            ? "border-sky-300 bg-[linear-gradient(135deg,#f0f9ff_0%,#ecfeff_100%)] shadow-[0_16px_36px_rgba(14,165,233,0.1)]"
                            : "border-slate-200 bg-white hover:border-sky-200"
                        }`}
                      >
                        <p className="text-sm font-black text-slate-950">{definition.label}</p>
                        <p className="mt-1 text-[11px] font-bold leading-snug text-slate-500">
                          {definition.band}
                        </p>
                      </button>
                    )
                  })}
                </div>
              </div>

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div className="space-y-2.5">
                  <p className={labelClass}>Typical household</p>
                  <div className="flex gap-2">
                    {HOUSEHOLD_OPTIONS.map((option) => (
                      <button
                        key={option}
                        type="button"
                        onClick={() => setHousehold(option)}
                        className={`h-11 flex-1 rounded-xl border text-sm font-black transition ${
                          household === option
                            ? "border-teal-200 bg-teal-50 text-teal-800"
                            : "border-slate-200 bg-white text-slate-600 hover:border-sky-200"
                        }`}
                      >
                        {option}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="space-y-2.5">
                  <p className={labelClass}>Most customers are on</p>
                  <div className="flex gap-2">
                    {[
                      [true, "Private wells"],
                      [false, "City water"],
                    ].map(([value, label]) => (
                      <button
                        key={String(label)}
                        type="button"
                        onClick={() => setOnWell(Boolean(value))}
                        className={`h-11 flex-1 rounded-xl border text-xs font-black transition ${
                          onWell === value
                            ? "border-teal-200 bg-teal-50 text-teal-800"
                            : "border-slate-200 bg-white text-slate-600 hover:border-sky-200"
                        }`}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              <div className="space-y-2.5">
                <p className={labelClass}>The call that comes in</p>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  {CONCERN_OPTIONS.map((option) => (
                    <button
                      key={option}
                      type="button"
                      onClick={() => setConcern(option)}
                      className={`flex min-h-11 items-center justify-between rounded-xl border px-3.5 py-2 text-left text-xs font-black transition ${
                        concern === option
                          ? "border-sky-300 bg-sky-50 text-slate-950"
                          : "border-slate-200 bg-white text-slate-600 hover:border-sky-200"
                      }`}
                    >
                      <span>{option}</span>
                      {concern === option ? <Check className="h-3.5 w-3.5 shrink-0 text-teal-600" /> : null}
                    </button>
                  ))}
                </div>
              </div>

              {formError ? (
                <div className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm font-semibold text-red-900">
                  {formError}
                </div>
              ) : null}

              <button
                type="submit"
                data-cursor="hover"
                className="cta-primary inline-flex h-14 w-full items-center justify-center gap-2 rounded-xl bg-slate-950 px-8 text-base font-black text-white transition hover:bg-slate-800"
              >
                Run the real diagnosis
                <ChevronRight className="h-5 w-5" />
              </button>
              <button
                type="button"
                onClick={onRunSample}
                data-cursor="hover"
                className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white text-sm font-black text-slate-700 transition hover:border-sky-200 hover:text-slate-950"
              >
                <Play className="h-4 w-4" />
                Skip, watch the sample household
              </button>
            </motion.form>
          ) : null}

          {phase === "generating" ? (
            <motion.div
              key="generating"
              initial={{ opacity: 0, y: 14 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -12 }}
              transition={{ duration: 0.5, ease: EASE }}
            >
              <p className="text-xs font-black uppercase tracking-[0.28em] text-sky-800">
                Building the diagnosis…
              </p>
              <div className="mt-6 space-y-3">
                {GENERATION_STEPS.map((step, index) => {
                  const active = stepIndex === index
                  const complete = stepIndex > index
                  return (
                    <div
                      key={step}
                      className={`flex items-center gap-4 rounded-xl border p-4 transition-all duration-500 ${
                        active
                          ? "border-sky-200 bg-sky-50"
                          : complete
                            ? "border-teal-100 bg-teal-50"
                            : "border-slate-200 bg-white"
                      }`}
                    >
                      <span
                        className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full border text-xs font-black ${
                          complete
                            ? "border-teal-200 bg-teal-100 text-teal-800"
                            : active
                              ? "border-sky-300 text-sky-800 shadow-[0_0_18px_rgba(14,165,233,0.12)]"
                              : "border-slate-200 text-slate-600"
                        }`}
                      >
                        {complete ? (
                          <CheckCircle2 className="h-4 w-4" />
                        ) : active ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          index + 1
                        )}
                      </span>
                      <span className="text-sm font-black uppercase tracking-widest text-slate-600">
                        {step}
                      </span>
                    </div>
                  )
                })}
              </div>

              {provenance.length ? (
                <div className="mt-5 rounded-2xl border border-slate-200 bg-slate-50 p-4">
                  <p className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-400">
                    Found on the public record
                  </p>
                  <div className="mt-2.5 space-y-1.5">
                    {provenance.map((line) => (
                      <motion.div
                        key={line}
                        initial={{ opacity: 0, x: -8 }}
                        animate={{ opacity: 1, x: 0 }}
                        transition={{ duration: 0.45, ease: EASE }}
                        className="flex items-start gap-2.5"
                      >
                        <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-teal-500" />
                        <p
                          className="text-[11px] font-semibold leading-relaxed text-slate-600"
                          style={{ fontFamily: MONO }}
                        >
                          {line}
                        </p>
                      </motion.div>
                    ))}
                  </div>
                </div>
              ) : null}
            </motion.div>
          ) : null}

          {phase === "error" ? (
            <motion.div
              key="error"
              initial={{ opacity: 0, y: 14 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.5, ease: EASE }}
            >
              <h3 className="text-2xl font-black tracking-tight text-slate-950">
                The lookup hit a wall.
              </h3>
              <p className="mt-3 rounded-2xl border border-orange-200 bg-orange-50 p-4 text-sm font-semibold leading-relaxed text-slate-800">
                {generationError}
              </p>
              <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-2">
                <button
                  type="button"
                  onClick={() => setPhase("form")}
                  className="inline-flex h-12 items-center justify-center rounded-xl bg-slate-950 text-sm font-black text-white transition hover:bg-slate-800"
                >
                  Adjust and retry
                </button>
                <button
                  type="button"
                  onClick={onRunSample}
                  className="inline-flex h-12 items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white text-sm font-black text-slate-700 transition hover:border-sky-200"
                >
                  <Play className="h-4 w-4" />
                  Run the sample instead
                </button>
              </div>
            </motion.div>
          ) : null}
        </AnimatePresence>
      </div>
    </div>
  )
}
