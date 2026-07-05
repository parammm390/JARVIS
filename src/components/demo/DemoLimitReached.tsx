"use client"

import { CalendarDays } from "lucide-react"
import { DEMO_LIMIT_CALENDLY_URL, DEMO_LIMIT_REACHED_MESSAGE } from "@/lib/demo/limits"

type DemoLimitReachedProps = {
  message?: string
  calendlyUrl?: string
  onTryAnotherCompany?: () => void
}

export function DemoLimitReached({
  message = DEMO_LIMIT_REACHED_MESSAGE,
  calendlyUrl = DEMO_LIMIT_CALENDLY_URL,
  onTryAnotherCompany,
}: DemoLimitReachedProps) {
  return (
    <div
      role="alert"
      aria-live="assertive"
      className="ops-card relative overflow-hidden rounded-[1.6rem] border-2 border-amber-200 bg-[linear-gradient(180deg,#fffbeb_0%,#ffffff_42%)] p-6 shadow-[0_24px_70px_rgba(245,158,11,0.18)] md:p-8 lg:p-10"
    >
      <div className="pointer-events-none absolute right-0 top-0 h-72 w-72 rounded-full bg-amber-100/80 blur-[92px]" />
      <div className="relative z-10 space-y-6 text-center">
        <div className="mx-auto inline-flex items-center rounded-full border border-amber-200 bg-amber-50 px-4 py-1.5 text-[10px] font-black uppercase tracking-[0.24em] text-amber-900">
          Demo limit reached
        </div>

        <div className="space-y-3">
          <h2 className="text-2xl font-black tracking-tight text-slate-950 md:text-3xl">
            You&apos;ve used all five demo builds for this company
          </h2>
          <p className="mx-auto max-w-xl text-base font-semibold leading-relaxed text-slate-600">
            {message}
          </p>
        </div>

        <div className="flex flex-col items-center justify-center gap-3 sm:flex-row">
          <a
            href={calendlyUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex h-14 min-w-[240px] items-center justify-center gap-2 rounded-full bg-slate-950 px-8 text-base font-black text-white shadow-[0_18px_40px_rgba(15,23,42,0.18)] transition hover:bg-slate-800"
          >
            <CalendarDays className="h-5 w-5" />
            Book a call
          </a>
          {onTryAnotherCompany ? (
            <button
              type="button"
              onClick={onTryAnotherCompany}
              className="inline-flex h-14 items-center justify-center rounded-full border border-slate-200 bg-white px-6 text-sm font-black text-slate-700 transition hover:border-slate-300 hover:bg-slate-50"
            >
              Try a different company
            </button>
          ) : null}
        </div>
      </div>
    </div>
  )
}
