"use client"

import { motion } from "framer-motion"
import {
  ArrowRight,
  CheckCircle2,
  Clock3,
} from "lucide-react"
import { siteConfig } from "@/config/site"
import { Magnetic } from "@/components/ui/magnetic"

const tiers = [
  {
    id: "quoting",
    kicker: "Tier 1",
    title: "Quoting Agent",
    subtitle: "Answer, quote, and book — inbound and outbound.",
    description:
      "The full quoting agent on every missed, overflow, and after-hours call, plus outbound speed-to-lead follow-up on your web and paid leads, with messaging automation that sends the quote and booking link within seconds of the call ending.",
    features: [
      "Inbound quoting agent — missed, overflow, and after-hours calls",
      "Outbound speed-to-lead callbacks on forms and paid leads",
      "Public water records plus a free onsite test to confirm the exact number",
      "Sizing and quote ranges computed from your own pricing tiers",
      "Tap-to-book SMS with the water report and open time slots, sent within seconds of the call ending",
      "No-water urgent route with safety screen and on-call handoff",
      "Operations dashboard — call log, recovery queue, live calls",
    ],
    cta: "Book a demo to see pricing",
    highlight: false,
  },
  {
    id: "growth",
    kicker: "Tier 2",
    title: "Growth & Memory",
    subtitle: "The quoting agent, plus a two-year household memory.",
    description:
      "Everything in Quoting Agent, and then the record keeps working after the invoice — every lead becomes a household memory that drives review requests, maintenance check-ins, referral tracking, and the right upsell moment, automatically, for two years.",
    features: [
      "Everything in Quoting Agent, plus:",
      "Two-year household memory record on every lead",
      "A standing next revenue action on every record",
      "Review requests timed to the right moment after install",
      "Salt delivery and maintenance check-ins on a cadence",
      "Re-test and rebed reminders on schedule",
      "Referral attribution back to the review that produced it",
      "History-aware upsell timing across the household's full record",
    ],
    cta: "Book a demo to see pricing",
    highlight: true,
  },
  {
    id: "multilocation",
    kicker: "Tier 3",
    title: "Multi-Location",
    subtitle: "Scoped to your locations, built around your operation.",
    description:
      "For dealers running more than one location or multiple lead sources — scoped by location, lead source, coverage window, and workflow complexity, priced to the actual build, not a menu.",
    features: [
      "Everything in Growth & Memory, plus:",
      "Per-location scoping — calls, coverage, and lead sources",
      "Custom CRM and webhook integrations into your existing stack",
      "Bulk missed-call recovery across every location",
      "Consolidated reporting across the whole account",
      "Priority build and a direct line to the founder",
    ],
    cta: "Talk through your locations",
    highlight: false,
  },
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

        <motion.div
          initial={{ opacity: 0, y: 28 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: "-80px" }}
          className="relative mx-auto max-w-6xl"
        >
          <div className="grid gap-6 lg:grid-cols-3">
            {tiers.map((tier) => (
              <article
                key={tier.id}
                className={`relative overflow-hidden rounded-[2.25rem] border text-white shadow-[0_42px_130px_rgba(15,38,62,0.28)] ${
                  tier.highlight
                    ? "border-slate-800 bg-slate-950"
                    : "border-slate-700 bg-slate-900"
                }`}
              >
                <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_12%_0%,rgba(56,189,248,0.22),transparent_34%),radial-gradient(circle_at_92%_18%,rgba(45,212,191,0.16),transparent_30%)]" />
                <div className="pointer-events-none absolute inset-0 command-grid opacity-40" />
                <div className="relative p-6 sm:p-8 lg:p-9">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <span className="rounded-full border border-teal-200/25 bg-teal-200/10 px-3 py-1.5 text-[10px] font-black uppercase tracking-[0.2em] text-teal-100">
                        {tier.kicker}
                      </span>
                      <h3 className="mt-4 text-2xl font-black tracking-tight sm:text-3xl">
                        {tier.title}
                      </h3>
                      <p className="mt-2 text-base font-bold text-slate-300">{tier.subtitle}</p>
                    </div>
                  </div>

                  <p className="mt-5 text-sm font-semibold leading-relaxed text-slate-200">
                    {tier.description}
                  </p>

                  <div className="mt-7 space-y-3">
                    {tier.features.map((feature) => (
                      <div key={feature} className="flex gap-3">
                        <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-teal-300" />
                        <span
                          className={`text-sm leading-relaxed ${
                            feature.startsWith("Everything") || feature.startsWith("All")
                              ? "font-bold text-slate-100"
                              : "font-semibold text-slate-200"
                          }`}
                        >
                          {feature}
                        </span>
                      </div>
                    ))}
                  </div>

                  <div className="mt-8">
                    <Magnetic strength={0.14}>
                      <a
                        href={siteConfig.calendlyLink}
                        target="_blank"
                        rel="noopener noreferrer"
                        className={`inline-flex min-h-[3rem] w-full items-center justify-center gap-2 whitespace-nowrap rounded-full px-4 text-[13px] font-black transition hover:-translate-y-0.5 ${
                          tier.highlight
                            ? "bg-white text-slate-950 hover:bg-sky-50"
                            : "border border-white/15 bg-white/[0.06] text-white hover:bg-white/10"
                        }`}
                      >
                        {tier.cta}
                        <ArrowRight className="h-4 w-4" />
                      </a>
                    </Magnetic>
                  </div>
                </div>
              </article>
            ))}
          </div>

          <div className="relative mt-12 overflow-hidden rounded-[2.25rem] border border-teal-300/50 bg-[linear-gradient(135deg,rgba(13,148,136,0.28),rgba(15,23,42,0.98)_42%,rgba(8,47,73,0.96))] p-6 text-white shadow-[0_42px_130px_rgba(15,38,62,0.28)] sm:p-9 lg:p-11">
            <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_15%_0%,rgba(94,234,212,0.18),transparent_35%)]" />
            <div className="relative">
              <div className="mb-7 flex flex-col justify-between gap-4 md:flex-row md:items-end">
                <div>
                  <p className="inline-flex rounded-full bg-teal-300 px-4 py-2 text-xs font-black uppercase tracking-[0.22em] text-slate-950">
                    Pilot guarantee
                  </p>
                  <h4 className="mt-4 text-3xl font-black leading-tight tracking-tight text-white sm:text-4xl">
                    Response, launch, and routing. Backed in writing.
                  </h4>
                </div>
                <div className="inline-flex items-center gap-2 rounded-full border border-teal-200/40 bg-teal-200/10 px-4 py-2 text-xs font-black uppercase tracking-[0.16em] text-teal-50">
                  <Clock3 className="h-4 w-4 text-teal-300" />
                  7-day scoped rollout
                </div>
              </div>
              <div className="grid gap-4 md:grid-cols-3">
                {guarantees.map((guarantee) => (
                  <div
                    key={guarantee.number}
                    className="rounded-2xl border-2 border-teal-200/50 bg-slate-950/85 p-6 shadow-[0_18px_50px_rgba(20,184,166,0.18)] sm:p-7"
                  >
                    <div className="flex items-center gap-3">
                      <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-teal-300 text-sm font-black text-slate-950">
                        {guarantee.number}
                      </span>
                      <p className="text-sm font-black uppercase tracking-[0.18em] text-teal-100">
                        {guarantee.title}
                      </p>
                    </div>
                    <p className="mt-6 text-lg font-black leading-snug text-white">
                      &quot;{guarantee.copy}&quot;
                    </p>
                  </div>
                ))}
              </div>
              <div className="mt-5 grid gap-3 text-xs font-semibold leading-relaxed text-slate-300 md:grid-cols-2">
                <p className="rounded-xl border border-white/10 bg-white/[0.035] px-4 py-3">
                  <strong className="text-white">Eligible call:</strong> a call routed to Finnor
                  through the agreed pilot setup, inside the approved workflow scope.
                </p>
                <p className="rounded-xl border border-white/10 bg-white/[0.035] px-4 py-3">
                  <strong className="text-white">Trust boundary:</strong> the agent quotes ranges
                  computed from your pricing and the real water, and never invents a number. Final
                  figures, ETAs, repairs, and customer promises stay with your team.
                </p>
              </div>
            </div>
          </div>
        </motion.div>
      </div>
    </section>
  )
}
