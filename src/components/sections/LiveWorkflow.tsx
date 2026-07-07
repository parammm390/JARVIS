"use client"

import { motion } from "framer-motion"
import { BellRing, ClipboardList, PhoneCall, ShieldAlert, UserRoundCheck } from "lucide-react"

const workflow = [
  {
    icon: PhoneCall,
    title: "Answered on ring two",
    detail: "Missed, overflow, after-hours, weekends. The call is taken, the concern is captured, and a household memory record opens before the caller hangs up.",
  },
  {
    icon: ClipboardList,
    title: "Water pulled, system sized",
    detail: "Public water records for the caller's area, plus a free onsite test to confirm the exact numbers for their home.",
  },
  {
    icon: ShieldAlert,
    title: "Quoted from your pricing",
    detail: "A real range from the tier you set, like $3,800 to $4,250 installed. Urgent no-water language skips the quote and routes straight to on-call.",
  },
  {
    icon: BellRing,
    title: "Booked by text",
    detail: "The report and three tap-to-book slots land by SMS within 60 seconds of hang-up. The appointment writes itself onto the record.",
  },
  {
    icon: UserRoundCheck,
    title: "The memory keeps working",
    detail: "Review ask, salt cadence, re-test clocks, referral attribution, and the year-two offer, all fired from the same record. Your team owns every final call.",
  },
]

export function LiveWorkflow() {
  return (
    <section id="workflow" className="healthcare-section bg-white/40">
      <div className="absolute inset-0 operational-grid opacity-50" />
      <div className="container relative z-10 px-4 md:px-6">
        <div className="mx-auto mb-14 max-w-4xl text-center">
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            className="mb-5 inline-flex rounded-full border border-sky-200 bg-sky-50 px-4 py-2 text-xs font-black uppercase tracking-[0.18em] text-sky-800"
          >
            Booking workflow
          </motion.div>
          <motion.h2
            initial={{ opacity: 0, y: 18 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            className="text-4xl font-black tracking-tight text-slate-950 md:text-6xl"
          >
            Ring two to booked job in one continuous motion.
          </motion.h2>
          <motion.p
            initial={{ opacity: 0, y: 16 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ delay: 0.08 }}
            className="mx-auto mt-6 max-w-2xl text-lg font-medium leading-relaxed text-slate-600"
          >
            Answer, pull the water record, size it, quote it, book it. Five moves, under three
            minutes, and the household memory holds all of it for the years after.
          </motion.p>
        </div>

        <motion.div
          initial={{ opacity: 0, y: 22 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: "-80px" }}
          className="ops-card overflow-hidden rounded-[2rem] p-5 md:p-7"
        >
          <WorkflowMap />
          <HandoffReel />
        </motion.div>

        <div className="mt-8 grid gap-5 lg:grid-cols-[1fr_0.9fr] lg:items-start">
          <div className="grid gap-4">
            {workflow.map((step, index) => (
              <motion.div
                key={step.title}
                initial={{ opacity: 0, x: -18 }}
                whileInView={{ opacity: 1, x: 0 }}
                viewport={{ once: true, margin: "-80px" }}
                transition={{ delay: index * 0.05 }}
                className="ops-card ops-card-hover rounded-2xl p-5"
                data-cursor="hover"
              >
                <div className="flex gap-5">
                  <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-slate-950 text-white shadow-lg">
                    <step.icon className="h-5 w-5 text-teal-200" />
                  </div>
                  <div>
                    <p className="text-xs font-black uppercase tracking-[0.2em] text-slate-600">
                      Step 0{index + 1}
                    </p>
                    <h3 className="mt-2 text-2xl font-black tracking-tight text-slate-950">
                      {step.title}
                    </h3>
                    <p className="mt-3 max-w-2xl text-sm font-medium leading-relaxed text-slate-600 md:text-base">
                      {step.detail}
                    </p>
                  </div>
                </div>
              </motion.div>
            ))}
          </div>

          <AlertSummary />
        </div>
      </div>
    </section>
  )
}

function WorkflowMap() {
  return (
    <div className="relative">
      <div className="hidden md:block">
        <svg viewBox="0 0 1120 300" className="h-auto w-full" role="img" aria-label="Response workflow map">
          <defs>
            <linearGradient id="lightWorkflowLine" x1="0" x2="1" y1="0" y2="0">
              <stop offset="0%" stopColor="rgba(14,165,181,0.12)" />
              <stop offset="48%" stopColor="rgba(14,165,181,0.82)" />
              <stop offset="100%" stopColor="rgba(30,64,95,0.18)" />
            </linearGradient>
          </defs>
          <path
            d="M82 152 C210 76 304 76 430 152 S650 228 780 152 S946 76 1038 152"
            fill="none"
            stroke="rgba(30,64,95,0.16)"
            strokeWidth="2"
            strokeDasharray="10 12"
          />
          <motion.path
            d="M82 152 C210 76 304 76 430 152 S650 228 780 152 S946 76 1038 152"
            fill="none"
            stroke="url(#lightWorkflowLine)"
            strokeWidth="4"
            strokeLinecap="round"
            strokeDasharray="120 900"
            animate={{ strokeDashoffset: [0, -1020] }}
            transition={{ duration: 5.6, repeat: Infinity, ease: "linear" }}
          />
          {workflow.map((step, index) => {
            const points = [
              [82, 152],
              [318, 116],
              [560, 152],
              [802, 188],
              [1038, 152],
            ]
            const [x, y] = points[index]
            return (
              <g key={step.title}>
                <circle cx={x} cy={y} r="48" fill="#ffffff" stroke="rgba(30,64,95,0.16)" strokeWidth="2" />
                <circle cx={x} cy={y} r="34" fill={index === 3 ? "#0f766e" : "#0f2437"} />
                <text x={x} y={y + 6} textAnchor="middle" fill="#ffffff" fontSize="17" fontWeight="900">
                  0{index + 1}
                </text>
                <text x={x} y={y + 68} textAnchor="middle" fill="#334155" fontSize="12" fontWeight="900" letterSpacing="1.4">
                  {step.title.toUpperCase()}
                </text>
              </g>
            )
          })}
        </svg>
      </div>
      <div className="grid gap-3 md:hidden">
        {workflow.map((step, index) => (
          <div key={step.title} className="flex items-center gap-3 rounded-2xl border border-slate-900/10 bg-white/80 p-4">
            <span className="flex h-9 w-9 items-center justify-center rounded-full bg-slate-950 text-xs font-black text-white">
              {index + 1}
            </span>
            <span className="text-sm font-black uppercase tracking-widest text-slate-700">{step.title}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

function HandoffReel() {
  return (
    <div className="mt-6 grid gap-4 border-t border-slate-200 pt-6 lg:grid-cols-[1fr_0.72fr_1fr] lg:items-center">
      <div className="rounded-[1.35rem] border border-orange-200 bg-orange-50/70 p-5">
        <p className="text-xs font-black uppercase tracking-[0.2em] text-orange-700">
          Raw missed-lead moment
        </p>
        <div className="mt-5 space-y-3">
          {["Caller: Jennifer", "Location: 142 Millbrook Rd, Harrisonburg VA", "Concern: Sulfur smell and hard water"].map((item) => (
            <div key={item} className="rounded-2xl border border-orange-200 bg-white px-4 py-3 text-sm font-black text-slate-800">
              {item}
            </div>
          ))}
        </div>
      </div>

      <div className="signal-thread min-h-20 rounded-[1.35rem] border border-slate-200 bg-white px-4 py-5">
        <div className="relative z-10 mx-auto flex h-10 w-10 items-center justify-center rounded-full bg-slate-950 text-xs font-black text-white shadow-[0_0_0_6px_rgba(30,91,141,0.08)]">
          AI
        </div>
      </div>

      <div className="rounded-[1.35rem] border border-teal-200 bg-teal-50/70 p-5">
        <div className="flex items-center justify-between gap-3">
          <p className="text-xs font-black uppercase tracking-[0.2em] text-teal-700">
            Booking route
          </p>
          <span className="status-pulse rounded-full bg-teal-600 px-3 py-1 text-[10px] font-black uppercase tracking-widest text-white">
            Alert sent
          </span>
        </div>
        <div className="mt-5 grid gap-3 sm:grid-cols-2">
          {["Concern tagged", "Callback confirmed", "Urgency screened", "Booking path ready"].map((item) => (
            <div key={item} className="rounded-2xl border border-teal-200 bg-white px-4 py-3 text-sm font-black text-slate-800">
              {item}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

function AlertSummary() {
  return (
    <motion.div
      initial={{ opacity: 0, y: 22 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-80px" }}
      className="ops-card sticky top-24 rounded-[2rem] p-6"
    >
      <div className="mb-6 flex items-center justify-between gap-4">
        <div>
          <p className="text-xs font-black uppercase tracking-[0.2em] text-teal-700">
            Team route
          </p>
          <h3 className="mt-2 text-2xl font-black tracking-tight text-slate-950">
            Ready to book or escalate
          </h3>
        </div>
        <span className="status-pulse rounded-full bg-teal-600 px-3 py-1.5 text-xs font-black text-white">
          Sent
        </span>
      </div>
      <div className="space-y-3">
        {[
          ["Caller", "Jennifer"],
          ["Location", "142 Millbrook Rd, Harrisonburg VA"],
          ["Concern", "Sulfur smell and hard water"],
          ["Water source", "Well water"],
          ["Interest", "Softener + whole-house filtration"],
          ["Next step", "Book water test"],
          ["Status", "Ready for front-office follow-up"],
        ].map(([label, value]) => (
          <div key={label} className="grid gap-1 rounded-2xl border border-slate-900/8 bg-white/72 p-4 sm:grid-cols-[142px_1fr]">
            <span className="text-[10px] font-black uppercase tracking-widest text-slate-600">
              {label}
            </span>
            <span className="text-sm font-bold text-slate-800">{value}</span>
          </div>
        ))}
      </div>
      <p className="mt-5 rounded-2xl border border-sky-200 bg-sky-50 p-4 text-sm font-semibold leading-relaxed text-slate-600">
        Finnor does not diagnose, quote, promise arrival times, or make repair decisions. It helps
        your team respond faster and book the right next step.
      </p>
    </motion.div>
  )
}
