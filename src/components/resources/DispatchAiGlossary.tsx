"use client"

import { motion } from "framer-motion"
import { BookOpenText, Search } from "lucide-react"
import { ResourceFrame } from "./ResourceFrame"
import { ResourceHero } from "./ResourceHero"

const terms = [
  ["Missed call recovery", "Answering or following up fast enough to turn a voicemail-bound water lead into a booked next step."],
  ["Water test booking", "Moving a homeowner's water concern, source, system interest, timeline, address, and callback toward a booked water test or sales callback."],
  ["No-water urgent route", "A scoped workflow for routing urgent no-water context to the approved owner, dispatcher, or on-call technician."],
  ["Quote form follow-up", "Prompt follow-up on an inbound website quote request while the customer is still actively looking for help."],
  ["Outbound speed-to-lead", "Fast follow-up for inbound website forms, Google/Facebook leads, paid leads, quote requests, or old inquiries, not cold calling."],
  ["Booking route", "A clear next-step path that gives the owner, CSR, dispatcher, or on-call technician enough context to act without starting cold."],
  ["Urgency routing", "Flagging approved urgent language and sending the route to the configured human escalation path."],
  ["Human-in-the-loop", "A workflow where people remain responsible for repair decisions, quotes, ETAs, follow-up, and customer promises."],
  ["Call recording", "An audio record available for quality and opportunity review where recording is configured and permitted."],
  ["Recovered job opportunity", "A missed call or inbound lead Finnor helps move back into a booked appointment, service call, or human-owned next step."],
  ["CRM/webhook route", "Sending booking or urgency context into a CRM, workflow tool, or endpoint approved by the company."],
  ["Recovery view", "An account-specific view of calls, recordings, booked next steps, and recovered opportunities for review."],
]

export function DispatchAiGlossary() {
  return (
    <ResourceFrame>
      <ResourceHero
        kicker="Operator glossary"
        title="Water booking and lead recovery terms without the jargon."
        copy="Short definitions for water treatment, water dealer, and well pump teams evaluating missed-call recovery, form follow-up, booking routes, and urgency routing."
        icon={BookOpenText}
        aside={<GlossaryIndex />}
      />
      <section className="healthcare-section pt-0">
        <div className="container relative z-10 px-4 md:px-6">
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {terms.map(([term, definition], index) => (
              <motion.div
                key={term}
                initial={{ opacity: 0, y: 22 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, margin: "-70px" }}
                transition={{ delay: index * 0.025 }}
                className="ops-card ops-card-hover rounded-2xl p-6"
                data-cursor="hover"
              >
                <p className="text-xs font-black uppercase tracking-[0.2em] text-slate-500">
                  {String(index + 1).padStart(2, "0")}
                </p>
                <h2 className="mt-3 text-2xl font-black tracking-tight text-slate-950">{term}</h2>
                <p className="mt-4 text-sm font-medium leading-relaxed text-slate-600">{definition}</p>
              </motion.div>
            ))}
          </div>
        </div>
      </section>
    </ResourceFrame>
  )
}

function GlossaryIndex() {
  return (
    <div className="ops-card relative overflow-hidden rounded-[2rem] p-6">
      <div className="pointer-events-none absolute inset-x-0 top-0 h-2 bg-gradient-to-r from-slate-950 via-sky-700 to-teal-600" />
      <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-950 text-white shadow-lg">
        <Search className="h-5 w-5 text-teal-200" />
      </div>
      <p className="mt-6 text-xs font-black uppercase tracking-[0.22em] text-slate-600">
        Built for operators
      </p>
      <p className="mt-4 text-sm font-semibold leading-relaxed text-slate-600">
        These definitions keep the focus on booked next steps, faster lead response, approved
        escalation, and human-owned quotes, dispatch, repair decisions, and promises.
      </p>
    </div>
  )
}
