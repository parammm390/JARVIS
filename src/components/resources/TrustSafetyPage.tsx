"use client"

import { motion } from "framer-motion"
import {
  AlertTriangle,
  ClipboardList,
  FileQuestion,
  LockKeyhole,
  Route,
  ShieldCheck,
  UserRoundCheck,
} from "lucide-react"
import { ResourceFrame } from "./ResourceFrame"
import { ResourceHero } from "./ResourceHero"

const trustSections = [
  {
    icon: UserRoundCheck,
    title: "Human teams stay in control",
    copy: "FINNOR quotes ranges computed from your pricing tiers and real public water data, and books the visit. People remain responsible for final figures, repair decisions, ETAs, dispatch, and customer promises.",
  },
  {
    icon: ShieldCheck,
    title: "FINNOR never invents numbers or diagnoses",
    copy: "Quote ranges come only from the pricing you configured and the measured water data on record. FINNOR does not diagnose repairs, invent prices, guarantee ETAs, or make health claims about water.",
  },
  {
    icon: AlertTriangle,
    title: "Urgent language routes to human escalation path",
    copy: "Companies define the escalation path for urgent or concerning language. Finnor flags that language and routes it according to the approved process.",
  },
  {
    icon: ClipboardList,
    title: "Company-approved scripts and knowledge boundaries",
    copy: "Pilot scripts, booking questions, and knowledge boundaries are approved before use so the system stays within the company's operating model.",
  },
  {
    icon: FileQuestion,
    title: "Public-info-only demo builder",
    copy: "The personalized demo builder uses public website information and user-provided inputs. It is not a production deployment or a claim about private systems.",
  },
  {
    icon: Route,
    title: "Unknown fields stay marked unknown",
    copy: "If a caller does not provide a field, the route should show that it is unknown rather than inventing or assuming an answer.",
  },
  {
    icon: LockKeyhole,
    title: "Data minimization during pilots",
    copy: "Pilots should use only the information needed to test booking paths, urgent routing, escalation, and follow-up workflow.",
  },
  {
    icon: ShieldCheck,
    title: "Scoped deployment before production",
    copy: "Finnor is intended to start with a defined routing scope, reviewed scripts, test scenarios, and clear human ownership before broader use.",
  },
]

const boundaries = [
  "Your dispatcher or on-call technician",
  "Repair decisions and troubleshooting",
  "Repair diagnosis or equipment troubleshooting",
  "The final on-site quote figure — FINNOR quotes ranges computed from your pricing and real water data, and never invents a number",
  "Emergency services",
  "A company's operating and safety policies",
  "Human follow-up with homeowners and property owners",
]

export function TrustSafetyPage() {
  return (
    <ResourceFrame>
      <ResourceHero
        kicker="Trust & safety"
        title="Booking automation with clear human boundaries."
        copy="Finnor is built to recover missed, overflow, after-hours, and slow web leads while keeping decisions, judgment, and escalation ownership with the service company."
        icon={ShieldCheck}
        aside={<TrustCommandCard />}
      />

      <section className="healthcare-section pt-0">
        <div className="container relative z-10 px-4 md:px-6">
          <div className="grid gap-4 md:grid-cols-2">
            {trustSections.map((section, index) => (
              <motion.div
                key={section.title}
                initial={{ opacity: 0, y: 22 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, margin: "-70px" }}
                transition={{ delay: index * 0.04 }}
                className="ops-card ops-card-hover rounded-2xl p-6"
                data-cursor="hover"
              >
                <div className="mb-7 flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-950 text-white shadow-lg">
                  <section.icon className="h-5 w-5 text-teal-200" />
                </div>
                <p className="text-xs font-black uppercase tracking-[0.2em] text-slate-500">
                  Boundary {String(index + 1).padStart(2, "0")}
                </p>
                <h2 className="mt-3 text-2xl font-black tracking-tight text-slate-950">{section.title}</h2>
                <p className="mt-4 text-sm font-medium leading-relaxed text-slate-600">{section.copy}</p>
              </motion.div>
            ))}
          </div>

          <div className="mt-8 grid gap-5 lg:grid-cols-[0.92fr_1.08fr]">
            <motion.div
              initial={{ opacity: 0, y: 22 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: "-80px" }}
              className="ops-card rounded-[2rem] p-6 md:p-7"
            >
              <p className="text-xs font-black uppercase tracking-[0.2em] text-orange-700">
                What Finnor does not replace
              </p>
              <h2 className="mt-3 text-3xl font-black tracking-tight text-slate-950">
                The company remains the decision-maker.
              </h2>
              <div className="mt-6 grid gap-3">
                {boundaries.map((item) => (
                  <div key={item} className="flex items-center gap-3 rounded-2xl border border-slate-900/8 bg-white/72 p-4">
                    <UserRoundCheck className="h-4 w-4 text-teal-700" />
                    <span className="text-sm font-black text-slate-700">{item}</span>
                  </div>
                ))}
              </div>
            </motion.div>

            <motion.div
              initial={{ opacity: 0, y: 22 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: "-80px" }}
              className="ops-card relative overflow-hidden rounded-[2rem] p-6 md:p-7"
            >
              <div className="pointer-events-none absolute inset-x-0 top-0 h-2 bg-gradient-to-r from-slate-950 via-sky-700 to-teal-600" />
              <p className="text-xs font-black uppercase tracking-[0.2em] text-sky-800">
                Deployment note
              </p>
              <h2 className="mt-3 text-3xl font-black tracking-tight text-slate-950">
                Production scope depends on the final routing, systems, and agreements.
              </h2>
              <p className="mt-5 text-base font-semibold leading-relaxed text-slate-700">
                Production readiness depends on final routing, data handling, vendor agreements,
                access controls, retention settings, escalation procedures, and the company&apos;s
                own policies. Finnor scopes those decisions before launch.
              </p>
              <div className="mt-7 rounded-2xl border border-teal-200 bg-teal-50 p-5">
                <p className="text-sm font-black text-slate-950">
                  Conservative operating principle
                </p>
                <p className="mt-2 text-sm font-semibold leading-relaxed text-slate-700">
                  Quote only from configured pricing and measured water data, book the next step,
                  route urgent language, and leave final figures, dispatch decisions, repair
                  judgment, ETAs, and promises to the human team.
                </p>
              </div>
            </motion.div>
          </div>
        </div>
      </section>
    </ResourceFrame>
  )
}

function TrustCommandCard() {
  return (
    <div className="relative mx-auto max-w-[620px]">
      <div className="absolute -inset-6 rounded-[2.25rem] bg-gradient-to-br from-sky-200/52 via-white/40 to-teal-100/45 blur-2xl" />
      <div className="relative overflow-hidden rounded-[2rem] border border-slate-900 bg-slate-950 p-5 text-white shadow-[0_34px_110px_rgba(8,24,39,0.28)]">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_22%_0%,rgba(125,211,252,0.22),transparent_34%),linear-gradient(135deg,rgba(45,212,191,0.11),transparent_46%)]" />
        <div className="absolute inset-0 command-grid opacity-50" />
        <div className="relative">
          <p className="text-xs font-black uppercase tracking-[0.22em] text-sky-100">
            Operating boundary
          </p>
          <h2 className="mt-2 text-2xl font-black tracking-tight">Human team owns next steps</h2>
          <div className="mt-5 grid gap-3">
            {["Approved script", "Booking route", "Urgency route", "Human promise"].map((item) => (
              <div key={item} className="flex items-center gap-3 rounded-2xl border border-white/10 bg-white/[0.04] p-4">
                <ShieldCheck className="h-4 w-4 text-teal-200" />
                <span className="text-sm font-black text-white">{item}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
