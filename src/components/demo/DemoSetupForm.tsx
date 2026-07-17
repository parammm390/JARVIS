"use client"

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react"
import { motion } from "framer-motion"
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  Droplets,
  Info,
  Loader2,
  ShieldCheck,
  Siren,
} from "lucide-react"
import type { DemoGenerationStage, GenerateDemoResponse } from "@/lib/demo/types"
import type { DemoWorkflowType } from "@/lib/demo/workflows"
import { PRICING_TIERS, TIER_DEFINITIONS, type PricingTier } from "@/lib/lifecycle/pricing"

const QUALIFY_SERVICES = [
  "Water softeners",
  "Whole-house filtration",
  "RO drinking water",
  "Iron & sulfur treatment",
  "UV disinfection",
  "Well pump service",
]
import { getWorkflowDefinition, workflowDefinitions } from "@/lib/demo/workflows"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"

function useHydrationAwareForms() {
  const [isHydrated, setIsHydrated] = useState(false)
  useEffect(() => {
    setIsHydrated(true)
  }, [])
  return isHydrated
}

type DemoSetupFormProps = {
  stage: DemoGenerationStage
  statusText: string
  result: GenerateDemoResponse | null
  error: string
  onGenerate: (input: {
    companyName: string
    websiteUrl: string
    workflowType: DemoWorkflowType
    qualification: {
      serviceZip: string
      pricingTier: string
      services: string[]
      householdSize: number
      onWell: boolean
    }
  }) => Promise<void>
  loadingSteps?: string[]
  loadingIndex?: number
}

const fallbackLoadingSteps = [
  "Reading company profile",
  "Mapping water treatment booking path",
  "Preparing voice script",
  "Building booking route preview",
]

export function DemoSetupForm({
  stage,
  statusText,
  result,
  error,
  onGenerate,
  loadingSteps = fallbackLoadingSteps,
  loadingIndex = 0,
}: DemoSetupFormProps) {
  const isHydrated = useHydrationAwareForms()
  const [companyName, setCompanyName] = useState("")
  const [websiteUrl, setWebsiteUrl] = useState("")
  const [workflowType, setWorkflowType] = useState<DemoWorkflowType>("water_treatment")
  const [serviceZip, setServiceZip] = useState("")
  const [pricingTier, setPricingTier] = useState<PricingTier>("standard")
  const [services, setServices] = useState<string[]>(QUALIFY_SERVICES.slice(0, 4))
  const [householdSize, setHouseholdSize] = useState(4)
  const [onWell, setOnWell] = useState(true)
  const workflow = getWorkflowDefinition(result?.profile.workflowType || workflowType)

  useEffect(() => {
    if (!isHydrated) return
    const form = document.querySelector('form[data-demo-setup]')
    if (!form) return
    const companyInput = form.querySelector<HTMLInputElement>('#companyName')
    const urlInput = form.querySelector<HTMLInputElement>('#websiteUrl')
    if (companyInput && companyInput.value !== companyName) {
      companyInput.value = companyName
    }
    if (urlInput && urlInput.value !== websiteUrl) {
      urlInput.value = websiteUrl
    }
  }, [isHydrated, companyName, websiteUrl])

  const isLoading = stage === "checking_duplicate" || stage === "generating_profile"
  const visibleLoadingSteps = loadingSteps.length ? loadingSteps : fallbackLoadingSteps
  const loadingProgress = isLoading
    ? Math.round(((loadingIndex + 1) / visibleLoadingSteps.length) * 100)
    : 0
  const canSubmit =
    companyName.trim().length > 1 &&
    websiteUrl.trim().length > 3 &&
    /^\d{5}$/.test(serviceZip) &&
    services.length > 0 &&
    !isLoading

  const qualityText = useMemo(() => {
    if (!result) return "Conservative extraction with fallback mode"
    if (result.profile.confidence_level === "high") return "High confidence profile generated"
    if (result.profile.confidence_level === "medium") return "Usable profile with factual guardrails"
    return "Fallback workflow prepared with low-confidence fields marked"
  }, [result])

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!canSubmit) return
    await onGenerate({
      companyName,
      websiteUrl,
      workflowType,
      qualification: { serviceZip, pricingTier, services, householdSize, onWell },
    })
  }

  const toggleService = useCallback((service: string) => {
    setServices((current) => {
      const updated = current.includes(service)
        ? current.filter((item) => item !== service)
        : [...current, service]
      return updated
    })
  }, [])

  return (
    <div className="ops-card relative overflow-hidden rounded-[1.6rem] bg-white/88 p-5 shadow-[0_24px_70px_rgba(15,23,42,0.1)] md:p-7 lg:p-8">
      <div className="pointer-events-none absolute right-0 top-0 h-72 w-72 rounded-full bg-sky-100/80 blur-[92px]" />
      <div className="relative z-10">
        <div className="mb-6 inline-flex items-center rounded-full border border-sky-100 bg-sky-50 px-4 py-1.5 text-[10px] font-black uppercase tracking-[0.2em] text-sky-800">
          <span className="mr-2 h-1.5 w-1.5 rounded-full bg-teal-500 shadow-[0_0_0_4px_rgba(20,184,166,0.12)]" />
          Live demo builder
        </div>

        <form onSubmit={handleSubmit} className="space-y-6" data-demo-setup>
          <div className="space-y-3">
            <Label
              htmlFor="companyName"
              className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-500"
            >
              Company Name
            </Label>
            <Input
              id="companyName"
              value={companyName}
              onChange={(event) => setCompanyName(event.target.value)}
              placeholder="Blue Ridge Water Treatment"
              className="h-14 rounded-xl border-slate-200 bg-white text-base font-semibold text-slate-900 placeholder:text-slate-400 focus-visible:border-sky-400 focus-visible:ring-2 focus-visible:ring-sky-100"
              autoComplete="organization"
              suppressHydrationWarning
            />
          </div>

          <div className="space-y-3">
            <Label
              htmlFor="websiteUrl"
              className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-500"
            >
              Website URL
            </Label>
            <Input
              id="websiteUrl"
              value={websiteUrl}
              onChange={(event) => setWebsiteUrl(event.target.value)}
              placeholder="https://blueridgewater.com"
              className="h-14 rounded-xl border-slate-200 bg-white text-base font-semibold text-slate-900 placeholder:text-slate-400 focus-visible:border-sky-400 focus-visible:ring-2 focus-visible:ring-sky-100"
              inputMode="url"
              autoComplete="url"
              suppressHydrationWarning
            />
          </div>

          <fieldset className="space-y-3">
            <legend className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-500">
              Workflow Type
            </legend>
            <div className="grid gap-3">
              {(
                [
                  ["water_treatment", Droplets],
                  ["well_pump_emergency", Siren],
                ] as const
              ).map(([value, Icon]) => {
                const option = workflowDefinitions[value]
                const selected = workflowType === value
                return (
                  <button
                    key={value}
                    type="button"
                    aria-pressed={selected}
                    onClick={() => setWorkflowType(value)}
                    className={`group relative overflow-hidden rounded-2xl border p-4 text-left transition-all ${
                      selected
                        ? "border-sky-300 bg-[linear-gradient(135deg,#f0f9ff_0%,#ecfeff_100%)] shadow-[0_16px_36px_rgba(14,165,233,0.1)]"
                        : "border-slate-200 bg-white hover:border-sky-200 hover:bg-sky-50/35"
                    }`}
                  >
                    <span
                      className={`absolute inset-y-0 left-0 w-1 transition-colors ${
                        selected ? "bg-gradient-to-b from-sky-500 to-teal-500" : "bg-transparent"
                      }`}
                    />
                    <span className="flex items-start gap-4">
                      <span
                        className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border ${
                          selected
                            ? "border-sky-200 bg-white text-sky-800"
                            : "border-slate-200 bg-slate-50 text-slate-500"
                        }`}
                      >
                        <Icon className="h-5 w-5" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center justify-between gap-3">
                          <span className="text-sm font-black text-slate-950">{option.label}</span>
                          <span
                            className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border ${
                              selected
                                ? "border-teal-500 bg-teal-500 text-white"
                                : "border-slate-300 bg-white text-transparent"
                            }`}
                          >
                            <CheckCircle2 className="h-3.5 w-3.5" />
                          </span>
                        </span>
                        <span className="mt-1.5 block text-xs font-semibold leading-relaxed text-slate-600">
                          {option.formDescription}
                        </span>
                      </span>
                    </span>
                  </button>
                )
              })}
            </div>
          </fieldset>

          <fieldset className="space-y-4 rounded-2xl border border-teal-100 bg-teal-50/40 p-4">
            <legend className="px-1 text-[10px] font-black uppercase tracking-[0.2em] text-teal-700">
              Pricing setup, so FINNOR gives a real range
            </legend>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="space-y-2">
                <Label
                  htmlFor="serviceZip"
                  className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-500"
                >
                  Service-area ZIP
                </Label>
                <Input
                  id="serviceZip"
                  value={serviceZip}
                  onChange={(event) =>
                    setServiceZip(event.target.value.replace(/[^\d]/g, "").slice(0, 5))
                  }
                  placeholder="22801"
                  inputMode="numeric"
                  className="h-12 rounded-xl border-slate-200 bg-white text-base font-semibold text-slate-900 placeholder:text-slate-400 focus-visible:border-sky-400 focus-visible:ring-2 focus-visible:ring-sky-100"
                />
              </div>
              <div className="space-y-2">
                <span className="block text-[10px] font-black uppercase tracking-[0.2em] text-slate-500">
                  Typical household
                </span>
                <div className="flex gap-2">
                  {[2, 4, 6].map((option) => (
                    <button
                      key={option}
                      type="button"
                      onClick={() => setHouseholdSize(option)}
                      className={`h-12 flex-1 rounded-xl border text-sm font-black transition ${
                        householdSize === option
                          ? "border-teal-200 bg-teal-50 text-teal-800"
                          : "border-slate-200 bg-white text-slate-600 hover:border-sky-200"
                      }`}
                    >
                      {option}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <div className="space-y-2">
              <span className="block text-[10px] font-black uppercase tracking-[0.2em] text-slate-500">
                Where you price
              </span>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                {PRICING_TIERS.map((tierOption) => {
                  const definition = TIER_DEFINITIONS[tierOption]
                  const selected = pricingTier === tierOption
                  return (
                    <button
                      key={tierOption}
                      type="button"
                      aria-pressed={selected}
                      onClick={() => setPricingTier(tierOption)}
                      className={`rounded-xl border p-3 text-left transition-all ${
                        selected
                          ? "border-sky-300 bg-white shadow-[0_12px_28px_rgba(14,165,233,0.1)]"
                          : "border-slate-200 bg-white hover:border-sky-200"
                      }`}
                    >
                      <span className="block text-xs font-black text-slate-950">
                        {definition.label}
                      </span>
                      <span className="mt-0.5 block text-[10px] font-bold leading-snug text-slate-500">
                        {definition.band}
                      </span>
                    </button>
                  )
                })}
              </div>
            </div>

            <div className="space-y-2">
              <span className="block text-[10px] font-black uppercase tracking-[0.2em] text-slate-500">
                Services you install
              </span>
              <div className="flex flex-wrap gap-2">
                {QUALIFY_SERVICES.map((service) => {
                  const active = services.includes(service)
                  return (
                    <button
                      key={service}
                      type="button"
                      onClick={() => toggleService(service)}
                      className={`rounded-full border px-3 py-1.5 text-xs font-black transition ${
                        active
                          ? "border-teal-200 bg-teal-50 text-teal-800"
                          : "border-slate-200 bg-white text-slate-600 hover:border-sky-200"
                      }`}
                    >
                      {service}
                    </button>
                  )
                })}
              </div>
            </div>

            <div className="space-y-2">
              <span className="block text-[10px] font-black uppercase tracking-[0.2em] text-slate-500">
                Most customers are on
              </span>
              <div className="flex gap-2">
                {[
                  [true, "Private wells"],
                  [false, "City water"],
                ].map(([value, label]) => (
                  <button
                    key={String(label)}
                    type="button"
                    onClick={() => setOnWell(Boolean(value))}
                    className={`h-11 flex-1 rounded-xl border text-xs font-black transition ${
                      onWell === value
                        ? "border-teal-200 bg-teal-50 text-teal-800"
                        : "border-slate-200 bg-white text-slate-600 hover:border-sky-200"
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
          </fieldset>

          <Button
            type="submit"
            disabled={!canSubmit}
            className="group min-h-14 w-full rounded-xl bg-slate-950 px-8 text-base font-black tracking-wide text-white shadow-[0_18px_40px_rgba(15,23,42,0.16)] transition-all hover:bg-slate-800 disabled:bg-slate-200 disabled:text-slate-500 disabled:shadow-none"
            data-cursor="hover"
          >
            {isLoading ? (
              <>
                <Loader2 className="h-5 w-5 animate-spin" />
                Building your demo...
              </>
            ) : (
              <>
                Generate Demo
                <ArrowRight className="h-5 w-5 transition-transform group-hover:translate-x-1" />
              </>
            )}
          </Button>
        </form>

        <div className="mt-7 space-y-4 border-t border-slate-200 pt-6" aria-live="polite">
          <StatusRow stage={stage} statusText={statusText} />

          {isLoading ? (
            <div className="rounded-2xl border border-sky-100 bg-sky-50/70 p-4">
              <div className="mb-3 flex items-center justify-between gap-4">
                <span className="text-xs font-black uppercase tracking-widest text-sky-800">
                  Building preview
                </span>
                <span className="text-xs font-black text-slate-500">{loadingProgress}%</span>
              </div>
              <div className="overflow-hidden rounded-full border border-white bg-white p-1">
                <div
                  className="h-2 rounded-full bg-gradient-to-r from-sky-500 via-teal-500 to-teal-300 shadow-[0_0_18px_rgba(14,165,233,0.22)] transition-all duration-700"
                  style={{ width: `${loadingProgress}%` }}
                />
              </div>
            </div>
          ) : null}

          {isLoading ? (
            <div className="grid gap-2">
              {visibleLoadingSteps.map((step, index) => {
                const active = index === loadingIndex
                const complete = index < loadingIndex
                return (
                  <div
                    key={step}
                    className={`flex items-center justify-between rounded-xl border px-3 py-2 text-xs font-black uppercase tracking-widest transition-all ${
                      active
                        ? "border-sky-200 bg-sky-50 text-sky-900"
                        : complete
                          ? "border-teal-100 bg-teal-50 text-teal-800"
                          : "border-slate-200 bg-white text-slate-600"
                    }`}
                  >
                    <span>{step}</span>
                    <span>{complete ? "Done" : active ? "Now" : "Queued"}</span>
                  </div>
                )
              })}
            </div>
          ) : null}

          {result ? (
            <div className="rounded-2xl border border-teal-100 bg-teal-50 p-4 text-sm font-semibold leading-relaxed text-teal-900">
              {workflow.readyCopy}
            </div>
          ) : null}

          <div className="flex items-start gap-3 rounded-2xl border border-slate-200 bg-white/80 p-4">
            <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-teal-700" />
            <div>
              <p className="text-sm font-black text-slate-900">{qualityText}</p>
              <p className="mt-1 text-sm font-semibold leading-relaxed text-slate-600">
                We only use confirmed information from your public website. We never fabricate
                service areas, emergency availability, equipment serviced, brands supported, or
                repair capabilities. If we cannot verify something, we mark it unknown rather than
                guess.
              </p>
            </div>
          </div>

          <div
            tabIndex={0}
            title="Operationally scoped workflow design keeps repair decisions, quotes, ETAs, and customer promises with your human team."
            className="group relative inline-flex w-fit items-center gap-2 rounded-full border border-slate-200 bg-white px-4 py-2 text-xs font-black uppercase tracking-widest text-slate-500 outline-none transition hover:border-sky-200 hover:text-sky-800 focus:border-sky-300"
          >
            <Info className="h-3.5 w-3.5" />
            Operationally scoped workflow
            <span className="pointer-events-none absolute left-0 top-full z-20 mt-3 hidden w-[min(320px,80vw)] rounded-2xl border border-slate-200 bg-white p-4 text-left text-xs normal-case tracking-normal text-slate-600 shadow-2xl group-hover:block group-focus:block">
              Finnor helps book the next step or route urgent service context. Repair decisions,
              quotes, ETAs, and customer promises remain with your human team.
            </span>
          </div>

          {result?.profile.fallback_used ? (
            <div className="rounded-2xl border border-sky-100 bg-sky-50/75 p-4 text-sm font-semibold leading-relaxed text-sky-900">
              We could not fully verify every website detail, so this preview uses a standard
              account-specific response workflow with factual fields kept conservative.
            </div>
          ) : null}

          {error ? (
            <div className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm font-semibold text-red-900">
              <div className="flex items-start gap-3">
                <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-red-700" />
                <div>
                  <p className="font-black">Demo generation paused</p>
                  <p className="mt-1 leading-relaxed">{error}</p>
                  <p className="mt-2 text-red-700">
                    Check the company name and website, then submit again.
                  </p>
                </div>
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  )
}

function StatusRow({ stage, statusText }: { stage: DemoGenerationStage; statusText: string }) {
  const isReady = stage === "ready"
  const isWorking = stage === "checking_duplicate" || stage === "generating_profile"

  return (
    <div className="flex items-center justify-between gap-4 rounded-2xl border border-slate-200 bg-white/80 px-4 py-3">
      <div className="flex items-center gap-3">
        <span className="relative flex h-2.5 w-2.5">
          {isWorking ? (
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-sky-500 opacity-45" />
          ) : null}
          <span
            className={`relative inline-flex h-2.5 w-2.5 rounded-full ${
              isReady ? "bg-teal-500" : isWorking ? "bg-sky-500" : "bg-slate-300"
            }`}
          />
        </span>
        <span className="text-sm font-bold text-slate-600">{statusText}</span>
      </div>
      {isReady ? (
        <motion.span
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          className="inline-flex items-center gap-2 text-xs font-black uppercase tracking-widest text-teal-700"
        >
          <CheckCircle2 className="h-4 w-4" />
          Ready
        </motion.span>
      ) : null}
    </div>
  )
}
