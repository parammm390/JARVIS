"use client"

import { motion } from "framer-motion"
import { AlertTriangle, Clock, PhoneMissed, Radio, UsersRound } from "lucide-react"
import { TiltCard } from "@/components/ui/tilt-card"

const useCases = [
  {
    title: "After-Hours No-Water Calls",
    description:
      "When your dispatch staff is unavailable, FINNOR clarifies the urgent issue, answers approved process questions, and routes the job to the right human.",
    icon: Clock,
    meta: "Nights + weekends",
  },
  {
    title: "Urgent Language Route",
    description:
      "Urgent or danger language routes to the designated human path. The AI does not provide operational guidance or make crisis decisions.",
    icon: AlertTriangle,
    meta: "Human escalation",
    urgent: true,
  },
  {
    title: "Missed-Call Recovery",
    description:
      "Can support approved follow-up workflows when a caller disconnects, while keeping sensitive situations routed to a human.",
    icon: PhoneMissed,
    meta: "Approved recovery path",
  },
  {
    title: "Peak Inquiry Overflow",
    description:
      "Acts as a tier-one buffer during holiday surges or high-volume periods so human technicians receive structured context.",
    icon: UsersRound,
    meta: "Overflow buffer",
  },
]

export function UseCases() {
  return (
    <section className="relative overflow-hidden border-y border-white/5 py-24 md:py-32">
      <div className="absolute left-[20%] top-[10%] h-[400px] w-[400px] rounded-full bg-white/[0.04] blur-[120px]" />

      <div className="container relative z-10 px-4 md:px-6">
        <div className="mb-16 max-w-3xl md:mb-20">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            className="mb-6 inline-flex items-center rounded-full border border-white/10 bg-white/5 px-4 py-1.5 text-xs font-black uppercase tracking-widest text-white/70 backdrop-blur-md"
          >
            <Radio className="mr-2 h-3.5 w-3.5 text-cyan-50" />
            Real Scenarios
          </motion.div>
          <motion.h2
            initial={{ opacity: 0, y: 24 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.7, ease: [0.16, 1, 0.3, 1] }}
            className="mb-6 text-4xl font-black tracking-tighter text-white md:text-5xl lg:text-6xl"
          >
            Built for <span className="text-white/40">dispatch realities.</span>
          </motion.h2>
          <motion.p
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ delay: 0.08 }}
            className="text-xl font-medium leading-relaxed text-white/50"
          >
            The system supports common after-hours dispatch scenarios while keeping operational
            judgment and final decisions with people.
          </motion.p>
        </div>

        <div className="grid gap-5 md:grid-cols-2 lg:grid-cols-4">
          {useCases.map((useCase, index) => (
            <motion.div
              key={useCase.title}
              initial={{ opacity: 0, y: 40 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.65, delay: index * 0.08, ease: [0.16, 1, 0.3, 1] }}
            >
              <TiltCard intensity={5} className="h-full rounded-2xl">
                <div
                  className={`group relative flex h-full min-h-[310px] flex-col overflow-hidden rounded-2xl border p-6 transition duration-500 hover:-translate-y-0.5 ${
                    useCase.urgent
                      ? "border-red-200/18 bg-red-300/[0.035] hover:border-red-100/28"
                      : "border-white/10 bg-white/[0.035] hover:border-cyan-200/24 hover:bg-white/[0.05]"
                  }`}
                  data-cursor="hover"
                  title={useCase.meta}
                >
                  {useCase.urgent ? (
                    <motion.div
                      aria-hidden
                      className="pointer-events-none absolute right-5 top-5 h-16 w-16 rounded-full border border-red-300/20 bg-red-400/[0.05]"
                      animate={{ scale: [1, 1.42, 1], opacity: [0.55, 0.08, 0.55] }}
                      transition={{ duration: 2.2, repeat: Infinity, ease: "easeInOut" }}
                    />
                  ) : null}
                  <div className="relative z-10 mb-8 flex items-center justify-between gap-4">
                    <div
                      className={`flex h-12 w-12 items-center justify-center rounded-2xl border ${
                        useCase.urgent
                          ? "border-red-200/20 bg-red-200/[0.055] text-red-50"
                          : "border-white/10 bg-black/42 text-cyan-50"
                      }`}
                    >
                      <useCase.icon className="h-5 w-5" />
                    </div>
                    <span className="rounded-full border border-white/10 bg-black/32 px-2.5 py-1 text-[10px] font-black uppercase tracking-widest text-white/38">
                      {useCase.meta}
                    </span>
                  </div>
                  <div className="relative z-10">
                    <h3 className="text-xl font-black tracking-tight text-white/88 transition-colors group-hover:text-white">
                      {useCase.title}
                    </h3>
                    <p className="mt-5 text-base font-medium leading-relaxed text-white/55">
                      {useCase.description}
                    </p>
                  </div>
                  <div className="mt-auto pt-7">
                    <div className="h-px w-full bg-white/10" />
                    <p className="mt-4 translate-y-2 text-xs font-black uppercase tracking-[0.22em] text-white/32 opacity-0 transition duration-300 group-hover:translate-y-0 group-hover:opacity-100">
                      Human-owned route
                    </p>
                  </div>
                </div>
              </TiltCard>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  )
}
