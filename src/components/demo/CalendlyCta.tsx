"use client"

import { CalendarDays } from "lucide-react"
import { siteConfig } from "@/config/site"

export const CALENDLY_URL = siteConfig.calendlyLink

export function CalendlyCta({ compact = false }: { compact?: boolean }) {
  return (
    <div
      className={`rounded-[1.35rem] border border-sky-100 bg-white/86 shadow-sm ${
        compact ? "p-5" : "p-6 md:p-7"
      }`}
    >
      <div className="flex flex-col gap-5 md:flex-row md:items-center md:justify-between">
        <div>
          <h3 className="text-xl font-black tracking-tight text-slate-950">
            Apply for Founding Pilot
          </h3>
          <p className="mt-2 max-w-2xl text-sm font-semibold leading-relaxed text-slate-600">
            Bring your company&apos;s demo. We will scope the lead sources, booking workflow,
            urgent routes, and human ownership boundaries for a 7-day launch.
          </p>
        </div>
        <a
          href={CALENDLY_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex h-12 shrink-0 items-center justify-center gap-2 rounded-full bg-slate-950 px-6 text-sm font-black text-white shadow-[0_16px_34px_rgba(15,23,42,0.14)] transition hover:bg-slate-800"
        >
          <CalendarDays className="h-4 w-4" />
          Apply for Founding Pilot
        </a>
      </div>
    </div>
  )
}
