"use client"

import { motion } from "framer-motion"
import { ArrowRight, CalendarDays, Play, Radio } from "lucide-react"
import { siteConfig } from "@/config/site"
import { ContactForm } from "./ContactForm"
import { Magnetic } from "@/components/ui/magnetic"

export function Cta() {
  return (
    <section id="contact" className="healthcare-section relative overflow-hidden py-20 md:py-28">
      <div className="absolute inset-0 operational-grid opacity-70" />
      <div className="pointer-events-none absolute left-[-12%] top-1/4 h-[30rem] w-[30rem] rounded-full bg-sky-200/35 blur-[120px]" />
      <div className="pointer-events-none absolute bottom-0 right-[-10%] h-[34rem] w-[34rem] rounded-full bg-teal-100/55 blur-[130px]" />

      <div className="container relative z-10 px-4 md:px-6">
        <div className="grid gap-8 lg:grid-cols-[1.05fr_0.95fr] lg:items-stretch">
          <motion.div
            initial={{ opacity: 0, y: 28 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: "-80px" }}
            transition={{ duration: 0.65, ease: [0.16, 1, 0.3, 1] }}
            className="ops-card relative flex min-h-[32rem] flex-col justify-between overflow-hidden rounded-[2rem] bg-white p-7 text-slate-950 md:p-10"
          >
            <div className="pointer-events-none absolute inset-x-0 top-0 h-2 bg-gradient-to-r from-slate-950 via-sky-700 to-teal-600" />
            <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_18%_0%,rgba(14,165,233,0.12),transparent_36%),linear-gradient(135deg,rgba(45,212,191,0.08),transparent_50%)]" />
            <div className="relative">
              <div className="mb-7 inline-flex items-center rounded-full border border-slate-900/10 bg-white px-4 py-1.5 text-xs font-black uppercase tracking-[0.22em] text-sky-800 shadow-sm">
                <Radio className="mr-2 h-3.5 w-3.5" />
                Recover more jobs
              </div>
              <h2 className="max-w-3xl text-4xl font-black leading-[1.02] tracking-tight text-slate-950 md:text-6xl">
                How many quotable jobs died in your voicemail last week?
              </h2>
              <p className="mt-6 max-w-2xl text-lg font-semibold leading-relaxed text-slate-700 md:text-xl">
                Every one of them was a household memory record you never got to open: the call,
                the water data, the sized quote, the booked visit, and two years of revenue after
                it. FINNOR opens the record on ring two.
              </p>
            </div>

            <div className="relative mt-10 flex flex-col gap-3 sm:flex-row">
              <Magnetic strength={0.16}>
                <a
                  href={siteConfig.calendlyLink}
                  target="_blank"
                  rel="noopener noreferrer"
                  data-cursor="hover"
                  className="cta-primary inline-flex h-14 items-center justify-center gap-2 rounded-full bg-slate-950 px-7 text-sm font-black text-white transition hover:-translate-y-0.5 hover:bg-slate-800"
                >
                  <CalendarDays className="h-4 w-4" />
                  Apply for Founding Pilot
                  <ArrowRight className="h-4 w-4" />
                </a>
              </Magnetic>
              <Magnetic strength={0.16}>
                <a
                  href={siteConfig.demoLink}
                  data-cursor="hover"
                  className="cta-secondary inline-flex h-14 items-center justify-center gap-2 rounded-full border border-slate-900/12 bg-white px-7 text-sm font-black text-slate-900 transition hover:-translate-y-0.5 hover:border-slate-900/24"
                >
                  <Play className="h-4 w-4" />
                  Build Your Company Demo
                </a>
              </Magnetic>
            </div>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, y: 28 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: "-80px" }}
            transition={{ delay: 0.08, duration: 0.65, ease: [0.16, 1, 0.3, 1] }}
          >
            <ContactForm />
          </motion.div>
        </div>
      </div>
    </section>
  )
}
