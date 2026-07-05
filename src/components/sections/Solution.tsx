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
    title: "Every Call Answered",
    copy: "Ring two, after hours, overflow, weekends. The intake is captured, and a household memory record opens on the spot.",
  },
  {
    icon: Radar,
    title: "Live Water Data Pull",
    copy: "Measured well samples within 25 miles from USGS plus your local system's EPA record, pulled by ZIP while the caller is still on the line.",
  },
  {
    icon: BarChart3,
    title: "Sizing Math, Shown",
    copy: "Compensated hardness, grains per day, the capacity ladder. The worksheet is visible line by line, not hidden behind a shrug.",
  },
  {
    icon: FileText,
    title: "Quote Range on the Call",
    copy: "Computed from your pricing tier and the actual water. Never invented, never discounted on a whim. The final figure stays with your team.",
  },
  {
    icon: MessagesSquare,
    title: "Text-Back in 60 Seconds",
    copy: "The water report, the numbers, and three booking slots land by SMS before the homeowner finishes googling your competitor.",
  },
  {
    icon: ClipboardList,
    title: "Booked and Confirmed",
    copy: "Tap-to-book slots, confirmation in-thread, reminder at T-24h. The appointment goes on the record, not on a sticky note.",
  },
  {
    icon: PhoneIncoming,
    title: "Well Pump Emergency Routing",
    copy: "No-water and pump-failure language routes straight to on-call with scope, since-when, people affected, and a safety screen attached.",
  },
  {
    icon: BookOpenCheck,
    title: "Job Documentation",
    copy: "Serials, install photos, before-and-after water numbers, and an itemized invoice that matches the quote. Disputes die here.",
  },
  {
    icon: BellRing,
    title: "The Right Review Ask",
    copy: "One ask, 24 hours after install, referencing the actual fix. Not a drip campaign. That is why it converts.",
  },
  {
    icon: Route,
    title: "Cadence That Fires Itself",
    copy: "Salt check-ins at month 3, 6, 9. Filter media clocks. Annual re-tests. Nobody at the shop has to remember, because nothing has to.",
  },
  {
    icon: GitBranch,
    title: "Referral Attribution",
    copy: "When the neighbor calls and says Jennifer sent them, the record logs which review produced which install. Most shops never know.",
  },
  {
    icon: Rocket,
    title: "The Right Upsell Moment",
    copy: "Media near capacity, a changed water report, usage trending up. Offers fire when the data says so, priced with the system discount.",
  },
  {
    icon: LayoutDashboard,
    title: "Household Memory Records",
    copy: "One record per customer: water profile, quotes, jobs, plan, reviews, referrals, LTV, and the computed next revenue action.",
  },
  {
    icon: PhoneForwarded,
    title: "Speed-to-Lead Outbound",
    copy: "Website forms, Google and Facebook leads, and quote requests get called back in under a minute, while intent is still hot.",
  },
  {
    icon: Mic2,
    title: "Transcripts and Recordings",
    copy: "Every call structured, transcribed, and reviewable. The handoff your team gets is a record, not a rumor.",
  },
  {
    icon: ShieldCheck,
    title: "Hard Rails",
    copy: "No invented prices, no diagnosis, no ETAs, no health claims. The agent quotes ranges from your numbers; humans own every final call.",
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
            The full lifecycle, A to Z
          </motion.div>
          <motion.h2
            initial={{ opacity: 0, y: 18 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            className="text-4xl font-black tracking-tight text-slate-950 md:text-6xl"
          >
            One memory runs the whole customer lifecycle.
          </motion.h2>
          <motion.p
            initial={{ opacity: 0, y: 16 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ delay: 0.08 }}
            className="mx-auto mt-6 max-w-2xl text-lg font-medium leading-relaxed text-slate-600"
          >
            Answer, pull the real water data, size it, quote it at your prices, book it, document
            it, ask for the review, check in on schedule, log the referral, and know what to offer
            next. Sixteen capabilities, one record, years deep.
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
          Any one of these is a commodity you can rent for $99 a month. The moat is that one
          continuous memory carries all of them, for every household, for years. Nothing else in
          this market does that.
        </p>
      </div>
    </section>
  )
}
