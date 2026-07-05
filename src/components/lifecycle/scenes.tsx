"use client"

import { motion, useReducedMotion } from "framer-motion"
import {
  AlertTriangle,
  ArrowRight,
  Calculator,
  Camera,
  CheckCircle2,
  Droplets,
  FileText,
  PhoneIncoming,
  PhoneCall,
  ShieldCheck,
  Sparkles,
  Star,
  Truck,
  Wrench,
} from "lucide-react"
import type { SceneData } from "@/lib/lifecycle/scenario"
import { MessageThread } from "@/components/lifecycle/MessageThread"

const EASE = [0.16, 1, 0.3, 1]
const MONO = "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace"

export type SceneInteraction = {
  chosenSlot?: string
  autoPilot?: boolean
  onChipChosen?: (chip: string) => void
}

export function StageScene({
  scene,
  customerName,
  customerPhone,
  interaction,
}: {
  scene: SceneData
  customerName: string
  customerPhone: string
  interaction: SceneInteraction
}) {
  const threadProps = {
    contactName: customerName,
    contactMeta: `Text message · ${customerPhone}`,
    chosenSlot: interaction.chosenSlot,
  }

  switch (scene.kind) {
    case "call":
      return <CallScene scene={scene} />
    case "water":
      return <WaterScene scene={scene} />
    case "sizing":
      return <SizingScene scene={scene} />
    case "messages":
      return (
        <MessageThread
          thread={scene.thread}
          interactive={scene.interactive}
          autoPilot={interaction.autoPilot}
          onChipChosen={interaction.onChipChosen}
          {...threadProps}
        />
      )
    case "job":
      return <JobScene scene={scene} />
    case "review":
      return <ReviewScene scene={scene} threadProps={threadProps} />
    case "checkin":
      return <CheckinScene scene={scene} threadProps={threadProps} />
    case "referral":
      return <ReferralScene scene={scene} />
    case "upsell":
      return <UpsellScene scene={scene} threadProps={threadProps} />
    case "ledger":
      return <LedgerScene scene={scene} />
  }
}

type ThreadProps = {
  contactName: string
  contactMeta: string
  chosenSlot?: string
}

function CallScene({ scene }: { scene: Extract<SceneData, { kind: "call" }> }) {
  const reduceMotion = useReducedMotion()
  return (
    <div className="command-surface command-grid overflow-hidden rounded-[2rem] p-5 text-white md:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-2">
          {scene.chips.map((chip) => (
            <span
              key={chip}
              className="inline-flex items-center rounded-full border border-cyan-200/20 bg-cyan-200/[0.06] px-3.5 py-1.5 text-[10px] font-black uppercase tracking-widest text-cyan-50"
            >
              <span className="mr-2 h-1.5 w-1.5 rounded-full bg-cyan-200" />
              {chip}
            </span>
          ))}
        </div>
        <PhoneCall className="h-4 w-4 text-cyan-100" />
      </div>

      <div className="mt-5 rounded-3xl border border-white/10 bg-black/45 p-4">
        <div className="flex h-14 items-end justify-center gap-1.5">
          {Array.from({ length: 24 }).map((_, index) => (
            <motion.span
              key={index}
              animate={
                reduceMotion
                  ? { scaleY: 0.5 }
                  : { scaleY: [0.35 + (index % 5) * 0.12, 0.92 + (index % 6) * 0.08] }
              }
              transition={{
                duration: 0.52,
                repeat: reduceMotion ? 0 : Infinity,
                repeatType: "reverse",
                delay: index * 0.025,
              }}
              className="h-10 w-1.5 origin-bottom rounded-full bg-gradient-to-t from-cyan-200/20 via-cyan-100/65 to-white/90 will-change-transform"
            />
          ))}
        </div>
      </div>

      <div className="mt-5 space-y-3">
        {scene.transcript.map((line, index) => (
          <motion.div
            key={`${line.role}-${index}`}
            initial={reduceMotion ? false : { opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: reduceMotion ? 0 : 0.35 + index * 0.55, ease: EASE }}
            className={`rounded-2xl border p-4 ${
              line.role === "ai"
                ? "border-cyan-200/15 bg-cyan-200/[0.045]"
                : "border-white/10 bg-white/[0.035]"
            }`}
          >
            <p
              className={`text-[10px] font-black uppercase tracking-widest ${
                line.role === "ai" ? "text-cyan-100" : "text-slate-300"
              }`}
            >
              {line.role === "ai" ? "FINNOR" : "Caller"}
            </p>
            <p className="mt-1.5 text-sm font-semibold leading-relaxed text-white/75">{line.text}</p>
          </motion.div>
        ))}
      </div>
    </div>
  )
}

function WaterScene({ scene }: { scene: Extract<SceneData, { kind: "water" }> }) {
  const reduceMotion = useReducedMotion()
  return (
    <div className="ops-card overflow-hidden rounded-[2rem]">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-5 py-4 md:px-6">
        <div className="flex items-center gap-3">
          <span className="grid h-11 w-11 place-items-center rounded-2xl bg-sky-50 text-sky-800">
            <Droplets className="h-5 w-5" />
          </span>
          <div>
            <p className="text-[10px] font-black uppercase tracking-widest text-slate-500">
              Water profile, this address
            </p>
            <p className="mt-0.5 text-sm font-black text-slate-950">{scene.source}</p>
          </div>
        </div>
        {scene.badge.live ? (
          <span className="inline-flex items-center rounded-full border border-teal-200 bg-teal-50 px-3 py-1 text-[10px] font-black uppercase tracking-widest text-teal-800">
            <span className="mr-2 h-1.5 w-1.5 animate-pulse rounded-full bg-teal-500" />
            {scene.badge.label}
          </span>
        ) : (
          <span className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-[10px] font-black uppercase tracking-widest text-slate-500">
            {scene.badge.label}
          </span>
        )}
      </div>

      <div className="divide-y divide-slate-200">
        {scene.rows.map((row, index) => (
          <motion.div
            key={row.label}
            initial={reduceMotion ? false : { opacity: 0, x: -14 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.5, delay: reduceMotion ? 0 : 0.25 + index * 0.16, ease: EASE }}
            className="grid grid-cols-[1fr_auto] items-center gap-3 px-5 py-3.5 md:grid-cols-[170px_120px_1fr] md:px-6"
          >
            <p className="text-sm font-black text-slate-900">{row.label}</p>
            <p className="text-right text-sm font-black text-slate-950 md:text-left" style={{ fontFamily: MONO }}>
              {row.value}
            </p>
            <div className="col-span-2 flex items-center gap-2 md:col-span-1">
              {row.flag === "high" ? (
                <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-orange-600" />
              ) : (
                <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-teal-600" />
              )}
              <p className="text-xs font-semibold text-slate-600">{row.detail}</p>
            </div>
          </motion.div>
        ))}
      </div>

      <motion.div
        initial={reduceMotion ? false : { opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: reduceMotion ? 0 : 1.0 }}
        className="border-t border-slate-200 bg-sky-50/75 px-5 py-4 text-sm font-semibold leading-relaxed text-sky-900 md:px-6"
      >
        {scene.note}
      </motion.div>

      <motion.div
        initial={reduceMotion ? false : { opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: reduceMotion ? 0 : 1.25 }}
        className="border-t border-slate-200 px-5 py-4 md:px-6"
      >
        <p className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-400">
          Where this came from
        </p>
        <div className="mt-2.5 space-y-1.5">
          {scene.provenance.map((line) => (
            <div key={line} className="flex items-start gap-2.5">
              <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-teal-500" />
              <p className="text-[11px] font-semibold leading-relaxed text-slate-500" style={{ fontFamily: MONO }}>
                {line}
              </p>
            </div>
          ))}
        </div>
      </motion.div>
    </div>
  )
}

function SizingScene({ scene }: { scene: Extract<SceneData, { kind: "sizing" }> }) {
  const reduceMotion = useReducedMotion()
  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1.15fr_0.85fr]">
      <div className="ops-card overflow-hidden rounded-[2rem]">
        <div className="flex items-center gap-3 border-b border-slate-200 px-5 py-4 md:px-6">
          <span className="grid h-11 w-11 place-items-center rounded-2xl bg-teal-50 text-teal-700">
            <Calculator className="h-5 w-5" />
          </span>
          <div>
            <p className="text-[10px] font-black uppercase tracking-widest text-slate-500">
              Sizing worksheet
            </p>
            <p className="mt-0.5 text-sm font-black text-slate-950">Run before anyone quotes</p>
          </div>
        </div>
        <div className="space-y-3 p-5 md:p-6">
          {scene.steps.map((step, index) => (
            <motion.div
              key={step.label}
              initial={reduceMotion ? false : { opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, delay: reduceMotion ? 0 : 0.3 + index * 0.28, ease: EASE }}
              className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3"
            >
              <p className="text-[10px] font-black uppercase tracking-widest text-slate-500">
                {step.label}
              </p>
              <p className="mt-1.5 text-sm font-black text-slate-900" style={{ fontFamily: MONO }}>
                {step.value}
              </p>
            </motion.div>
          ))}
          <motion.div
            initial={reduceMotion ? false : { opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: reduceMotion ? 0 : 1.5, ease: EASE }}
            className="rounded-2xl border border-teal-200 bg-teal-50 px-4 py-4"
          >
            <p className="text-[10px] font-black uppercase tracking-widest text-teal-700">Verdict</p>
            <p className="mt-1.5 text-base font-black text-slate-950">{scene.verdict}</p>
            <p className="mt-1 text-sm font-black text-teal-800" style={{ fontFamily: MONO }}>
              {scene.quote}
            </p>
          </motion.div>
          <motion.div
            initial={reduceMotion ? false : { opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: reduceMotion ? 0 : 1.85 }}
            className="rounded-2xl border border-sky-100 bg-sky-50/75 px-4 py-4"
          >
            <p className="flex items-center gap-1.5 text-[10px] font-black uppercase tracking-widest text-sky-800">
              <Sparkles className="h-3 w-3" />
              The diagnosis
            </p>
            <p className="mt-2 text-sm font-semibold leading-relaxed text-slate-700">
              {scene.diagnosis}
            </p>
          </motion.div>
        </div>
      </div>

      <motion.div
        initial={reduceMotion ? false : { opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6, delay: reduceMotion ? 0 : 2.1, ease: EASE }}
        className="flex flex-col rounded-[2rem] border border-orange-200 bg-orange-50 p-5 md:p-6"
      >
        <div className="flex items-center gap-3">
          <span className="grid h-11 w-11 place-items-center rounded-2xl border border-orange-200 bg-white text-orange-700">
            <AlertTriangle className="h-5 w-5" />
          </span>
          <p className="text-sm font-black uppercase tracking-widest text-orange-800">
            {scene.guess.title}
          </p>
        </div>
        <div className="mt-5 space-y-3">
          {scene.guess.lines.map((line) => (
            <div key={line} className="flex items-start gap-2.5">
              <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-orange-500" />
              <p className="text-sm font-bold leading-relaxed text-slate-800">{line}</p>
            </div>
          ))}
        </div>
        <p className="mt-auto pt-6 text-xs font-semibold leading-relaxed text-slate-600">
          Documented pattern: homeowners now get independent water tests because dealer numbers
          didn&apos;t hold up. The math is the trust.
        </p>
      </motion.div>
    </div>
  )
}

function JobScene({ scene }: { scene: Extract<SceneData, { kind: "job" }> }) {
  const reduceMotion = useReducedMotion()
  return (
    <div className="ops-card overflow-hidden rounded-[2rem]">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-5 py-4 md:px-6">
        <div className="flex items-center gap-3">
          <span className="grid h-11 w-11 place-items-center rounded-2xl bg-teal-50 text-teal-700">
            <Wrench className="h-5 w-5" />
          </span>
          <div>
            <p className="text-[10px] font-black uppercase tracking-widest text-slate-500">
              Visit documentation
            </p>
            <p className="mt-0.5 text-sm font-black text-slate-950">{scene.jobLabel}</p>
          </div>
        </div>
        <span className="rounded-full border border-teal-200 bg-teal-50 px-3 py-1 text-[10px] font-black uppercase tracking-widest text-teal-800">
          Every line itemized
        </span>
      </div>

      <div className="grid grid-cols-1 gap-5 p-5 md:p-6 lg:grid-cols-2">
        <div>
          <p className="text-[10px] font-black uppercase tracking-widest text-slate-500">
            Before / after
          </p>
          <div className="mt-3 space-y-3">
            {scene.results.map((row, index) => (
              <motion.div
                key={row.label}
                initial={reduceMotion ? false : { opacity: 0, x: -12 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ duration: 0.5, delay: reduceMotion ? 0 : 0.3 + index * 0.18, ease: EASE }}
                className="grid grid-cols-[1fr_auto_auto_auto] items-center gap-3 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3"
              >
                <p className="text-sm font-black text-slate-900">{row.label}</p>
                <p className="text-sm font-bold text-slate-500" style={{ fontFamily: MONO }}>
                  {row.before}
                </p>
                <ArrowRight className="h-3.5 w-3.5 text-slate-400" />
                <p className="text-sm font-black text-teal-800" style={{ fontFamily: MONO }}>
                  {row.after}
                </p>
              </motion.div>
            ))}
          </div>

          <p className="mt-5 text-[10px] font-black uppercase tracking-widest text-slate-500">
            On file
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            {scene.onFile.map((item) => (
              <span
                key={item}
                className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3.5 py-1.5 text-xs font-bold text-slate-700"
              >
                {item.includes("photo") ? (
                  <Camera className="h-3.5 w-3.5 text-sky-700" />
                ) : (
                  <CheckCircle2 className="h-3.5 w-3.5 text-teal-600" />
                )}
                {item}
              </span>
            ))}
          </div>

          {scene.plan ? (
            <motion.div
              initial={reduceMotion ? false : { opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.55, delay: reduceMotion ? 0 : 1.0, ease: EASE }}
              className="mt-5 flex items-center gap-3 rounded-2xl border border-teal-200 bg-teal-50 px-4 py-3"
            >
              <ShieldCheck className="h-5 w-5 shrink-0 text-teal-700" />
              <div>
                <p className="text-sm font-black text-slate-950">{scene.plan.title}</p>
                <p className="mt-0.5 text-xs font-semibold text-slate-600">{scene.plan.detail}</p>
              </div>
            </motion.div>
          ) : null}
        </div>

        <motion.div
          initial={reduceMotion ? false : { opacity: 0, y: 14 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: reduceMotion ? 0 : 0.75, ease: EASE }}
          className="flex flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white"
        >
          <div className="flex items-center gap-2 border-b border-slate-200 bg-slate-50/80 px-4 py-3">
            <FileText className="h-4 w-4 text-sky-700" />
            <p className="text-[10px] font-black uppercase tracking-widest text-slate-500">
              Invoice, matches the quote
            </p>
          </div>
          <div className="divide-y divide-slate-100">
            {scene.invoice.map((row) => (
              <div key={row.label} className="flex items-center justify-between px-4 py-2.5">
                <p className="text-sm font-semibold text-slate-700">{row.label}</p>
                <p className="text-sm font-black text-slate-900" style={{ fontFamily: MONO }}>
                  {row.amount}
                </p>
              </div>
            ))}
          </div>
          <div className="mt-auto flex items-center justify-between border-t border-slate-200 bg-teal-50/70 px-4 py-3">
            <p className="text-sm font-black text-slate-950">Total, as quoted</p>
            <p className="text-base font-black text-teal-800" style={{ fontFamily: MONO }}>
              {scene.invoiceTotal}
            </p>
          </div>
        </motion.div>
      </div>
    </div>
  )
}

function ReviewScene({
  scene,
  threadProps,
}: {
  scene: Extract<SceneData, { kind: "review" }>
  threadProps: ThreadProps
}) {
  const reduceMotion = useReducedMotion()
  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1.05fr_0.95fr]">
      <MessageThread thread={scene.thread} {...threadProps} />
      <motion.div
        initial={reduceMotion ? false : { opacity: 0, y: 18 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.65, delay: reduceMotion ? 0 : 3.2, ease: EASE }}
        className="ops-card flex flex-col rounded-[2rem] p-5 md:p-6"
      >
        <div className="flex items-center justify-between">
          <div className="flex gap-1">
            {Array.from({ length: scene.review.stars }).map((_, index) => (
              <motion.span
                key={index}
                initial={reduceMotion ? false : { opacity: 0, scale: 0.4 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ duration: 0.4, delay: reduceMotion ? 0 : 3.5 + index * 0.12, ease: EASE }}
              >
                <Star className="h-5 w-5 fill-orange-400 text-orange-400" />
              </motion.span>
            ))}
          </div>
          <span className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-[10px] font-black uppercase tracking-widest text-slate-500">
            Public review
          </span>
        </div>
        <p className="mt-5 text-base font-bold leading-relaxed text-slate-800">
          &quot;{scene.review.quote}&quot;
        </p>
        <div className="mt-auto flex items-center justify-between pt-6">
          <p className="text-sm font-black text-slate-950">{scene.review.name}</p>
          <p className="text-xs font-bold text-slate-500" style={{ fontFamily: MONO }}>
            {scene.review.meta}
          </p>
        </div>
      </motion.div>
    </div>
  )
}

function CheckinScene({
  scene,
  threadProps,
}: {
  scene: Extract<SceneData, { kind: "checkin" }>
  threadProps: ThreadProps
}) {
  const reduceMotion = useReducedMotion()
  return (
    <div className="space-y-4">
      <MessageThread thread={scene.thread} {...threadProps} />
      <motion.div
        initial={reduceMotion ? false : { opacity: 0, y: 14 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6, delay: reduceMotion ? 0 : 4.6, ease: EASE }}
        className="ops-card flex items-center justify-between gap-4 rounded-[2rem] p-5"
      >
        <div className="flex items-center gap-4">
          <span className="grid h-12 w-12 place-items-center rounded-2xl bg-teal-50 text-teal-700">
            <Truck className="h-5 w-5" />
          </span>
          <div>
            <p className="text-sm font-black text-slate-950">{scene.order.title}</p>
            <p className="mt-0.5 text-xs font-semibold text-slate-600">{scene.order.detail}</p>
          </div>
        </div>
        <p className="text-xl font-black text-teal-800" style={{ fontFamily: MONO }}>
          {scene.order.amount}
        </p>
      </motion.div>
    </div>
  )
}

function ReferralScene({ scene }: { scene: Extract<SceneData, { kind: "referral" }> }) {
  const reduceMotion = useReducedMotion()
  return (
    <div className="ops-card overflow-hidden rounded-[2rem]">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-5 py-4 md:px-6">
        <div className="flex items-center gap-3">
          <span className="relative grid h-11 w-11 place-items-center rounded-2xl bg-sky-50 text-sky-800">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-2xl border border-sky-300/50" />
            <PhoneIncoming className="h-5 w-5" />
          </span>
          <div>
            <p className="text-[10px] font-black uppercase tracking-widest text-slate-500">
              Inbound, after hours
            </p>
            <p className="mt-0.5 text-sm font-black text-slate-950">{scene.callerName}</p>
          </div>
        </div>
        <span className="rounded-full border border-teal-200 bg-teal-50 px-3 py-1 text-[10px] font-black uppercase tracking-widest text-teal-800">
          New lead, attributed
        </span>
      </div>

      <div className="p-5 md:p-6">
        <motion.p
          initial={reduceMotion ? false : { opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: reduceMotion ? 0 : 0.35, ease: EASE }}
          className="text-xl font-black leading-snug tracking-tight text-slate-950 md:text-2xl"
        >
          {scene.callerLine}
        </motion.p>

        <motion.div
          initial={reduceMotion ? false : { opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: reduceMotion ? 0 : 0.9 }}
          className="signal-thread mt-6 hidden h-8 md:block"
        />

        <motion.div
          initial={reduceMotion ? false : { opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.55, delay: reduceMotion ? 0 : 1.1, ease: EASE }}
          className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2"
        >
          <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
            <p className="text-[10px] font-black uppercase tracking-widest text-slate-500">
              Attribution
            </p>
            <p className="mt-2 text-sm font-bold leading-relaxed text-slate-800">{scene.sourceNote}</p>
          </div>
          <div className="rounded-2xl border border-teal-200 bg-teal-50 p-4">
            <p className="text-[10px] font-black uppercase tracking-widest text-teal-700">
              Booked install
            </p>
            <p className="mt-2 text-2xl font-black text-teal-800" style={{ fontFamily: MONO }}>
              {scene.amount}
            </p>
            <p className="mt-1 text-xs font-semibold text-slate-600">{scene.jobLabel}</p>
          </div>
        </motion.div>
      </div>
    </div>
  )
}

function UpsellScene({
  scene,
  threadProps,
}: {
  scene: Extract<SceneData, { kind: "upsell" }>
  threadProps: ThreadProps
}) {
  const reduceMotion = useReducedMotion()
  return (
    <div className="space-y-4">
      <div className="rounded-[2rem] border border-sky-100 bg-sky-50/75 p-5 md:p-6">
        <div className="flex items-center gap-3">
          <span className="grid h-11 w-11 place-items-center rounded-2xl border border-sky-100 bg-white text-sky-800">
            <Sparkles className="h-5 w-5" />
          </span>
          <p className="text-[10px] font-black uppercase tracking-widest text-sky-800">
            Why now, three signals from memory
          </p>
        </div>
        <div className="mt-4 space-y-2.5">
          {scene.signals.map((signal, index) => (
            <motion.div
              key={signal}
              initial={reduceMotion ? false : { opacity: 0, x: -12 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.5, delay: reduceMotion ? 0 : 0.3 + index * 0.22, ease: EASE }}
              className="flex items-start gap-3 rounded-2xl border border-sky-100 bg-white px-4 py-3"
            >
              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-sky-700" />
              <p className="text-sm font-bold leading-relaxed text-slate-800">{signal}</p>
            </motion.div>
          ))}
        </div>
      </div>
      <MessageThread thread={scene.thread} {...threadProps} />
    </div>
  )
}

const LEDGER_DOT: Record<string, string> = {
  install: "bg-slate-950",
  recurring: "bg-sky-600",
  consumable: "bg-teal-500",
  service: "bg-slate-400",
  upsell: "bg-sky-800",
  referral: "bg-orange-500",
}

function LedgerScene({ scene }: { scene: Extract<SceneData, { kind: "ledger" }> }) {
  const reduceMotion = useReducedMotion()
  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1.15fr_0.85fr]">
      <div className="ops-card overflow-hidden rounded-[2rem]">
        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4 md:px-6">
          <div className="flex items-center gap-3">
            <span className="grid h-11 w-11 place-items-center rounded-2xl bg-teal-50 text-teal-700">
              <FileText className="h-5 w-5" />
            </span>
            <div>
              <p className="text-[10px] font-black uppercase tracking-widest text-slate-500">
                24-month ledger
              </p>
              <p className="mt-0.5 text-sm font-black text-slate-950">
                Every line fired from memory. No one at the shop kept a list
              </p>
            </div>
          </div>
        </div>
        <div className="divide-y divide-slate-100">
          {scene.entries.map((entry, index) => (
            <motion.div
              key={entry.label}
              initial={reduceMotion ? false : { opacity: 0, x: -14 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.45, delay: reduceMotion ? 0 : 0.3 + index * 0.16, ease: EASE }}
              className="grid grid-cols-[74px_1fr_auto] items-center gap-3 px-5 py-3 md:px-6"
            >
              <p className="text-[10px] font-bold text-slate-400" style={{ fontFamily: MONO }}>
                {entry.when}
              </p>
              <p className="flex items-center gap-2.5 text-sm font-semibold text-slate-700">
                <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${LEDGER_DOT[entry.kind] || "bg-slate-400"}`} />
                {entry.label}
              </p>
              <p className="text-sm font-black text-slate-900" style={{ fontFamily: MONO }}>
                {entry.amount}
              </p>
            </motion.div>
          ))}
        </div>
        <motion.div
          initial={reduceMotion ? false : { opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: reduceMotion ? 0 : 1.4 }}
          className="space-y-1.5 border-t border-slate-200 bg-slate-50/80 px-5 py-4 md:px-6"
        >
          <div className="flex items-center justify-between text-sm">
            <p className="font-bold text-slate-600">Direct, one household</p>
            <p className="font-black text-slate-900" style={{ fontFamily: MONO }}>
              {scene.directTotal}
            </p>
          </div>
          <div className="flex items-center justify-between text-sm">
            <p className="font-bold text-slate-600">Referral, attributed to her review</p>
            <p className="font-black text-slate-900" style={{ fontFamily: MONO }}>
              {scene.referralTotal}
            </p>
          </div>
          <div className="flex items-center justify-between border-t border-slate-200 pt-2.5">
            <p className="text-base font-black text-slate-950">One remembered customer</p>
            <p className="text-xl font-black text-teal-800" style={{ fontFamily: MONO }}>
              {scene.grandTotal}
            </p>
          </div>
        </motion.div>
      </div>

      <motion.div
        initial={reduceMotion ? false : { opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6, delay: reduceMotion ? 0 : 1.7, ease: EASE }}
        className="flex flex-col rounded-[2rem] border border-orange-200 bg-orange-50 p-5 md:p-6"
      >
        <p className="text-sm font-black uppercase tracking-widest text-orange-800">
          Same lead, no memory
        </p>
        <p className="mt-6 text-4xl font-black tracking-tight text-slate-950" style={{ fontFamily: MONO }}>
          {scene.noMemoryTotal}
        </p>
        <p className="mt-2 text-sm font-bold text-slate-700">One transaction. Then silence.</p>
        <div className="mt-6 space-y-2.5">
          {[
            "No water data, quote came off a rate sheet",
            "No review ask, the moment passed",
            "No check-ins, customer buys salt at the hardware store",
            "No referral attribution, the neighbor called someone else",
          ].map((line) => (
            <div key={line} className="flex items-start gap-2.5">
              <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-orange-500" />
              <p className="text-sm font-semibold leading-relaxed text-slate-700">{line}</p>
            </div>
          ))}
        </div>
        <p className="mt-auto pt-6 text-xs font-semibold leading-relaxed text-slate-600">
          The gap between these two numbers is what one continuous memory is worth on a single
          phone call.
        </p>
      </motion.div>
    </div>
  )
}
