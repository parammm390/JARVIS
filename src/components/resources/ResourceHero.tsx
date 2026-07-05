"use client"

import { motion } from "framer-motion"
import type { LucideIcon } from "lucide-react"

type ResourceHeroProps = {
  kicker: string
  title: string
  copy: string
  icon: LucideIcon
  aside?: React.ReactNode
}

export function ResourceHero({ kicker, title, copy, icon: Icon, aside }: ResourceHeroProps) {
  return (
    <section className="relative overflow-hidden px-0 pb-14 pt-32 md:pb-20 md:pt-36">
      <div className="absolute inset-0 operational-grid opacity-45" />
      <div className="absolute inset-x-0 top-0 h-40 bg-gradient-to-b from-white via-white/80 to-transparent" />
      <div className="absolute left-[-16rem] top-[-12rem] h-[34rem] w-[34rem] rounded-full bg-sky-200/35 blur-3xl" />
      <div className="absolute right-[-13rem] top-16 h-[32rem] w-[32rem] rounded-full bg-teal-100/38 blur-3xl" />
      <div className="container relative z-10 px-4 md:px-6">
        <div className="grid gap-10 lg:grid-cols-[0.92fr_0.78fr] lg:items-end">
          <div>
            <motion.div
              initial={{ opacity: 0, y: 14 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5 }}
              className="mb-6 inline-flex items-center rounded-full border border-sky-900/10 bg-white px-4 py-2 text-xs font-black uppercase tracking-[0.18em] text-sky-800 shadow-sm"
            >
              <Icon className="mr-2 h-3.5 w-3.5" />
              {kicker}
            </motion.div>
            <motion.h1
              initial={{ opacity: 0, y: 18 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.68, ease: [0.16, 1, 0.3, 1] }}
              className="max-w-4xl text-4xl font-black leading-[1.01] tracking-tight text-slate-950 md:text-6xl lg:text-7xl"
            >
              {title}
            </motion.h1>
            <motion.p
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.1, duration: 0.58 }}
              className="mt-7 max-w-2xl text-lg font-semibold leading-relaxed text-slate-700 md:text-xl"
            >
              {copy}
            </motion.p>
          </div>
          {aside ? (
            <motion.div
              initial={{ opacity: 0, y: 22, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              transition={{ delay: 0.12, duration: 0.65, ease: [0.16, 1, 0.3, 1] }}
            >
              {aside}
            </motion.div>
          ) : null}
        </div>
      </div>
    </section>
  )
}
