"use client"

import { motion } from "framer-motion"
import {
  BellRing,
  BookOpenCheck,
  ClipboardList,
  FileText,
  GitBranch,
  LayoutDashboard,
  MessagesSquare,
  PhoneForwarded,
  PhoneIncoming,
  PhoneMissed,
  Radar,
  Route,
  ShieldCheck,
  Mic2,
  BarChart3,
  Rocket,
} from "lucide-react"
import type { LucideIcon } from "lucide-react"

const capabilities: Array<{ icon: LucideIcon; title: string; copy: string }> = [
  {
    icon: PhoneMissed,
    title: "Water Test Booking",
    copy: "Turn softener, filtration, RO, and water quality inquiries into faster front-office follow-up and booked water tests.",
  },
  {
    icon: PhoneIncoming,
    title: "Well Pump Service Routing",
    copy: "Route no-water calls, pressure issues, pump failure language, and safety screens to the approved owner or on-call path.",
  },
  {
    icon: PhoneForwarded,
    title: "Form & Paid Lead Recovery",
    copy: "Respond faster to website forms, Google/Facebook leads, quote requests, and old inquiries while the homeowner is still shopping.",
  },
  {
    icon: ClipboardList,
    title: "Web Lead Booking Path",
    copy: "Move slow web leads toward a water test, service appointment, or human callback path instead of letting them sit.",
  },
  {
    icon: ShieldCheck,
    title: "Urgent Well Pump Routing",
    copy: "Flag no-water calls, pump or pressure issues, active leaks, and urgent water safety concerns for the right human route.",
  },
  {
    icon: Radar,
    title: "Urgency Rules",
    copy: "Identify approved urgent language and route it to the configured owner, dispatcher, or on-call path.",
  },
  {
    icon: BellRing,
    title: "Front-Office Alerts",
    copy: "Send the next-step route to the configured CSR, sales, dispatch, owner, or on-call team.",
  },
  {
    icon: FileText,
    title: "Booked-Job Context",
    copy: "Give the team enough context to follow up, confirm the appointment, or escalate without starting cold.",
  },
  {
    icon: BookOpenCheck,
    title: "Company-Specific Knowledge Base",
    copy: "Use approved public and configured company information with boundaries.",
  },
  {
    icon: Route,
    title: "Human-Controlled Promises",
    copy: "Keep repair decisions, quotes, ETAs, dispatch decisions, and customer promises with people.",
  },
  {
    icon: GitBranch,
    title: "Call Forwarding Ready",
    copy: "Start with practical forwarding, overflow, or dedicated-line routing.",
  },
  {
    icon: MessagesSquare,
    title: "Recovered Job Review",
    copy: "Review which missed calls and slow leads became booked next steps or urgent human routes.",
  },
  {
    icon: LayoutDashboard,
    title: "Simple Recovery View",
    copy: "See recovered calls, booked next steps, and follow-up status without making reporting the main product.",
  },
  {
    icon: Mic2,
    title: "Call Recordings",
    copy: "Keep call recordings available for review where configured and permitted by your workflow.",
  },
  {
    icon: BarChart3,
    title: "Recovery Review",
    copy: "See which missed calls and inbound leads turned into booked appointments, recovered jobs, or urgent routes.",
  },
  {
    icon: Rocket,
    title: "Founding Pilot Setup",
    copy: "Launch one approved booking and lead recovery workflow around your calls, forms, and front-office capacity.",
  },
]

export function Solution() {
  return (
    <section id="capabilities" className="healthcare-section">
      <div className="absolute left-[-14rem] top-24 h-[32rem] w-[32rem] rounded-full bg-teal-100/60 blur-3xl" />
      <div className="container relative z-10 px-4 md:px-6">
        <div className="mx-auto mb-14 max-w-4xl text-center">
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            className="mb-5 inline-flex rounded-full border border-teal-200 bg-teal-50 px-4 py-2 text-xs font-black uppercase tracking-[0.18em] text-teal-700"
          >
            Booking and recovery capabilities
          </motion.div>
          <motion.h2
            initial={{ opacity: 0, y: 18 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            className="text-4xl font-black tracking-tight text-slate-950 md:text-6xl"
          >
            Built to book more jobs from your existing water leads.
          </motion.h2>
          <motion.p
            initial={{ opacity: 0, y: 16 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ delay: 0.08 }}
            className="mx-auto mt-6 max-w-2xl text-lg font-medium leading-relaxed text-slate-600"
          >
            FINNOR uses scoped workflows for missed calls, after-hours coverage, overflow,
            web/form leads, and urgent well pump routes.
          </motion.p>
        </div>

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {capabilities.map((capability, index) => (
            <motion.div
              key={capability.title}
              initial={{ opacity: 0, y: 22 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: "-60px" }}
              transition={{ delay: index * 0.035 }}
              className="ops-card ops-card-hover rounded-2xl p-6"
              data-cursor="hover"
            >
              <div className="mb-7 flex h-12 w-12 items-center justify-center rounded-2xl bg-sky-50 text-sky-800">
                <capability.icon className="h-5 w-5" />
              </div>
              <h3 className="text-lg font-black tracking-tight text-slate-950">{capability.title}</h3>
              <p className="mt-3 text-sm font-medium leading-relaxed text-slate-600">
                {capability.copy}
              </p>
            </motion.div>
          ))}
        </div>

        <p className="mx-auto mt-8 max-w-3xl text-center text-sm font-bold leading-relaxed text-slate-600">
          FINNOR sits behind the demand you already generate and helps your team convert more of it
          into booked water tests, service appointments, and recovered jobs.
        </p>
      </div>
    </section>
  )
}
