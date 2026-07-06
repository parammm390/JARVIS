"use client"

import { motion } from "framer-motion"
import {
  AlertTriangle,
  ArrowRight,
  BookOpenText,
  Calculator,
  ClipboardCheck,
  Clock3,
  Headset,
  PhoneOff,
  Route,
  ShieldCheck,
  Truck,
} from "lucide-react"
import { ResourceFrame } from "./ResourceFrame"
import { ResourceHero } from "./ResourceHero"

const resourceCards = [
  {
    href: "/resources/missed-call-cost-calculator",
    icon: Calculator,
    kicker: "Missed-call estimator",
    title: "Missed-Call Booking Value Estimator",
    copy: "Use conservative assumptions to estimate booked job value exposed by unanswered calls and slow form follow-up.",
  },
  {
    href: "/resources/dispatch-ai-glossary",
    icon: BookOpenText,
    kicker: "Operator glossary",
    title: "Water Booking & Lead Recovery Glossary",
    copy: "Plain-English definitions for missed-call recovery, quote follow-up, booking routes, and human-controlled service promises.",
  },
  {
    href: "/resources/pilot-setup-checklist",
    icon: ClipboardCheck,
    kicker: "Launch planning",
    title: "Booking & Lead Recovery Pilot Setup Checklist",
    copy: "Define forwarding, lead sources, booking questions, urgent routes, alert paths, and ownership before launch.",
  },
  {
    href: "/trust-safety",
    icon: ShieldCheck,
    kicker: "Control model",
    title: "Trust & Safety",
    copy: "How Finnor routes urgent water calls without quoting, diagnosing, or promising an arrival time.",
  },
  {
    href: "/resources#answering-service",
    icon: Headset,
    kicker: "Comparison",
    title: "Finnor vs Answering Service",
    copy: "Why booked next steps and urgent water routes are different from generic message taking.",
  },
  {
    href: "/resources#generic-ai",
    icon: Route,
    kicker: "Comparison",
    title: "Finnor vs Generic AI",
    copy: "How water-specific booking and on-call routing differ from broad generic automation.",
  },
]

const operatorProblems = [
  {
    icon: PhoneOff,
    title: "The emergency call reaches voicemail",
    copy: "A homeowner without water needs a response path now, not the next morning.",
  },
  {
    icon: Truck,
    title: "A household has no water",
    copy: "The caller may be dealing with a failed pump, zero tank pressure, livestock needs, or a family that cannot wait until morning.",
  },
  {
    icon: AlertTriangle,
    title: "Safety context gets buried",
    copy: "Possible contamination, electrical concerns, a dry-running pump, or a pressure system fault needs to be visible in the first alert.",
  },
  {
    icon: Clock3,
    title: "The next company answers first",
    copy: "Emergency buyers keep calling. The company that responds first and routes the job clearly has the advantage.",
  },
]

const comparisonRows = [
  {
    id: "answering-service",
    label: "Finnor vs Answering Service",
    points: [
      "Clarifies caller, address, pump type, pressure issue, no-water duration, contamination risk, urgency, and callback.",
      "Routes the urgent job to the owner, dispatcher, or on-call tech instead of leaving a loose message.",
      "Quotes ranges from your pricing and real water data automatically. Keeps ETAs, repairs, diagnosis, and final figures with your human team.",
    ],
  },
  {
    id: "generic-ai",
    label: "Finnor vs Generic AI",
    points: [
      "Two equally-featured workflows: water treatment quoting (softeners, filtration, RO, iron/sulfur), and well pump / no-water emergency dispatch.",
      "Keeps unknown fields marked unknown instead of filling gaps confidently.",
      "Recognizes urgency in both workflow types: treatment interest and timing from quotes, and emergency language like no water, zero pressure, pump failure, contamination risk.",
    ],
  },
]

export function ResourcesHub() {
  return (
    <ResourceFrame>
      <ResourceHero
        kicker="Resource hub"
        title="Practical tools for booking and lead recovery."
        copy="For water treatment, water dealer, and well pump companies that cannot afford to lose quote requests, no-water calls, form leads, or after-hours inquiries."
        icon={BookOpenText}
        aside={<HubSignalCard />}
      />

      <section className="healthcare-section pt-0">
        <div className="container relative z-10 px-4 md:px-6">
          <div className="mb-12">
            <p className="text-xs font-black uppercase tracking-[0.2em] text-orange-700">
              The operating problem
            </p>
            <h2 className="mt-3 max-w-4xl text-3xl font-black tracking-tight text-slate-950 md:text-5xl">
              A homeowner calls because the water is out. Your coverage determines who gets the job.
            </h2>
            <div className="mt-7 grid gap-4 md:grid-cols-2 lg:grid-cols-4">
              {operatorProblems.map((problem) => (
                <div key={problem.title} className="ops-card rounded-2xl p-5">
                  <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-orange-50 text-orange-700">
                    <problem.icon className="h-5 w-5" />
                  </div>
                  <h3 className="mt-5 text-lg font-black tracking-tight text-slate-950">
                    {problem.title}
                  </h3>
                  <p className="mt-3 text-sm font-medium leading-relaxed text-slate-600">
                    {problem.copy}
                  </p>
                </div>
              ))}
            </div>
          </div>

          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {resourceCards.map((card, index) => (
              <motion.a
                key={card.title}
                href={card.href}
                initial={{ opacity: 0, y: 22 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, margin: "-70px" }}
                transition={{ delay: index * 0.05 }}
                className="ops-card ops-card-hover group flex min-h-[19rem] flex-col justify-between rounded-2xl p-6"
                data-cursor="hover"
              >
                <div>
                  <div className="mb-8 flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-950 text-white shadow-lg">
                    <card.icon className="h-5 w-5 text-teal-200" />
                  </div>
                  <p className="text-xs font-black uppercase tracking-[0.2em] text-slate-600">
                    {card.kicker}
                  </p>
                  <h2 className="mt-3 text-2xl font-black tracking-tight text-slate-950">{card.title}</h2>
                  <p className="mt-4 text-sm font-medium leading-relaxed text-slate-600">{card.copy}</p>
                </div>
                <span className="mt-8 inline-flex items-center gap-2 text-sm font-black text-slate-950">
                  Open resource
                  <ArrowRight className="h-4 w-4 transition group-hover:translate-x-1" />
                </span>
              </motion.a>
            ))}
          </div>

          <div className="mt-10 grid gap-5 lg:grid-cols-2">
            {comparisonRows.map((row, index) => (
              <motion.div
                key={row.id}
                id={row.id}
                initial={{ opacity: 0, y: 22 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, margin: "-80px" }}
                transition={{ delay: index * 0.07 }}
                className="ops-card rounded-[2rem] p-6 md:p-7"
              >
                <p className="text-xs font-black uppercase tracking-[0.2em] text-teal-700">
                  Comparison note
                </p>
                <h2 className="mt-3 text-3xl font-black tracking-tight text-slate-950">{row.label}</h2>
                <div className="mt-6 space-y-3">
                  {row.points.map((point) => (
                    <div key={point} className="flex gap-3 rounded-2xl border border-slate-900/8 bg-white/72 p-4">
                      <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-teal-700" />
                      <p className="text-sm font-semibold leading-relaxed text-slate-700">{point}</p>
                    </div>
                  ))}
                </div>
              </motion.div>
            ))}
          </div>
        </div>
      </section>
    </ResourceFrame>
  )
}

function HubSignalCard() {
  return (
    <div className="ops-card relative overflow-hidden rounded-[2rem] p-5 md:p-6">
      <div className="pointer-events-none absolute inset-x-0 top-0 h-2 bg-gradient-to-r from-slate-950 via-sky-700 to-teal-600" />
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_18%_0%,rgba(14,165,233,0.12),transparent_36%),linear-gradient(135deg,rgba(45,212,191,0.08),transparent_50%)]" />
      <div className="relative">
        <p className="text-xs font-black uppercase tracking-[0.22em] text-slate-600">
          Booking and recovery operating loop
        </p>
        <div className="signal-thread mt-5 flex min-h-14 flex-wrap items-center justify-between gap-2 rounded-2xl border border-slate-200 bg-white px-3 py-3">
          {["Answer", "Book", "Route", "Human promise"].map((item) => (
            <span
              key={item}
              className="relative z-10 rounded-full border border-slate-200 bg-white px-3 py-1.5 text-[10px] font-black uppercase tracking-widest text-slate-700 shadow-sm"
            >
              {item}
            </span>
          ))}
        </div>
        <p className="mt-6 rounded-2xl border border-teal-200 bg-teal-50 p-4 text-sm font-semibold leading-relaxed text-slate-700">
          Use these resources to map the full recovery path: answer or follow up, book the next
          step when appropriate, route urgency fast, and keep quotes, ETAs, and service promises with your team.
        </p>
      </div>
    </div>
  )
}
