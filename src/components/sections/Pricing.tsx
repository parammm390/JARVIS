"use client"

import { motion } from "framer-motion"
import {
  ArrowRight,
  CheckCircle2,
  Clock3,
  Play,
  ShieldCheck,
  Sparkles,
} from "lucide-react"
import { siteConfig } from "@/config/site"
import { Magnetic } from "@/components/ui/magnetic"

const included = [
  "AI quoting agent on every missed, overflow, and after-hours call",
  "Live water data by ZIP: USGS well samples + EPA system records",
  "Sizing math and quote ranges from your pricing tiers",
  "Tap-to-book SMS with the report and three slots",
  "No-water urgent route with safety screen and on-call handoff",
  "Household memory record for every lead, with next revenue action",
  "Review asks, salt check-ins, re-test and rebed clocks on cadence",
  "Referral attribution back to the review that produced it",
  "Speed-to-lead callbacks on forms and paid leads",
  "7-day scoped rollout with your team in the loop",
]

const guarantees = [
  {
    number: "01",
    title: "Response guarantee",
    copy: "If an eligible call reaches Finnor and we miss it, your next month is free.",
  },
  {
    number: "02",
    title: "Launch guarantee",
    copy: "If we do not launch your scoped workflow within 7 days after receiving required access, we refund your initial payment.",
  },
  {
    number: "03",
    title: "Route Guarantee",
    copy: "Every eligible inbound contact Finnor handles during your covered hours produces a booked-next-step route or urgent alert to your configured path. If a handled contact produces no route, that month is free.",
  },
]

export function Pricing() {
  return (
    <section id="pricing" className="healthcare-section relative overflow-hidden py-20 md:py-28">
      <div className="pointer-events-none absolute left-[-12%] top-0 h-[34rem] w-[34rem] rounded-full bg-sky-200/35 blur-[120px]" />
      <div className="pointer-events-none absolute bottom-0 right-[-10%] h-[34rem] w-[34rem] rounded-full bg-teal-100/55 blur-[130px]" />

      <div className="container relative z-10 px-4 md:px-6">
        <div className="mx-auto mb-12 max-w-4xl text-center md:mb-16">
          <motion.div
            initial={{ opacity: 0, y: 14 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            className="mb-5 inline-flex items-center rounded-full border border-slate-200 bg-white/75 px-4 py-1.5 text-xs font-black uppercase tracking-[0.22em] text-slate-600 shadow-sm backdrop-blur"
          >
            <ShieldCheck className="mr-2 h-3.5 w-3.5 text-teal-600" />
            Founding pilot
          </motion.div>
          <motion.h2
            initial={{ opacity: 0, y: 18 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            className="text-4xl font-black tracking-tight text-slate-950 md:text-6xl"
          >
            One pilot. A quoting agent and a memory your competitors cannot copy.
          </motion.h2>
          <p className="mx-auto mt-5 max-w-2xl text-lg font-medium leading-relaxed text-slate-600">
            The full system: answered calls, live water data, quotes from your pricing, booked
            visits, and a household record that keeps producing revenue for years. Humans keep
            every final decision.
          </p>
        </div>

        <motion.article
          initial={{ opacity: 0, y: 28 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: "-80px" }}
          className="relative mx-auto max-w-6xl overflow-hidden rounded-[2.25rem] border border-slate-800 bg-slate-950 text-white shadow-[0_42px_130px_rgba(15,38,62,0.28)]"
        >
          <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_12%_0%,rgba(56,189,248,0.22),transparent_34%),radial-gradient(circle_at_92%_18%,rgba(45,212,191,0.16),transparent_30%)]" />
          <div className="pointer-events-none absolute inset-0 command-grid opacity-40" />
          <div className="relative grid lg:grid-cols-[0.9fr_1.1fr]">
            <div className="border-b border-white/10 p-6 sm:p-9 lg:border-b-0 lg:border-r lg:p-11">
              <div className="flex flex-wrap gap-2">
                <span className="rounded-full border border-sky-200/25 bg-sky-200/10 px-3 py-1.5 text-[10px] font-black uppercase tracking-[0.2em] text-sky-100">
                  Founding cohort
                </span>
                <span className="rounded-full border border-teal-200/25 bg-teal-200/10 px-3 py-1.5 text-[10px] font-black uppercase tracking-[0.2em] text-teal-100">
                  7 founding slots
                </span>
              </div>
              <h3 className="mt-8 max-w-xl text-3xl font-black tracking-tight sm:text-4xl">
                Founding Quoting Agent Pilot
              </h3>
              <div className="mt-8 flex items-end gap-3">
                <span className="text-5xl font-black tracking-[-0.05em] sm:text-7xl">Pilot</span>
                <span className="pb-2 text-lg font-black text-slate-300">scoped around your calls, water, and pricing</span>
              </div>
              <div className="mt-5 max-w-lg space-y-1 text-base font-bold leading-relaxed text-slate-100">
                <p>Quoting calls, urgent well pump routes, tap-to-book texts, and the household memory behind all of it</p>
                <p>Pricing reviewed after the workflow fit check</p>
              </div>
              <div className="mt-7 rounded-2xl border border-white/10 bg-white/[0.055] p-4">
                <p className="text-sm font-bold leading-relaxed text-slate-200">
                  Multi-location dealers are scoped by location, lead source, coverage window, and workflow complexity.
                </p>
                <p className="mt-3 border-t border-white/10 pt-3 text-sm font-black leading-relaxed text-white">
                  Founding pilots are limited to teams ready to launch one approved workflow within 7 days.
                </p>
              </div>
              <div className="mt-8 flex flex-col gap-3 sm:flex-row lg:flex-col xl:flex-row">
                <Magnetic strength={0.14}>
                  <a
                    href={siteConfig.calendlyLink}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="cta-primary inline-flex min-h-[3.25rem] shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-full bg-white px-4 text-[13px] font-black text-slate-950 transition hover:-translate-y-0.5 hover:bg-sky-50"
                  >
                    Apply for Founding Pilot
                    <ArrowRight className="h-4 w-4" />
                  </a>
                </Magnetic>
                <a
                  href={siteConfig.demoLink}
                  className="inline-flex min-h-[3.25rem] shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-full border border-white/15 bg-white/[0.06] px-4 text-[13px] font-black text-white transition hover:-translate-y-0.5 hover:bg-white/10"
                >
                  <Play className="h-4 w-4 fill-white" />
                  Build Your Company Demo
                </a>
              </div>
            </div>

            <div className="p-6 sm:p-9 lg:p-11">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <p className="text-[10px] font-black uppercase tracking-[0.22em] text-teal-200">Included in pilot</p>
                  <h4 className="mt-2 text-2xl font-black tracking-tight">The full lifecycle system</h4>
                </div>
                <Sparkles className="h-5 w-5 text-sky-200" />
              </div>
              <ul className="mt-7 grid gap-x-6 gap-y-4 sm:grid-cols-2">
                {included.map((detail) => (
                  <li key={detail} className="flex gap-3 text-sm font-semibold leading-relaxed text-slate-200">
                    <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-teal-300" />
                    <span>{detail}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>

          <div className="relative border-t-4 border-teal-300 bg-[linear-gradient(135deg,rgba(13,148,136,0.28),rgba(15,23,42,0.98)_42%,rgba(8,47,73,0.96))] p-6 sm:p-9 lg:p-11">
            <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_15%_0%,rgba(94,234,212,0.18),transparent_35%)]" />
            <div className="relative">
            <div className="mb-7 flex flex-col justify-between gap-4 md:flex-row md:items-end">
              <div>
                <p className="inline-flex rounded-full bg-teal-300 px-4 py-2 text-xs font-black uppercase tracking-[0.22em] text-slate-950">Pilot guarantee</p>
                <h4 className="mt-4 text-3xl font-black leading-tight tracking-tight text-white sm:text-4xl">Response, launch, and routing. Backed in writing.</h4>
              </div>
              <div className="inline-flex items-center gap-2 rounded-full border border-teal-200/40 bg-teal-200/10 px-4 py-2 text-xs font-black uppercase tracking-[0.16em] text-teal-50">
                <Clock3 className="h-4 w-4 text-teal-300" />
                7-day scoped rollout
              </div>
            </div>
            <div className="grid gap-4 md:grid-cols-2">
              {guarantees.map((guarantee) => (
                <div key={guarantee.number} className="rounded-2xl border-2 border-teal-200/50 bg-slate-950/85 p-6 shadow-[0_18px_50px_rgba(20,184,166,0.18)] sm:p-7">
                  <div className="flex items-center gap-3">
                    <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-teal-300 text-sm font-black text-slate-950">{guarantee.number}</span>
                    <p className="text-sm font-black uppercase tracking-[0.18em] text-teal-100">{guarantee.title}</p>
                  </div>
                  <p className="mt-6 text-xl font-black leading-snug text-white sm:text-2xl">“{guarantee.copy}”</p>
                </div>
              ))}
            </div>
            <div className="mt-5 grid gap-3 text-xs font-semibold leading-relaxed text-slate-300 md:grid-cols-2">
              <p className="rounded-xl border border-white/10 bg-white/[0.035] px-4 py-3">
                <strong className="text-white">Eligible call:</strong> a call routed to Finnor through the agreed pilot setup, inside the approved workflow scope.
              </p>
              <p className="rounded-xl border border-white/10 bg-white/[0.035] px-4 py-3">
                <strong className="text-white">Trust boundary:</strong> the agent quotes ranges computed from your pricing and the real water, and never invents a number. Final figures, ETAs, repairs, and customer promises stay with your team.
              </p>
            </div>
            </div>
          </div>
        </motion.article>
      </div>
    </section>
  )
}
