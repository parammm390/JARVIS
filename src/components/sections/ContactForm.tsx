"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { CalendarDays, CheckCircle2, Loader2 } from "lucide-react"
import { siteConfig } from "@/config/site"

export function ContactForm() {
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [isSuccess, setIsSuccess] = useState(false)
  const [error, setError] = useState("")

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setIsSubmitting(true)
    setError("")

    const formData = new FormData(event.currentTarget)

    if (formData.get("website_url")) {
      setIsSubmitting(false)
      return
    }

    try {
      const response = await fetch("/api/contact", {
        method: "POST",
        body: formData,
      })

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || "Something went wrong")
      }

      setIsSuccess(true)
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Failed to submit. Please try again."
      setError(message)
    } finally {
      setIsSubmitting(false)
    }
  }

  if (isSuccess) {
    return (
      <div className="ops-card flex h-full flex-col items-center justify-center rounded-[1.6rem] bg-white/86 p-8 text-center shadow-[0_24px_70px_rgba(15,23,42,0.1)] md:p-10">
        <div className="mb-6 flex h-20 w-20 items-center justify-center rounded-full border border-teal-100 bg-teal-50 text-teal-700 shadow-[0_18px_42px_rgba(20,184,166,0.12)]">
          <CheckCircle2 className="h-10 w-10" />
        </div>
        <h3 className="text-2xl font-black tracking-tight text-slate-950">
          Response workflow review requested
        </h3>
        <p className="mx-auto mt-3 max-w-sm text-sm font-semibold leading-relaxed text-slate-600">
          We will review your missed, overflow, and after-hours call path and reach out with the
          next step.
        </p>
        <a
          href={siteConfig.calendlyLink}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-7 inline-flex h-12 items-center justify-center gap-2 rounded-full bg-slate-950 px-6 text-sm font-black text-white transition hover:bg-slate-800"
        >
          <CalendarDays className="h-4 w-4" />
          Apply for Founding Pilot
        </a>
      </div>
    )
  }

  return (
    <div className="ops-card relative h-full overflow-hidden rounded-[1.6rem] bg-white/86 p-6 shadow-[0_24px_70px_rgba(15,23,42,0.1)] md:p-8">
      <div className="pointer-events-none absolute right-0 top-0 h-56 w-56 rounded-full bg-sky-100/70 blur-[78px]" />

      <div className="relative z-10">
        <h3 className="text-2xl font-black tracking-tight text-slate-950">
          Apply for the founding pilot
        </h3>
        <div className="mt-5 rounded-2xl border border-sky-100 bg-sky-50/75 p-4">
          <p className="text-sm font-semibold leading-relaxed text-slate-600">
            {siteConfig.calendlySupport}
          </p>
          <a
            href={siteConfig.calendlyLink}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-4 inline-flex h-11 items-center justify-center gap-2 rounded-full bg-slate-950 px-5 text-sm font-black text-white transition hover:bg-slate-800"
          >
            <CalendarDays className="h-4 w-4" />
            Apply for Founding Pilot
          </a>
        </div>

        <form onSubmit={handleSubmit} className="mt-7 space-y-6">
          <div className="hidden" aria-hidden="true">
            <input type="text" name="website_url" tabIndex={-1} autoComplete="off" />
          </div>

          <div className="grid gap-5 sm:grid-cols-2">
            <Field label="Full Name" id="name" name="name" placeholder="John Doe" required />
            <Field
              label="Work Email"
              id="email"
              name="email"
              type="email"
              placeholder="john@company.com"
              required
            />
          </div>

          <div className="grid gap-5 sm:grid-cols-2">
            <Field
              label="Company"
              id="company"
              name="company"
              placeholder="Blue Ridge Well & Pump"
            />
            <Field
              label="Phone Number"
              id="phone"
              name="phone"
              type="tel"
              placeholder="(555) 123-4567"
            />
          </div>

          <div className="space-y-3">
            <Label
              htmlFor="call_volume"
              className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-500"
            >
              Weekly call / lead volume
            </Label>
            <select
              id="call_volume"
              name="call_volume"
              required
              className="h-14 w-full rounded-xl border border-slate-200 bg-white px-4 text-base font-semibold text-slate-900 outline-none transition focus:border-sky-400 focus:ring-2 focus:ring-sky-100"
              defaultValue=""
            >
              <option value="" disabled>
                Select call volume
              </option>
              <option>Under 20 calls/week</option>
              <option>20-50 calls/week</option>
              <option>50-100 calls/week</option>
              <option>100+ calls/week</option>
              <option>I do not have this data yet</option>
            </select>
          </div>

          {error ? (
            <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm font-bold text-red-800">
              {error}
            </div>
          ) : null}

          <Button
            type="submit"
            className="h-14 w-full rounded-xl bg-slate-950 text-base font-black text-white shadow-[0_18px_36px_rgba(15,23,42,0.14)] transition hover:bg-slate-800"
            disabled={isSubmitting}
          >
            {isSubmitting ? (
              <>
                <Loader2 className="mr-2 h-5 w-5 animate-spin" /> Submitting request...
              </>
            ) : (
              "Apply for Founding Pilot"
            )}
          </Button>
        </form>
      </div>
    </div>
  )
}

function Field({
  label,
  id,
  ...props
}: React.InputHTMLAttributes<HTMLInputElement> & {
  label: string
  id: string
}) {
  return (
    <div className="space-y-3">
      <Label htmlFor={id} className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-500">
        {label}
      </Label>
      <Input
        id={id}
        className="h-14 rounded-xl border-slate-200 bg-white text-base font-semibold text-slate-900 placeholder:text-slate-400 focus-visible:border-sky-400 focus-visible:ring-2 focus-visible:ring-sky-100"
        {...props}
      />
    </div>
  )
}
