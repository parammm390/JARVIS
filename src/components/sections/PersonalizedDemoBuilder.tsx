"use client"

import { motion } from "framer-motion"
import {
  ArrowRight,
  Gauge,
  Globe2,
  History,
  LayoutDashboard,
  PhoneCall,
  ShieldCheck,
} from "lucide-react"
import { siteConfig } from "@/config/site"
import { Magnetic } from "@/components/ui/magnetic"

const builders = [
  {
    eyebrow: "Demo builder 01",
    title: "Live Call & Booking Demo",
    description:
      "Enter a company name and website. FINNOR pulls real water data, sizes and quotes the system from your pricing, books the visit on the call, and routes a structured handoff for urgent situations.",
    href: siteConfig.demoLink,
    cta: "Build My Live Demo",
    icon: PhoneCall,
    bullets: [
      "Live water data pulls by ZIP code",
      "Quote ranges computed from your pricing",
      "Tap-to-book SMS with the quote and open slots",
    ],
    accent: "sky",
  },
  {
    eyebrow: "Demo builder 02",
    title: "Customer Lifecycle Demo",
    description:
      "Enter your service ZIP, pricing tier, and install mix. FINNOR pulls public water data, runs the sizing math, prices the job, and shows one customer record evolving across two years.",
    href: "/demo/lifecycle",
    cta: "Build My Lifecycle Demo",
    icon: History,
    bullets: [
      "Live public water records by ZIP",
      "Sizing math and quote logic shown",
      "Two-year memory, reviews, referrals, and upsells",
    ],
    accent: "teal",
  },
  {
    eyebrow: "Demo builder 03",
    title: "Operations Dashboard Demo",
    description:
      "Configure your services, region, team, lead sources, and response gaps. FINNOR generates a working account dashboard with call logs, recovery queues, lead-speed tools, and live call controls.",
    href: siteConfig.dashboardDemoLink,
    cta: "Build My Dashboard Demo",
    icon: LayoutDashboard,
    bullets: ["Personalized operations dashboard", "Missed-call and speed-to-lead tools", "Live calls, transcripts, and handoffs"],
    accent: "sky",
  },
]

export function PersonalizedDemoBuilder() {
  return (
    <section id="demo-builder" className="healthcare-section">
      <div className="absolute right-[-14rem] top-12 h-[34rem] w-[34rem] rounded-full bg-sky-100/70 blur-3xl" />
      <div className="container relative z-10 px-4 md:px-6">
        <div>
          <div className="max-w-4xl">
            <motion.div
              initial={{ opacity: 0, y: 16 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              className="mb-5 inline-flex rounded-full border border-teal-200 bg-teal-50 px-4 py-2 text-xs font-black uppercase tracking-[0.18em] text-teal-700"
            >
              Three public demo builders
            </motion.div>
            <motion.h2
              initial={{ opacity: 0, y: 18 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              className="text-4xl font-black tracking-tight text-slate-950 md:text-6xl"
            >
              Build FINNOR around your own company.
            </motion.h2>
            <motion.p
              initial={{ opacity: 0, y: 16 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ delay: 0.08 }}
              className="mt-6 max-w-2xl text-lg font-medium leading-relaxed text-slate-600"
            >
              Choose the experience you want to test. Build a company-specific lead recovery agent
              from public website context, run the new lifecycle demo on public water data and your
              pricing tier, or configure a complete operations dashboard around your services,
              market, team, and lead flow. All three are live and available without an account.
            </motion.p>
          </div>

          <motion.div
            initial={{ opacity: 0, y: 24 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: "-80px" }}
            className="mt-10 grid gap-5 lg:grid-cols-3"
          >
            {builders.map((builder) => {
              const Icon = builder.icon
              const isTeal = builder.accent === "teal"
              return (
                <article key={builder.title} className="ops-card soft-edge flex h-full flex-col overflow-hidden rounded-[2rem] p-6 md:p-8">
                  <div className="flex items-start justify-between gap-5">
                    <div>
                      <p className={`text-xs font-black uppercase tracking-[0.18em] ${isTeal ? "text-teal-700" : "text-sky-800"}`}>
                        {builder.eyebrow}
                      </p>
                      <h3 className="mt-3 text-3xl font-black tracking-tight text-slate-950">{builder.title}</h3>
                    </div>
                    <span className={`grid h-14 w-14 shrink-0 place-items-center rounded-2xl ${isTeal ? "bg-teal-50 text-teal-700" : "bg-sky-50 text-sky-800"}`}>
                      <Icon className="h-6 w-6" />
                    </span>
                  </div>
                  <p className="mt-5 text-base font-semibold leading-relaxed text-slate-600">{builder.description}</p>
                  <div className="mt-6 space-y-3">
                    {builder.bullets.map((item) => (
                      <div key={item} className="flex items-center gap-3 rounded-2xl border border-slate-900/8 bg-white p-4">
                        <ShieldCheck className={`h-4 w-4 shrink-0 ${isTeal ? "text-teal-600" : "text-sky-700"}`} />
                        <span className="text-sm font-bold text-slate-700">{item}</span>
                      </div>
                    ))}
                  </div>
                  <div className="mt-auto pt-7">
                    <Magnetic strength={0.12}>
                      <a href={builder.href} data-cursor="hover" className="inline-flex min-h-14 w-full items-center justify-center gap-2 rounded-full bg-slate-950 px-6 py-3 text-sm font-black text-white shadow-[0_18px_48px_rgba(15,35,54,0.18)] transition hover:-translate-y-0.5 hover:bg-slate-800">
                        {builder.cta}
                        <ArrowRight className="h-4 w-4" />
                      </a>
                    </Magnetic>
                  </div>
                </article>
              )
            })}
          </motion.div>

          <div className="mt-6 grid gap-3 rounded-[1.5rem] border border-slate-900/10 bg-white/70 p-5 text-sm font-bold text-slate-700 sm:grid-cols-3">
            <span className="flex items-center gap-2"><Globe2 className="h-4 w-4 text-sky-700" />Built for any water company</span>
            <span className="flex items-center gap-2"><Gauge className="h-4 w-4 text-teal-700" />Interactive, not a static mockup</span>
            <span className="flex items-center gap-2"><ShieldCheck className="h-4 w-4 text-teal-700" />Unknowns stay clearly marked</span>
          </div>
        </div>
      </div>
    </section>
  )
}
