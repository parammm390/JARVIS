"use client"

import { motion } from "framer-motion"
import { AlertTriangle, CheckCircle2, FileLock2, ShieldCheck, UserRoundCheck } from "lucide-react"

const scopeItems = [
  {
    icon: CheckCircle2,
    title: "Quotes from your numbers only",
    copy: "Ranges come from real public water data, sizing math, and the pricing tier you set. FINNOR never invents a price, a contaminant, or a health claim.",
  },
  {
    icon: UserRoundCheck,
    title: "Human decision path",
    copy: "The final on-site figure, repair calls, diagnosis, ETAs, and customer promises stay with your team. The agent quotes the range; your people close.",
  },
  {
    icon: ShieldCheck,
    title: "Scoped launch terms",
    copy: "Routing, alert paths, escalation rules, pricing tiers, integrations, and data handling are defined before live deployment.",
  },
]

export function Outcome() {
  return (
    <section id="boundaries" className="healthcare-section bg-white/42">
      <div className="absolute inset-0 operational-grid opacity-45" />
      <div className="container relative z-10 px-4 md:px-6">
        <div className="grid gap-10 lg:grid-cols-[0.9fr_1.1fr] lg:items-start">
          <div>
            <motion.div
              initial={{ opacity: 0, y: 16 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              className="mb-5 inline-flex rounded-full border border-sky-200 bg-sky-50 px-4 py-2 text-xs font-black uppercase tracking-[0.18em] text-sky-800"
            >
              Operational safety boundaries
            </motion.div>
            <motion.h2
              initial={{ opacity: 0, y: 18 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              className="text-4xl font-black tracking-tight text-slate-950 md:text-6xl"
            >
            Quotes from your pricing. Decisions stay yours.
            </motion.h2>
            <motion.p
              initial={{ opacity: 0, y: 16 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ delay: 0.08 }}
              className="mt-6 max-w-2xl text-lg font-medium leading-relaxed text-slate-600"
            >
              The booking and lead recovery system works inside hard rails. It quotes ranges computed from the water
              and the tier you priced, books the visit, and keeps the record alive for years. It
              does not diagnose repairs, promise ETAs, or freelance a discount. Your team owns
              every final call.
            </motion.p>
          </div>

          <motion.div
            initial={{ opacity: 0, y: 22 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: "-80px" }}
            className="ops-card rounded-[2rem] p-6 md:p-7"
          >
            <div className="mb-6 flex items-center justify-between gap-4">
              <div>
                <p className="text-xs font-black uppercase tracking-[0.2em] text-sky-800">
                  Operating scope
                </p>
                <h3 className="mt-2 text-2xl font-black tracking-tight text-slate-950">
                  Rails the agent cannot cross.
                </h3>
              </div>
              <FileLock2 className="h-6 w-6 text-slate-700" />
            </div>
            <div className="grid gap-4">
              {scopeItems.map((item) => (
                <div key={item.title} className="flex gap-4 rounded-2xl border border-slate-900/8 bg-white p-4">
                  <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-sky-50 text-sky-800">
                    <item.icon className="h-5 w-5" />
                  </span>
                  <div>
                    <h4 className="font-black tracking-tight text-slate-950">{item.title}</h4>
                    <p className="mt-1 text-sm font-semibold leading-relaxed text-slate-600">
                      {item.copy}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </motion.div>
        </div>

        <div className="mt-6 flex items-start gap-3 rounded-2xl border border-orange-200 bg-orange-50 p-5 text-sm font-semibold leading-relaxed text-orange-900">
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" />
          <p>
            This page does not claim full operational data handling compliance. Compliance depends on the deployed
            stack, vendor agreements, access controls, and signed terms.
          </p>
        </div>
      </div>
    </section>
  )
}
