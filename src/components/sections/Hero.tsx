"use client"

import { useEffect, useState } from "react"
import { motion } from "framer-motion"
import {
  BellRing,
  CalendarDays,
  CheckCircle2,
  Clock3,
  FileText,
  PhoneCall,
  Play,
  ShieldCheck,
  UserRoundCheck,
  Waves,
} from "lucide-react"
import type { LucideIcon } from "lucide-react"
import { siteConfig } from "@/config/site"
import { Magnetic } from "@/components/ui/magnetic"

const navItems = [
  { href: "#problem", label: "Problem" },
  { href: "#workflow", label: "Workflow" },
  { href: "/resources", label: "Resources" },
  { href: "/trust-safety", label: "Trust" },
  { href: "#pricing", label: "Pricing" },
  { href: "#faq", label: "FAQ" },
]

const callStates = ["Ringing", "Answered", "Water data pulled", "Quoted + booked"]

const intakeRows = [
  ["Caller", "Jennifer"],
  ["Location", "142 Millbrook Rd - Harrisonburg VA"],
  ["Concern", "Sulfur smell and hard water"],
  ["Area water", "14.3 gpg, 51 well samples (USGS)"],
  ["Sized system", "40k softener + sulfur filter"],
  ["Quote range", "$3,800-$4,250 installed"],
  ["Status", "Booked Thu 10:00 AM, record open"],
]

const workflowStateItems: Array<{ icon: LucideIcon; label: string }> = [
  { icon: Waves, label: "Answered ring two" },
  { icon: CheckCircle2, label: "Water data pulled" },
  { icon: ShieldCheck, label: "Quoted from your pricing" },
  { icon: BellRing, label: "Booked by text" },
]

const miniStatusItems: Array<{ icon: LucideIcon; label: string }> = [
  { icon: PhoneCall, label: "Call answered" },
  { icon: CheckCircle2, label: "Quote delivered" },
  { icon: BellRing, label: "Record opened" },
]

const signalSteps = ["Incoming call", "Live water data", "Sized quote", "Booked + remembered"]

export function Hero() {
  const [scrolled, setScrolled] = useState(false)
  const [activeState, setActiveState] = useState(0)

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 16)
    onScroll()
    window.addEventListener("scroll", onScroll, { passive: true })
    return () => window.removeEventListener("scroll", onScroll)
  }, [])

  useEffect(() => {
    const timer = window.setInterval(() => {
      setActiveState((current) => (current + 1) % callStates.length)
    }, 1550)
    return () => window.clearInterval(timer)
  }, [])

  return (
    <section className="relative min-h-screen overflow-hidden px-0 pb-16 pt-24 md:pt-28">
      <div className="absolute inset-0 operational-grid opacity-45" />
      <div className="absolute inset-x-0 top-0 h-40 bg-gradient-to-b from-white via-white/80 to-transparent" />
      <div className="absolute left-[-16rem] top-[-12rem] h-[34rem] w-[34rem] rounded-full bg-sky-200/35 blur-3xl" />
      <div className="absolute right-[-13rem] top-16 h-[32rem] w-[32rem] rounded-full bg-teal-100/38 blur-3xl" />
      <div className="absolute inset-x-0 bottom-0 h-48 bg-gradient-to-t from-[#f8faf9] to-transparent" />

      <motion.nav
        initial={false}
        className={`fixed left-0 right-0 top-0 z-50 transition-all duration-300 ${
          scrolled
            ? "border-b border-slate-900/10 bg-white/88 shadow-[0_12px_42px_rgba(15,38,62,0.08)] backdrop-blur-xl"
            : "border-b border-transparent bg-transparent"
        }`}
      >
        <div className="container flex h-20 items-center justify-between px-4 md:px-6">
          <a href="/" className="flex items-center gap-3 text-xl font-black tracking-tight text-slate-950">
            <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-slate-950 text-xs font-black text-white shadow-lg">
              F
            </span>
            {siteConfig.name}
          </a>
          <div className="hidden items-center gap-5 lg:gap-8 md:flex">
            {navItems.map((item) => (
              <a
                key={item.href}
                href={item.href}
                className="text-xs font-black uppercase tracking-[0.18em] text-slate-600 transition hover:text-slate-950"
              >
                {item.label}
              </a>
            ))}
          </div>
          <div className="flex items-center gap-2">
            <a
              href="#demo-builder"
              className="cta-secondary hidden h-11 items-center justify-center rounded-full border border-slate-900/12 bg-white px-4 text-xs font-black text-slate-800 transition hover:-translate-y-0.5 hover:border-slate-900/22 md:inline-flex"
            >
              Explore Live Demos
            </a>
            <a
              href={siteConfig.calendlyLink}
              target="_blank"
              rel="noopener noreferrer"
              className="cta-primary inline-flex h-11 shrink-0 items-center justify-center rounded-full bg-slate-950 px-3 text-[10px] font-black text-white transition hover:-translate-y-0.5 hover:bg-slate-800 sm:px-5 sm:text-xs"
            >
              <span className="sm:hidden">Apply</span>
              <span className="hidden sm:inline">Apply for Founding Pilot</span>
            </a>
          </div>
        </div>
      </motion.nav>

      <div className="container relative z-10 px-4 md:px-6">
        <div className="grid items-center gap-12 lg:min-h-[calc(100vh-7rem)] lg:grid-cols-[0.94fr_1.06fr] lg:gap-14">
          <div className="max-w-3xl">
            <motion.div
              initial={{ opacity: 0, y: 14 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.55 }}
              className="mb-6 inline-flex max-w-full items-center rounded-full border border-sky-900/10 bg-white px-4 py-2 text-sm font-bold leading-snug text-slate-700 shadow-sm"
            >
              <span className="mr-2 h-2 w-2 rounded-full bg-teal-500 shadow-[0_0_0_4px_rgba(20,184,166,0.12)]" />
              The AI quoting agent for water companies
            </motion.div>

            <motion.h1
              initial={{ opacity: 0, y: 18 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.7, ease: [0.16, 1, 0.3, 1] }}
              className="max-w-[22rem] break-words text-[2.18rem] font-black leading-[0.99] tracking-tight text-slate-950 sm:max-w-4xl sm:text-6xl md:text-7xl lg:text-[5.75rem]"
            >
              The AI quoting agent that remembers every customer for years.
            </motion.h1>

            <motion.p
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.1, duration: 0.62 }}
              className="mt-7 max-w-[22rem] text-base font-semibold leading-relaxed text-slate-700 sm:max-w-2xl sm:text-lg md:text-xl"
            >
              FINNOR answers the calls you miss, pulls the real water data for the caller&apos;s
              ZIP, sizes the system with math, quotes from your pricing, and books the visit by
              text. Then it remembers the household for two years of reviews, check-ins,
              referrals, and upsells.
            </motion.p>

            <motion.p
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.18, duration: 0.55 }}
              className="mt-5 flex w-full max-w-full rounded-2xl border border-teal-800/14 bg-white px-4 py-3 text-sm font-black leading-relaxed text-slate-700 shadow-sm"
            >
              Every lead becomes a household memory record. Every record carries a next revenue
              action. Every action is tracked to lifetime value. Water treatment and well pump
              companies only.
            </motion.p>

            <motion.div
              initial={{ opacity: 0, y: 14 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.25, duration: 0.58 }}
              className="mt-8 flex flex-col gap-3 sm:flex-row"
            >
              <Magnetic strength={0.16}>
                <a
                  href={siteConfig.calendlyLink}
                  target="_blank"
                  rel="noopener noreferrer"
                  data-cursor="hover"
                  className="cta-primary inline-flex min-h-[3.75rem] items-center justify-center gap-2 rounded-full bg-slate-950 px-8 py-4 text-sm font-black text-white transition hover:-translate-y-0.5 hover:bg-slate-800"
                >
                  <CalendarDays className="h-4 w-4" />
                  Apply for Founding Pilot
                </a>
              </Magnetic>
              <Magnetic strength={0.14}>
                <a
                  href="#demo-builder"
                  data-cursor="hover"
                  className="cta-secondary inline-flex min-h-[3.75rem] items-center justify-center gap-2 rounded-full border border-slate-900/14 bg-white px-8 py-4 text-sm font-black text-slate-900 transition hover:-translate-y-0.5 hover:border-slate-900/24"
                >
                  <Play className="h-4 w-4 fill-slate-800" />
                  Explore Both Live Demos
                </a>
              </Magnetic>
            </motion.div>

            <SignalHandoffStrip />
          </div>

          <motion.div
            initial={{ opacity: 0, y: 24, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            transition={{ delay: 0.18, duration: 0.78, ease: [0.16, 1, 0.3, 1] }}
            className="relative"
          >
            <DispatchCommandVisual activeState={activeState} />
          </motion.div>
        </div>
      </div>

      <MiniStatusBar visible={scrolled} />
    </section>
  )
}

function DispatchCommandVisual({ activeState }: { activeState: number }) {
  return (
    <div className="relative mx-auto max-w-[720px]">
      <div className="absolute -inset-6 rounded-[2.25rem] bg-gradient-to-br from-sky-200/52 via-white/40 to-teal-100/45 blur-2xl" />
      <div className="relative overflow-hidden rounded-[2rem] border border-slate-900 bg-slate-950 p-4 text-white shadow-[0_34px_110px_rgba(8,24,39,0.34)] md:p-5">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_22%_0%,rgba(125,211,252,0.22),transparent_34%),linear-gradient(135deg,rgba(45,212,191,0.11),transparent_46%)]" />
        <div className="absolute inset-0 command-grid opacity-50" />
        <div className="relative">
          <div className="flex flex-wrap items-start justify-between gap-4 border-b border-white/10 pb-4">
            <div>
              <p className="text-xs font-black uppercase tracking-[0.22em] text-sky-100">
                Finnor booking console
              </p>
              <h2 className="mt-2 text-2xl font-black tracking-tight">Quote, book, remember</h2>
            </div>
            <span className="inline-flex items-center rounded-full border border-teal-300/30 bg-teal-300/16 px-3 py-1.5 text-xs font-black text-teal-100">
              <span className="mr-2 h-2 w-2 animate-pulse rounded-full bg-teal-300" />
              {callStates[activeState]}
            </span>
          </div>

          <div className="signal-thread my-4 flex min-h-12 flex-wrap items-center justify-start gap-2 rounded-2xl border border-white/10 bg-white/[0.035] px-4 py-2 md:justify-between">
            {signalSteps.map((step, index) => (
              <span
                key={step}
                className={`relative z-10 rounded-full border px-3 py-1 text-[10px] font-black uppercase tracking-widest ${
                  index <= activeState
                    ? "border-teal-200/35 bg-teal-200/15 text-teal-50"
                    : "border-white/10 bg-slate-950 text-slate-300"
                }`}
              >
                {step}
              </span>
            ))}
          </div>

          <div className="grid gap-4 py-4 md:grid-cols-[0.86fr_1.14fr]">
            <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <span className="relative flex h-12 w-12 items-center justify-center rounded-2xl bg-sky-300/12">
                    <span className="absolute inset-0 animate-ping rounded-2xl border border-sky-200/20" />
                    <PhoneCall className="relative h-5 w-5 text-sky-100" />
                  </span>
                  <div>
                    <p className="font-black">Incoming water treatment inquiry</p>
                    <p className="text-sm font-semibold text-slate-300">Inbound water treatment call</p>
                  </div>
                </div>
              </div>
              <div className="mt-5 rounded-2xl border border-white/10 bg-black/20 p-4">
                <div className="mb-3 flex items-center justify-between text-xs font-black uppercase tracking-widest text-slate-300">
                  <span>Voice signal</span>
                  <span>Live</span>
                </div>
                <HeroWaveform />
              </div>
              <div className="mt-4 rounded-2xl border border-orange-200/20 bg-orange-200/10 p-4">
                <p className="text-xs font-black uppercase tracking-widest text-orange-100">
                  Booking opportunity
                </p>
                <p className="mt-2 text-sm font-semibold leading-relaxed text-slate-200">
                  Well water. Sulfur smell and hard water. Interested in a softener and
                  whole-house filtration. Ready to book a water test.
                </p>
              </div>
            </div>

            <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-4">
              <div className="mb-4 flex items-center justify-between gap-3">
                <div>
                  <p className="text-xs font-black uppercase tracking-[0.2em] text-slate-300">
                    Booking context
                  </p>
                  <h3 className="mt-1 text-xl font-black">Next step ready</h3>
                </div>
                <FileText className="h-5 w-5 text-sky-100" />
              </div>
              <div className="space-y-2">
                {intakeRows.map(([label, value], index) => (
                  <motion.div
                    key={label}
                    initial={false}
                    animate={{
                      opacity: index <= activeState + 3 ? 1 : 0.72,
                      y: 0,
                    }}
                    className="grid gap-1 rounded-xl border border-white/10 bg-black/20 p-3 sm:grid-cols-[132px_1fr]"
                  >
                    <span className="text-[10px] font-black uppercase tracking-widest text-slate-300">
                      {label}
                    </span>
                    <span className="text-sm font-bold text-white">{value}</span>
                  </motion.div>
                ))}
              </div>
            </div>
          </div>

          <div className="grid gap-4 border-t border-white/10 pt-4 md:grid-cols-[1fr_0.92fr]">
            <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-4">
              <p className="mb-4 text-xs font-black uppercase tracking-[0.22em] text-slate-300">
                Workflow state
              </p>
              <div className="grid grid-cols-2 gap-3">
                {workflowStateItems.map(({ icon: Icon, label }, index) => (
                  <div
                    key={label}
                    className={`rounded-2xl border p-3 transition ${
                      index <= activeState
                        ? "border-teal-300/30 bg-teal-300/16 text-teal-50"
                        : "border-white/10 bg-black/24 text-slate-400"
                    }`}
                  >
                    <Icon className="mb-3 h-4 w-4" />
                    <p className="text-xs font-black uppercase tracking-widest">{label}</p>
                  </div>
                ))}
              </div>
            </div>

            <div className="rounded-2xl border border-teal-300/20 bg-teal-300/10 p-4">
              <div className="mb-4 flex items-center justify-between">
                <p className="text-xs font-black uppercase tracking-[0.2em] text-teal-100">
                  Water treatment booking route
                </p>
                <span className="status-pulse rounded-full bg-teal-200 px-3 py-1 text-[10px] font-black uppercase tracking-widest text-slate-950">
                  Sent
                </span>
              </div>
              <p className="text-sm font-semibold leading-relaxed text-white">
                Water treatment lead recovered. Homeowner is on well water and reports sulfur smell
                plus hard water. Interested in softener and whole-house filtration options.
                Address and callback confirmed. Ready to book a water test.
              </p>
              <div className="mt-4 flex items-center gap-3 rounded-xl border border-white/10 bg-black/18 p-3">
                <UserRoundCheck className="h-5 w-5 text-teal-100" />
                <span className="text-sm font-black text-white">Human team stays in control</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

function SignalHandoffStrip() {
  return (
    <motion.div
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.34, duration: 0.58 }}
      className="mt-8 max-w-full rounded-[1.5rem] border border-slate-900/10 bg-white/92 p-4 shadow-[0_18px_42px_rgba(15,38,62,0.08)] md:max-w-2xl"
    >
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2 text-xs font-black uppercase tracking-[0.2em] text-slate-600">
        <span>Lead signal to booking route</span>
        <span className="text-teal-700">Live recovery path</span>
      </div>
      <div className="signal-thread flex min-h-12 flex-wrap items-center justify-start gap-2 rounded-2xl bg-slate-50 px-3 py-2 md:justify-between">
        {signalSteps.map((step) => (
          <span
            key={step}
            className="relative z-10 rounded-full border border-slate-200 bg-white px-3 py-1.5 text-[10px] font-black uppercase tracking-widest text-slate-700 shadow-sm"
          >
            {step}
          </span>
        ))}
      </div>
    </motion.div>
  )
}

function HeroWaveform() {
  return (
    <div className="flex h-16 items-end justify-center gap-1.5">
      {Array.from({ length: 22 }).map((_, index) => (
        <motion.span
          key={index}
          animate={{ scaleY: [0.35, 0.9 - (index % 5) * 0.08, 0.45] }}
          transition={{ duration: 0.85, repeat: Infinity, delay: index * 0.025 }}
          className="h-12 w-1.5 origin-bottom rounded-full bg-gradient-to-t from-teal-300/30 via-sky-200/80 to-white"
        />
      ))}
    </div>
  )
}

function MiniStatusBar({ visible }: { visible: boolean }) {
  return (
    <div
      className={`pointer-events-none fixed bottom-5 left-1/2 z-40 hidden -translate-x-1/2 transition duration-300 lg:block ${
        visible ? "translate-y-0 opacity-100" : "translate-y-4 opacity-0"
      }`}
    >
      <div className="flex items-center gap-2 rounded-full border border-slate-900/10 bg-white/82 p-2 shadow-[0_18px_48px_rgba(31,57,86,0.14)] backdrop-blur-xl">
        {miniStatusItems.map(({ icon: Icon, label }) => (
          <span
            key={label}
            className="inline-flex items-center gap-2 rounded-full bg-slate-950 px-4 py-2 text-xs font-black text-white"
          >
            <Icon className="h-3.5 w-3.5 text-teal-200" />
            {label}
          </span>
        ))}
      </div>
    </div>
  )
}
