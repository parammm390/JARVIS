"use client"

import { motion } from "framer-motion"
import { CheckCircle2, ClipboardCheck, Route } from "lucide-react"
import { ResourceFrame } from "./ResourceFrame"
import { ResourceHero } from "./ResourceHero"

const checklist = [
  ["Call forwarding rules", "Decide when calls forward: missed, overflow, after-hours, or a scoped test window."],
  ["After-hours coverage window", "Set the exact nights, weekends, holidays, or overflow conditions included in the pilot."],
  ["Quote/form lead sources", "List every inbound website form, Google/Facebook lead source, quote request, and old-inquiry queue in scope."],
  ["Booking questions", "Approve the first-pass questions Finnor should ask for water tests, service appointments, callbacks, and urgent routes."],
  ["Urgency escalation path", "Name the human path for no water, zero pressure, possible contamination, pump failure, or an immediate safety concern."],
  ["SMS/email recipients", "Choose the owner, CSR, dispatcher, or on-call technician who receives each structured alert."],
  ["Recovery fields", "Approve the call, lead, booking status, urgent route, recording, and recovered-opportunity fields your team needs to review."],
  ["Call recording settings", "Confirm whether recording is enabled, where it appears, and any applicable notice requirements."],
  ["Route format", "Approve the booking and urgent alert format your team can scan and act on quickly."],
  ["7-day launch review", "Schedule the scoped launch review to inspect calls, routes, unknowns, and workflow adjustments."],
  ["Pilot success metrics", "Track calls and leads answered, alerts delivered, response speed, booked next steps, and recovered opportunities."],
]

export function PilotSetupChecklist() {
  return (
    <ResourceFrame>
      <ResourceHero
        kicker="Founding pilot checklist"
        title="Booking & Lead Recovery Pilot Setup Checklist"
        copy="Use this checklist before routing real calls and inbound leads. Define coverage, lead sources, booking questions, alerts, recovery fields, and human decisions before launch."
        icon={ClipboardCheck}
        aside={<PilotRouteCard />}
      />

      <section className="healthcare-section pt-0">
        <div className="container relative z-10 px-4 md:px-6">
          <div className="ops-card overflow-hidden rounded-[2rem] p-5 md:p-7">
            <div className="grid gap-4 md:grid-cols-2">
              {checklist.map(([title, copy], index) => (
                <motion.div
                  key={title}
                  initial={{ opacity: 0, y: 20 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true, margin: "-70px" }}
                  transition={{ delay: index * 0.035 }}
                  className="rounded-2xl border border-slate-900/8 bg-white/78 p-5"
                >
                  <div className="flex gap-4">
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-teal-50 text-teal-700">
                      <CheckCircle2 className="h-5 w-5" />
                    </div>
                    <div>
                      <p className="text-xs font-black uppercase tracking-[0.2em] text-slate-500">
                        Item {String(index + 1).padStart(2, "0")}
                      </p>
                      <h2 className="mt-2 text-xl font-black tracking-tight text-slate-950">{title}</h2>
                      <p className="mt-3 text-sm font-medium leading-relaxed text-slate-600">{copy}</p>
                    </div>
                  </div>
                </motion.div>
              ))}
            </div>
          </div>
        </div>
      </section>
    </ResourceFrame>
  )
}

function PilotRouteCard() {
  return (
    <div className="ops-card relative overflow-hidden rounded-[2rem] p-6">
      <div className="pointer-events-none absolute inset-x-0 top-0 h-2 bg-gradient-to-r from-slate-950 via-sky-700 to-teal-600" />
      <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-950 text-white shadow-lg">
        <Route className="h-5 w-5 text-teal-200" />
      </div>
      <p className="mt-6 text-xs font-black uppercase tracking-[0.22em] text-slate-600">
        Pilot principle
      </p>
      <p className="mt-4 text-sm font-semibold leading-relaxed text-slate-600">
        Start with one approved booking workflow, test every route, review edge cases at day seven,
        then expand only when the team trusts the system.
      </p>
    </div>
  )
}
