"use client"

import { motion } from "framer-motion"
import { CalendarDays } from "lucide-react"
import { siteConfig } from "@/config/site"

export function Founder() {
  return (
    <section className="relative overflow-hidden border-t border-white/5 py-20 md:py-28">
      <div className="absolute left-1/2 top-0 h-[420px] w-[720px] -translate-x-1/2 rounded-full bg-cyan-200/[0.055] blur-[150px]" />
      <div className="container relative z-10 px-4 md:px-6">
        <motion.div
          initial={{ opacity: 0, y: 24 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: "-80px" }}
          transition={{ duration: 0.75, ease: [0.16, 1, 0.3, 1] }}
          className="command-surface relative mx-auto max-w-5xl overflow-hidden rounded-[1.65rem] p-6 md:p-10"
        >
          <div className="absolute inset-0 command-grid opacity-25 [mask-image:linear-gradient(to_bottom,#000,transparent_78%)]" />
          <p className="relative z-10 mb-5 text-[10px] font-black uppercase tracking-[0.24em] text-cyan-100/65">
            Founder note
          </p>
          <div className="relative z-10 grid gap-8 md:grid-cols-[0.9fr_1.1fr] md:items-center">
            <h2 className="text-3xl font-black tracking-tight text-white md:text-5xl">
              Built around one problem: after-hours calls going cold.
            </h2>
            <div>
              <p className="text-base font-medium leading-relaxed text-white/58 md:text-lg">
                I&apos;m Param Dave, the builder behind Finnor. I built this around one problem I kept
                seeing in private well pump dispatch: after-hours calls going to voicemail with no
                booked next step.
              </p>
              <a
                href={siteConfig.calendlyLink}
                target="_blank"
                rel="noopener noreferrer"
                data-cursor="hover"
                className="mt-6 inline-flex h-12 items-center justify-center gap-2 rounded-full border border-white/15 bg-white/[0.045] px-6 text-sm font-black text-white transition hover:border-cyan-200/35 hover:bg-white/[0.075]"
              >
                <CalendarDays className="h-4 w-4" />
                Apply for Founding Pilot
              </a>
            </div>
          </div>
        </motion.div>
      </div>
    </section>
  )
}
