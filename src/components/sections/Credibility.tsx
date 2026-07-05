"use client"

import { BellRing, Building2, Clock, PhoneForwarded, Route, ShieldCheck, UserCheck, Zap } from "lucide-react"
import { Marquee } from "@/components/ui/marquee"

const rowOne = [
  { icon: Building2, text: "Built for Well Pump Service" },
  { icon: PhoneForwarded, text: "After-Hours Intake" },
  { icon: UserCheck, text: "Human Handoff" },
  { icon: Route, text: "Urgency Routing" },
  { icon: Zap, text: "Deploys in Days" },
  { icon: BellRing, text: "Dispatch Alerts" },
]

const rowTwo = [
  { icon: Clock, text: "Overflow Coverage" },
  { icon: ShieldCheck, text: "Compliance-Aware Workflow Boundaries" },
  { icon: PhoneForwarded, text: "Call Forwarding Ready" },
  { icon: UserCheck, text: "Dispatch Team Stays in Control" },
  { icon: BellRing, text: "Structured Alert Path" },
  { icon: Zap, text: "Workflow Review" },
]

export function Credibility() {
  return (
    <section className="relative z-20 w-full overflow-hidden border-y border-white/10 bg-black/62 py-6 backdrop-blur-sm">
      <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-cyan-100/40 to-transparent" />
      <div className="mask-fade-sides space-y-3">
        <Marquee duration={38}>
          {rowOne.map((item) => (
            <MarqueeItem key={item.text} item={item} />
          ))}
        </Marquee>
        <Marquee duration={46} reverse>
          {rowTwo.map((item) => (
            <MarqueeItem key={item.text} item={item} muted />
          ))}
        </Marquee>
      </div>
    </section>
  )
}

function MarqueeItem({
  item,
  muted = false,
}: {
  item: (typeof rowOne)[number]
  muted?: boolean
}) {
  return (
    <div
      className={`flex cursor-default items-center gap-3 whitespace-nowrap transition-colors ${
        muted ? "text-white/42 hover:text-white/78" : "text-white/62 hover:text-white"
      }`}
    >
      <item.icon className="h-5 w-5 shrink-0 text-cyan-50/80" />
      <span className="text-sm font-black uppercase tracking-[0.24em] md:text-base">
        {item.text}
      </span>
      <span className="ml-12 inline-block h-1 w-1 rounded-full bg-white/25" />
    </div>
  )
}
