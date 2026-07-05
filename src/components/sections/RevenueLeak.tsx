"use client"

import { motion } from "framer-motion"
import { ArrowRight, BellRing, PhoneOff, Search, TimerReset, UserRoundX } from "lucide-react"

const problemCards = [
  {
    icon: PhoneOff,
    title: "Homeowner reaches voicemail",
    copy: "A water softener quote request, filtration inquiry, water quality concern, or urgent service call reaches voicemail with no response.",
  },
  {
    icon: Search,
    title: "The lead keeps looking",
    copy: "The homeowner still needs answers about treatment options, an existing system issue, or a no-water emergency.",
  },
  {
    icon: UserRoundX,
    title: "Competitor answers first",
    copy: "The water company that responds first is more likely to win the quote request or urgent service call.",
  },
  {
    icon: TimerReset,
    title: "Your team finds out too late",
    copy: "By the time someone checks voicemail, the homeowner may have already booked a competitor who responded faster.",
  },
]

export function RevenueLeak() {
  return (
    <section id="problem" className="healthcare-section">
      <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-slate-300 to-transparent" />
      <div className="container relative z-10 px-4 md:px-6">
        <div className="grid gap-10 lg:grid-cols-[0.88fr_1.12fr] lg:items-end">
          <div>
            <motion.div
              initial={{ opacity: 0, y: 16 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              className="mb-5 inline-flex rounded-full border border-orange-200 bg-orange-50 px-4 py-2 text-xs font-black uppercase tracking-[0.18em] text-orange-700"
            >
              Lost booking risk
            </motion.div>
            <motion.h2
              initial={{ opacity: 0, y: 18 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ delay: 0.05 }}
              className="text-4xl font-black tracking-tight text-slate-950 md:text-6xl"
            >
              Every unanswered water lead can become someone else&apos;s booked job.
            </motion.h2>
          </div>
          <motion.p
            initial={{ opacity: 0, y: 18 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ delay: 0.1 }}
            className="max-w-2xl text-lg font-medium leading-relaxed text-slate-600 md:text-xl"
          >
            A homeowner may call about a softener quote, filtration quote, water quality concern,
            existing system issue, or no-water emergency. If no one responds fast, they keep
            looking until another water business books the appointment.
          </motion.p>
        </div>

        <div className="mt-12 grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          {problemCards.map((card, index) => (
            <motion.div
              key={card.title}
              initial={{ opacity: 0, y: 22 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: "-70px" }}
              transition={{ delay: index * 0.06 }}
              className="ops-card ops-card-hover rounded-2xl p-6"
              data-cursor="hover"
            >
              <div className="mb-8 flex h-12 w-12 items-center justify-center rounded-2xl bg-orange-50 text-orange-700">
                <card.icon className="h-5 w-5" />
              </div>
              <p className="text-xs font-black uppercase tracking-[0.2em] text-slate-600">
                0{index + 1}
              </p>
              <h3 className="mt-3 text-xl font-black tracking-tight text-slate-950">{card.title}</h3>
              <p className="mt-4 text-sm font-medium leading-relaxed text-slate-600">{card.copy}</p>
            </motion.div>
          ))}
        </div>

        <motion.div
          initial={{ opacity: 0, y: 22 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: "-80px" }}
          className="ops-card mt-8 overflow-hidden rounded-[2rem] p-4 md:p-6"
        >
          <div className="grid gap-4 lg:grid-cols-[1fr_auto_1fr] lg:items-stretch">
            <BeforeAfterPanel
              tone="risk"
              title="Voicemail gap"
              label="Unanswered path"
              items={["Job lost risk", "Caller waits", "Quote goes cold", "Follow-up starts late"]}
            />
            <div className="hidden items-center justify-center px-2 lg:flex">
              <ArrowRight className="h-6 w-6 text-slate-500" />
            </div>
            <BeforeAfterPanel
              tone="safe"
              title="Finnor recovery path"
              label="Booking path"
              items={["Call answered", "Booking intent found", "Team route sent", "Job recovered"]}
            />
          </div>
        </motion.div>
      </div>
    </section>
  )
}

function BeforeAfterPanel({
  tone,
  title,
  label,
  items,
}: {
  tone: "risk" | "safe"
  title: string
  label: string
  items: string[]
}) {
  const safe = tone === "safe"
  return (
    <div
      className={`rounded-[1.5rem] border p-6 ${
        safe
          ? "border-teal-200 bg-gradient-to-br from-teal-50 to-white"
          : "border-orange-200 bg-gradient-to-br from-orange-50 to-white"
      }`}
    >
      <div className="mb-6 flex items-center justify-between gap-4">
        <div>
          <p className={`text-xs font-black uppercase tracking-[0.2em] ${safe ? "text-teal-700" : "text-orange-700"}`}>
            {label}
          </p>
          <h3 className="mt-2 text-2xl font-black tracking-tight text-slate-950">{title}</h3>
        </div>
        {safe ? (
          <span className="status-pulse rounded-full bg-teal-600 px-3 py-1.5 text-xs font-black text-white">
            Route sent
          </span>
        ) : (
          <span className="rounded-full bg-orange-100 px-3 py-1.5 text-xs font-black text-orange-800">
            Caller cold
          </span>
        )}
      </div>
      <div className="space-y-3">
        {items.map((item, index) => (
          <div key={item} className="flex items-center gap-3 rounded-2xl border border-slate-900/8 bg-white/78 p-4">
            {safe ? (
              <BellRing className="h-4 w-4 text-teal-600" />
            ) : (
              <PhoneOff className="h-4 w-4 text-orange-600" />
            )}
            <span className="text-sm font-black text-slate-700">{item}</span>
            <span className="ml-auto text-xs font-black text-slate-500">0{index + 1}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
