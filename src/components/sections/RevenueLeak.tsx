"use client"

import { motion } from "framer-motion"
import { ArrowRight, FileX, History, Shuffle, UserRoundX } from "lucide-react"

const problemCards = [
  {
    icon: History,
    title: "Every call starts from zero",
    copy: "Nobody remembers the water test from two years ago, the softener that's due for salt, or why this quote is different from the last one. The history exists somewhere. It's just never where you need it.",
  },
  {
    icon: FileX,
    title: "Nobody can say why",
    copy: "A price was given, a job was booked, an invoice went out, and if a customer asks why, there's no record of what was actually approved, or by whom. Just someone's memory of a phone call.",
  },
  {
    icon: Shuffle,
    title: "The price depends on who answered",
    copy: "Two reps, two different numbers, same softener. Not because anyone's dishonest, because nothing ties a quote to your actual price book. Homeowners now bring their own water tests because dealer numbers stopped holding up.",
  },
  {
    icon: UserRoundX,
    title: "The work ends at the invoice",
    copy: "No review ask, no salt check-in, no re-test reminder, no referral capture. They buy salt at the hardware store and their neighbor calls someone else.",
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
              The leak is bigger than the missed call
            </motion.div>
            <motion.h2
              initial={{ opacity: 0, y: 18 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ delay: 0.05 }}
              className="text-4xl font-black tracking-tight text-slate-950 md:text-6xl"
            >
              A missed call is the cheapest mistake your business makes.
            </motion.h2>
          </div>
          <motion.p
            initial={{ opacity: 0, y: 18 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ delay: 0.1 }}
            className="max-w-2xl text-lg font-medium leading-relaxed text-slate-600 md:text-xl"
          >
            The expensive ones happen after you pick up. Every quote your team gives, every job
            you schedule, every price you promise, if none of it is written down the same way
            twice, you&apos;re not running a business, you&apos;re running on memory. JARVIS
            keeps the record: what was quoted, what was approved, what happened next.
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
              title="The memoryless path"
              label="Same decision, no record"
              items={["Quote given, never logged", "Price drifted rep to rep", "Invoice sent, no approval trail", "Never followed up"]}
            />
            <div className="hidden items-center justify-center px-2 lg:flex">
              <ArrowRight className="h-6 w-6 text-slate-500" />
            </div>
            <BeforeAfterPanel
              tone="safe"
              title="The JARVIS record"
              label="One record, every time"
              items={["Quote drafted from your price book", "Held for your approval", "Every action has a receipt", "Follow-up scheduled automatically"]}
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
            Receipt filed
          </span>
        ) : (
          <span className="rounded-full bg-orange-100 px-3 py-1.5 text-xs font-black text-orange-800">
            No record
          </span>
        )}
      </div>
      <div className="space-y-3">
        {items.map((item, index) => (
          <div key={item} className="flex items-center gap-3 rounded-2xl border border-slate-900/8 bg-white/78 p-4">
            <span
              className={`h-2.5 w-2.5 shrink-0 rounded-full ${safe ? "bg-teal-600" : "bg-orange-500"}`}
              aria-hidden
            />
            <span className="text-sm font-black text-slate-700">{item}</span>
            <span className="ml-auto text-xs font-black text-slate-500">0{index + 1}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
