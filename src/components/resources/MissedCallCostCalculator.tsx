"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { motion } from "framer-motion"
import { AlertTriangle, Calculator, CalendarClock, PhoneMissed, TrendingUp } from "lucide-react"
import { ResourceFrame } from "./ResourceFrame"
import { ResourceHero } from "./ResourceHero"

const currency = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
})

const number = new Intl.NumberFormat("en-US", {
  maximumFractionDigits: 1,
})

export function MissedCallCostCalculator() {
  const [weeklyCalls, setWeeklyCalls] = useState(25)
  const [missedRate, setMissedRate] = useState(15)
  const [bookingRate, setBookingRate] = useState(30)
  const [jobValue, setJobValue] = useState(1200)
  const [afterHours, setAfterHours] = useState(30)

  const result = useMemo(() => {
    const missedCalls = weeklyCalls * (missedRate / 100)
    const potentialJobsExposed = missedCalls * (bookingRate / 100)
    const monthlyJobValueExposed = potentialJobsExposed * jobValue * 4.33
    const annualJobValueExposed = monthlyJobValueExposed * 12
    const afterHoursMissedCalls = missedCalls * (afterHours / 100)

    return {
      missedCalls,
      potentialJobsExposed,
      monthlyJobValueExposed,
      annualJobValueExposed,
      afterHoursMissedCalls,
    }
  }, [weeklyCalls, missedRate, bookingRate, jobValue, afterHours])

  return (
    <ResourceFrame>
      <ResourceHero
        kicker="Booking recovery estimator"
        title="Missed-Call Booking Value Estimator"
        copy="Estimate the booked job value exposed when calls or form leads go unanswered or receive slow follow-up. Start with conservative assumptions; this is a planning model, not a revenue promise."
        icon={Calculator}
        aside={<CalculatorSummary monthly={result.monthlyJobValueExposed} annual={result.annualJobValueExposed} />}
      />

      <section className="healthcare-section pt-0">
        <div className="container relative z-10 px-4 md:px-6">
          <div className="grid gap-6 lg:grid-cols-[0.92fr_1.08fr] lg:items-start">
            <motion.div
              initial={{ opacity: 0, y: 22 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: "-80px" }}
              className="ops-card rounded-[2rem] p-5 md:p-7"
            >
              <p className="text-xs font-black uppercase tracking-[0.2em] text-sky-800">
                Calculator inputs
              </p>
              <div className="mt-6 space-y-6">
                <SliderField
                  label="Weekly missed calls / form leads"
                  value={weeklyCalls}
                  min={1}
                  max={150}
                  step={5}
                  suffix="calls"
                  onChange={setWeeklyCalls}
                />
                <SliderField
                  label="Estimated unanswered or slow-followed percentage"
                  value={missedRate}
                  min={0}
                  max={40}
                  step={1}
                  suffix="%"
                  onChange={setMissedRate}
                />
                <SliderField
                  label="Lead-to-booked-opportunity percentage"
                  value={bookingRate}
                  min={0}
                  max={75}
                  step={1}
                  suffix="%"
                  onChange={setBookingRate}
                />
                <SliderField
                  label="Average job value"
                  value={jobValue}
                  min={500}
                  max={20000}
                  step={250}
                  formatter={(value) => currency.format(value)}
                  onChange={setJobValue}
                />
                <SliderField
                  label="Optional after-hours percentage"
                  value={afterHours}
                  min={0}
                  max={100}
                  step={5}
                  suffix="%"
                  onChange={setAfterHours}
                />
              </div>
            </motion.div>

            <div className="grid gap-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <ResultCard
                  icon={PhoneMissed}
                  label="Estimated missed calls"
                  value={result.missedCalls}
                  suffix="/week"
                  tone="orange"
                />
                <ResultCard
                  icon={TrendingUp}
                  label="Potential booked jobs exposed"
                  value={result.potentialJobsExposed}
                  suffix="/week"
                  tone="sky"
                />
                <ResultCard
                  icon={CalendarClock}
                  label="Monthly job value exposed"
                  value={result.monthlyJobValueExposed}
                  currencyValue
                  tone="teal"
                />
                <ResultCard
                  icon={AlertTriangle}
                  label="Annual job value exposed"
                  value={result.annualJobValueExposed}
                  currencyValue
                  tone="slate"
                />
              </div>

              <motion.div
                initial={{ opacity: 0, y: 22 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, margin: "-80px" }}
                className="ops-card overflow-hidden rounded-[2rem] p-5 md:p-7"
              >
                <div className="flex flex-col justify-between gap-6 md:flex-row md:items-start">
                  <div>
                    <p className="text-xs font-black uppercase tracking-[0.2em] text-teal-700">
                      Clean breakdown
                    </p>
                    <h2 className="mt-3 text-3xl font-black tracking-tight text-slate-950">
                      Where the risk concentrates
                    </h2>
                    <p className="mt-4 max-w-2xl text-sm font-semibold leading-relaxed text-slate-600 md:text-base">
                      With these assumptions, roughly {number.format(result.missedCalls)} calls or form
                      leads receive no answer or slow follow-up each week. About {number.format(result.afterHoursMissedCalls)}
                      of those may arrive after hours. The model applies your selected opportunity rate and
                      average job value only to illustrate the size of the response gap.
                    </p>
                  </div>
                  <span className="inline-flex rounded-full border border-orange-200 bg-orange-50 px-4 py-2 text-xs font-black uppercase tracking-[0.18em] text-orange-700">
                    This is directional, not a guarantee.
                  </span>
                </div>
                <div className="mt-7 grid gap-3 md:grid-cols-4">
                  {[
                    ["Lead volume", `${weeklyCalls}/week`],
                    ["Unanswered / slow", `${missedRate}%`],
                    ["Opportunity rate", `${bookingRate}%`],
                    ["Avg. job value", currency.format(jobValue)],
                  ].map(([label, value]) => (
                    <div key={label} className="rounded-2xl border border-slate-900/8 bg-white/72 p-4">
                      <p className="text-[10px] font-black uppercase tracking-widest text-slate-500">{label}</p>
                      <p className="mt-2 text-lg font-black text-slate-950">{value}</p>
                    </div>
                  ))}
                </div>
              </motion.div>
            </div>
          </div>
        </div>
      </section>
    </ResourceFrame>
  )
}

function CalculatorSummary({ monthly, annual }: { monthly: number; annual: number }) {
  return (
    <div className="ops-card relative overflow-hidden rounded-[2rem] p-6">
      <div className="pointer-events-none absolute inset-x-0 top-0 h-2 bg-gradient-to-r from-slate-950 via-sky-700 to-teal-600" />
      <p className="text-xs font-black uppercase tracking-[0.22em] text-slate-600">Live estimate</p>
      <p className="mt-5 text-sm font-semibold leading-relaxed text-slate-600">
        Potential job value exposed by unanswered or slow-followed water leads under your selected assumptions.
      </p>
      <div className="mt-6 grid gap-3">
        <div className="rounded-2xl border border-teal-200 bg-teal-50 p-5">
          <p className="text-xs font-black uppercase tracking-widest text-teal-700">Monthly estimate</p>
          <AnimatedValue value={monthly} currencyValue className="mt-2 text-4xl font-black text-slate-950" />
        </div>
        <div className="rounded-2xl border border-slate-900/10 bg-white p-5">
          <p className="text-xs font-black uppercase tracking-widest text-slate-500">Annual estimate</p>
          <AnimatedValue value={annual} currencyValue className="mt-2 text-3xl font-black text-slate-950" />
        </div>
      </div>
    </div>
  )
}

function SliderField({
  label,
  value,
  min,
  max,
  step,
  suffix,
  formatter,
  onChange,
}: {
  label: string
  value: number
  min: number
  max: number
  step: number
  suffix?: string
  formatter?: (value: number) => string
  onChange: (value: number) => void
}) {
  return (
    <label className="block rounded-2xl border border-slate-900/8 bg-white/72 p-4">
      <span className="flex items-center justify-between gap-4">
        <span className="text-sm font-black text-slate-800">{label}</span>
        <span className="shrink-0 rounded-full bg-slate-950 px-3 py-1 text-xs font-black text-white">
          {formatter ? formatter(value) : `${value}${suffix ? ` ${suffix}` : ""}`}
        </span>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
        className="mt-5 h-2 w-full cursor-pointer appearance-none rounded-full bg-slate-200 accent-teal-700"
      />
    </label>
  )
}

function ResultCard({
  icon: Icon,
  label,
  value,
  suffix,
  currencyValue,
  tone,
}: {
  icon: typeof PhoneMissed
  label: string
  value: number
  suffix?: string
  currencyValue?: boolean
  tone: "orange" | "sky" | "teal" | "slate"
}) {
  const toneClass = {
    orange: "bg-orange-50 text-orange-700 border-orange-200",
    sky: "bg-sky-50 text-sky-800 border-sky-200",
    teal: "bg-teal-50 text-teal-700 border-teal-200",
    slate: "bg-slate-950 text-teal-100 border-slate-950",
  }[tone]

  return (
    <motion.div
      initial={{ opacity: 0, y: 22 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-80px" }}
      className="ops-card rounded-2xl p-5"
    >
      <div className={`mb-8 flex h-12 w-12 items-center justify-center rounded-2xl border ${toneClass}`}>
        <Icon className="h-5 w-5" />
      </div>
      <p className="text-xs font-black uppercase tracking-[0.2em] text-slate-600">{label}</p>
      <div className="mt-3 flex flex-wrap items-end gap-2">
        <AnimatedValue value={value} currencyValue={currencyValue} className="text-3xl font-black text-slate-950" />
        {suffix ? <span className="pb-1 text-sm font-black text-slate-500">{suffix}</span> : null}
      </div>
    </motion.div>
  )
}

function AnimatedValue({
  value,
  currencyValue,
  className,
}: {
  value: number
  currencyValue?: boolean
  className?: string
}) {
  const [display, setDisplay] = useState(value)
  const displayRef = useRef(value)

  useEffect(() => {
    const start = displayRef.current
    const difference = value - start
    const startedAt = performance.now()
    const duration = 420
    let frame = 0

    const tick = (now: number) => {
      const progress = Math.min((now - startedAt) / duration, 1)
      const eased = 1 - Math.pow(1 - progress, 3)
      const next = start + difference * eased
      displayRef.current = next
      setDisplay(next)
      if (progress < 1) {
        frame = requestAnimationFrame(tick)
      }
    }

    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [value])

  return (
    <span className={className}>
      {currencyValue ? currency.format(display) : number.format(display)}
    </span>
  )
}
