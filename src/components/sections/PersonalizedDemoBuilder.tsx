"use client";

import { motion } from "framer-motion";
import { ArrowRight, History, PhoneCall, ShieldCheck } from "lucide-react";
import { siteConfig } from "@/config/site";
import { Magnetic } from "@/components/ui/magnetic";

// M3.T3, reframed into the single "try it on your business" CTA (plan §2.4 beat 6).
// Was a 3-card grid pointing at three separate demo routes, including the fake-data
// `/dashboard-demo` ops dashboard. That route is cut in M4 (merge-contract §"what gets
// cut"), so this points only at the two real, live mechanisms, /demo (scrape + live
// Vapi call) chained into /demo/lifecycle (the two-year household record), matching
// what M4 wires as one continuous flow. Link target stays siteConfig.demoLink; no
// change needed once M4 lands since Act 1 already terminates by handing off into Act 2.
const steps = [
  {
    icon: PhoneCall,
    label: "Choose a business outcome",
    copy: "Select what you want JARVIS to accomplish: leads, proposals, scheduling, collections, campaigns or operational intelligence.",
  },
  {
    icon: ShieldCheck,
    label: "See the workflow draft",
    copy: "JARVIS builds a clearly labelled demonstration using public website information and the details you provide.",
  },
  {
    icon: History,
    label: "Review the execution",
    copy: "See what was planned, what would require approval, and what the verification would show.",
  },
];

export function PersonalizedDemoBuilder() {
  return (
    <section id="demo-builder" className="healthcare-section">
      <div className="absolute right-[-14rem] top-12 h-[34rem] w-[34rem] rounded-full bg-sky-100/70 blur-3xl" />
      <div className="container relative z-10 px-4 md:px-6">
        <div className="mx-auto max-w-3xl text-center">
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            className="mb-5 inline-flex rounded-full border border-teal-200 bg-teal-50 px-4 py-2 text-xs font-black uppercase tracking-[0.18em] text-teal-700"
          >
            Try it on your business
          </motion.div>
          <motion.h2
            initial={{ opacity: 0, y: 18 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            className="text-4xl font-black tracking-tight text-slate-950 md:text-6xl"
          >
            See JARVIS operate your business.
          </motion.h2>
          <motion.p
            initial={{ opacity: 0, y: 16 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ delay: 0.08 }}
            className="mx-auto mt-6 max-w-2xl text-lg font-medium leading-relaxed text-slate-600"
          >
            Enter your company and choose a business outcome. JARVIS builds a clearly labelled demonstration using public website information and the details you provide. Unknown information stays marked unknown. No account needed.
          </motion.p>
        </div>

        <motion.div
          initial={{ opacity: 0, y: 22 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: "-60px" }}
          className="mt-12 grid gap-4 sm:grid-cols-3"
        >
          {steps.map((step) => (
            <div
              key={step.label}
              className="ops-card rounded-2xl p-6 text-left"
            >
              <span className="mb-5 flex h-11 w-11 items-center justify-center rounded-2xl bg-sky-50 text-sky-800">
                <step.icon className="h-5 w-5" />
              </span>
              <h3 className="font-black tracking-tight text-slate-950">
                {step.label}
              </h3>
              <p className="mt-2 text-sm font-medium leading-relaxed text-slate-600">
                {step.copy}
              </p>
            </div>
          ))}
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 18 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          className="mt-10 flex justify-center"
        >
          <Magnetic strength={0.14}>
            <a
              href={siteConfig.demoLink}
              data-cursor="hover"
              className="inline-flex min-h-16 items-center justify-center gap-2 rounded-full bg-slate-950 px-9 py-4 text-sm font-black text-white shadow-[0_18px_48px_rgba(15,35,54,0.18)] transition hover:-translate-y-0.5 hover:bg-slate-800"
            >
              Build My Demo
              <ArrowRight className="h-4 w-4" />
            </a>
          </Magnetic>
        </motion.div>

        <p className="mx-auto mt-6 max-w-xl text-center text-xs font-bold uppercase tracking-[0.14em] text-slate-500">
          Live, interactive, and clearly labeled DEMO, not a real approval, not
          a real record.
        </p>
      </div>
    </section>
  );
}
