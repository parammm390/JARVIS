"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { motion } from "framer-motion"
import { Activity, ArrowLeft, CheckCircle2, Database, FileText, LockKeyhole, Network, ShieldCheck } from "lucide-react"
import type { DemoGenerationStage, GenerateDemoResponse } from "@/lib/demo/types"
import { DemoSetupForm } from "@/components/demo/DemoSetupForm"
import { DemoLimitReached } from "@/components/demo/DemoLimitReached"
import { PersonalizedDemoPanel } from "@/components/demo/PersonalizedDemoPanel"
import { ProofArtifacts } from "@/components/demo/ProofArtifacts"
import { WorkflowModule } from "@/components/demo/WorkflowModule"
import { CalendlyCta } from "@/components/demo/CalendlyCta"
import type { DemoWorkflowType } from "@/lib/demo/workflows"
import { getWorkflowDefinition } from "@/lib/demo/workflows"

import { DEMO_LIMIT_REACHED_MESSAGE } from "@/lib/demo/limits"

export function DemoExperience() {
  const [stage, setStage] = useState<DemoGenerationStage>("idle")
  const [loadingIndex, setLoadingIndex] = useState(0)
  const [result, setResult] = useState<GenerateDemoResponse | null>(null)
  const [error, setError] = useState("")
  const [duplicateMessage, setDuplicateMessage] = useState("")
  const [duplicateCalendlyUrl, setDuplicateCalendlyUrl] = useState("")
  const [activeStep, setActiveStep] = useState(0)
  const [callHasActivity, setCallHasActivity] = useState(false)
  const [selectedWorkflow, setSelectedWorkflow] =
    useState<DemoWorkflowType>("water_treatment")
  const callConsoleRef = useRef<HTMLDivElement>(null)
  const generationSteps = useMemo(
    () => [
      "Reading company profile",
      getWorkflowDefinition(selectedWorkflow).loadingStep,
      "Preparing voice script",
      "Building booking route preview",
    ],
    [selectedWorkflow]
  )

  useEffect(() => {
    if (stage !== "checking_duplicate" && stage !== "generating_profile") return
    setLoadingIndex(0)
    const timer = setInterval(() => {
      setLoadingIndex((current) => Math.min(current + 1, generationSteps.length - 1))
    }, 1450)

    return () => clearInterval(timer)
  }, [generationSteps.length, stage])

  useEffect(() => {
    if (stage !== "ready" || !result) return
    const timer = setTimeout(() => {
      callConsoleRef.current?.scrollIntoView({ behavior: "smooth", block: "start" })
    }, 250)

    return () => clearTimeout(timer)
  }, [result, stage])

  const handleGenerate = useCallback(
    async ({
      companyName,
      websiteUrl,
      workflowType,
      qualification,
    }: {
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
    }) => {
      setSelectedWorkflow(workflowType)
      setStage("checking_duplicate")
      setResult(null)
      setError("")
      setDuplicateMessage("")
      setDuplicateCalendlyUrl("")
      setActiveStep(0)
      setCallHasActivity(false)

      try {
        const localKey = localDemoKey(companyName, websiteUrl, workflowType)
        const startedAt = Date.now()
        const generationTimer = window.setTimeout(() => setStage("generating_profile"), 700)
        const response = await fetch("/api/generate-demo", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            companyName,
            websiteUrl,
            workflowType,
            qualification,
            browserFingerprint: getBrowserFingerprint(),
          }),
        })
        window.clearTimeout(generationTimer)

        const data = (await response.json()) as GenerateDemoResponse & { error?: string }
        if (response.status === 409 || data.duplicate) {
          setDuplicateMessage(data.duplicateMessage || DEMO_LIMIT_REACHED_MESSAGE)
          setDuplicateCalendlyUrl(data.calendlyUrl || "")
          if (localKey) window.localStorage.setItem(localKey, "duplicate")
          setStage("duplicate_blocked")
          return
        }

        if (!response.ok) {
          throw new Error(data.error || "The demo could not be generated.")
        }

        const elapsed = Date.now() - startedAt
        if (elapsed < 900) {
          await new Promise((resolve) => setTimeout(resolve, 900 - elapsed))
        }

        setStage("generating_profile")
        setLoadingIndex(3)
        await new Promise((resolve) => setTimeout(resolve, 650))
        setResult(data)
        if (localKey) window.localStorage.setItem(localKey, new Date().toISOString())
        setStage("ready")
        setLoadingIndex(3)
      } catch (err) {
        const message =
          err instanceof Error ? err.message : "The demo could not be generated. Please try again."
        setError(message)
        setStage("error")
      }
    },
    []
  )

  const statusText =
    stage === "ready"
      ? "Demo ready"
      : stage === "duplicate_blocked"
        ? "Demo limit reached"
        : stage === "error"
        ? "Generation paused"
        : stage === "connecting"
          ? "Connecting live call"
          : stage === "live"
            ? "Live call in progress"
            : stage === "ending"
              ? "Ending call"
              : stage === "extracting_handoff"
                ? "Extracting booking route"
              : stage === "ended"
                ? "Call ended"
        : stage === "checking_duplicate" || stage === "generating_profile"
          ? "Analyzing company..."
          : "Waiting for company details"

  const isGenerating = stage === "checking_duplicate" || stage === "generating_profile"
  const isLimitReached = stage === "duplicate_blocked"

  const resetLimitState = useCallback(() => {
    setStage("idle")
    setDuplicateMessage("")
    setDuplicateCalendlyUrl("")
    setError("")
  }, [])

  return (
    <main className="healthcare-page relative min-h-screen w-full overflow-hidden selection:bg-teal-200/35">
      <DemoHero
        stage={stage}
        statusText={statusText}
        result={result}
        error={error}
        duplicateMessage={duplicateMessage}
        duplicateCalendlyUrl={duplicateCalendlyUrl}
        isLimitReached={isLimitReached}
        onResetLimit={resetLimitState}
        onGenerate={handleGenerate}
        loadingSteps={generationSteps}
        loadingIndex={loadingIndex}
      />

      {result ? (
        <>
          <div ref={callConsoleRef}>
            <PersonalizedDemoPanel
              result={result}
              onActiveStepChange={setActiveStep}
              onCallActivity={() => setCallHasActivity(true)}
              onCallStatusChange={setStage}
            />
          </div>
          <WorkflowModule activeStep={activeStep} workflowType={result.profile.workflowType} />
          <ProofArtifacts artifacts={result.artifacts} activated={callHasActivity} />
          <section className="border-t border-slate-200 py-16">
            <div className="container px-4 md:px-6">
              <CalendlyCta />
            </div>
          </section>
        </>
      ) : isGenerating ? (
        <GenerationTheatre activeIndex={loadingIndex} steps={generationSteps} />
      ) : isLimitReached ? null : (
        <EmptyStatePreview />
      )}
    </main>
  )
}

function DemoHero({
  stage,
  statusText,
  result,
  error,
  duplicateMessage,
  duplicateCalendlyUrl,
  isLimitReached,
  onResetLimit,
  onGenerate,
  loadingSteps,
  loadingIndex,
}: {
  stage: DemoGenerationStage
  statusText: string
  result: GenerateDemoResponse | null
  error: string
  duplicateMessage: string
  duplicateCalendlyUrl: string
  isLimitReached: boolean
  onResetLimit: () => void
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
  loadingSteps: string[]
  loadingIndex: number
}) {
  return (
    <section className="relative flex min-h-screen max-w-[100vw] items-center overflow-hidden px-0 py-24 md:py-28">
      <div className="absolute inset-0 z-0">
        <div className="absolute inset-0 operational-grid opacity-70 [mask-image:radial-gradient(ellipse_80%_60%_at_50%_24%,#000_46%,transparent_100%)]" />
        <div className="absolute left-1/2 top-[6%] h-[520px] w-[820px] -translate-x-1/2 rounded-full bg-sky-200/45 blur-[170px]" />
        <div className="absolute bottom-0 right-0 h-[500px] w-[520px] rounded-full bg-teal-100/55 blur-[150px]" />
      </div>

      <div className="container relative z-10 max-w-full overflow-hidden px-4 md:px-6">
        <div className="mb-14 flex items-center justify-between gap-6">
          <a
            href="/"
            className="group inline-flex items-center gap-3 text-sm font-black uppercase tracking-widest text-slate-500 transition-colors hover:text-slate-950"
          >
            <ArrowLeft className="h-4 w-4 transition-transform group-hover:-translate-x-1" />
            FINNOR
          </a>
          <a
            href="#demo"
            className="rounded-full bg-slate-950 px-4 py-2 text-[10px] font-black uppercase tracking-widest text-white shadow-[0_16px_34px_rgba(15,23,42,0.14)] transition hover:bg-slate-800 sm:inline-flex sm:px-5 sm:text-xs"
          >
            <span className="sm:hidden">Builder</span>
            <span className="hidden sm:inline">Live demo builder</span>
          </a>
        </div>

        <div className="grid items-center gap-10 lg:grid-cols-[1.05fr_0.95fr] lg:gap-16">
          <div className="min-w-0 max-w-full sm:max-w-4xl">
            <motion.div
              initial={false}
              animate={{ opacity: 1, y: 0 }}
              className="mb-8 inline-flex max-w-full items-center rounded-full border border-slate-200 bg-white/72 px-5 py-2.5 text-sm font-bold tracking-wide text-slate-600 shadow-sm backdrop-blur-xl"
            >
              <span className="relative mr-3 flex h-2 w-2">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-teal-500 opacity-35" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-teal-500" />
              </span>
              <span>{result ? getWorkflowDefinition(result.profile.workflowType).label : "Choose your response workflow"}</span>
            </motion.div>

            <motion.h1
              initial={false}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
              className="max-w-full break-words text-[2.45rem] font-black leading-[1.02] tracking-tight text-slate-950 sm:text-[2.75rem] md:text-7xl lg:text-[6.4rem]"
            >
              <span className="block">Your company.</span>
              <span className="block">Your calls. Live.</span>
            </motion.h1>

            <motion.p
              initial={false}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.15, duration: 0.7 }}
              className="mt-7 max-w-full break-words text-lg font-medium leading-relaxed text-slate-600 md:max-w-2xl md:text-xl lg:text-2xl"
            >
              Choose the workflow you want to test. FINNOR builds an account-specific response
              preview using confirmed public information from your site, with unknowns kept
              explicitly unknown.
            </motion.p>

            <motion.div
              initial={false}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.25 }}
              className="mt-9 hidden w-full min-w-0 max-w-full gap-3 sm:grid sm:grid-cols-3 md:max-w-2xl"
            >
              {[
                { icon: LockKeyhole, label: "Review public site information" },
                { icon: Network, label: "Build workflow context" },
                { icon: FileText, label: "Generate demo preview" },
              ].map((item) => (
                <div
                  key={item.label}
                  className="min-w-0 rounded-xl border border-slate-200 bg-white/78 p-4 shadow-sm transition hover:-translate-y-0.5 hover:border-sky-200 hover:bg-white"
                  data-cursor="hover"
                >
                  <item.icon className="mb-4 h-5 w-5 text-sky-700" />
                  <p className="text-xs font-black uppercase tracking-widest text-slate-500">
                    {item.label}
                  </p>
                </div>
              ))}
            </motion.div>

            <motion.div
              initial={false}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.32 }}
              className="mt-5 hidden w-full min-w-0 max-w-full gap-3 rounded-2xl border border-slate-200 bg-white/62 p-3 shadow-sm sm:grid sm:grid-cols-3 md:max-w-2xl"
            >
              {[
                { icon: Activity, label: "Live generation state" },
                { icon: Database, label: "Unknowns stay marked" },
                { icon: ShieldCheck, label: "No fake service claims" },
              ].map((item) => (
                <div key={item.label} className="flex min-w-0 items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2">
                  <item.icon className="h-4 w-4 text-teal-700" />
                  <span className="text-[10px] font-black uppercase tracking-widest text-slate-500">
                    {item.label}
                  </span>
                </div>
              ))}
            </motion.div>
          </div>

          <motion.div
            id="demo"
              initial={false}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2, duration: 0.75, ease: [0.16, 1, 0.3, 1] }}
            className="max-w-full sm:max-w-none"
          >
            {isLimitReached ? (
              <DemoLimitReached
                message={duplicateMessage}
                calendlyUrl={duplicateCalendlyUrl || undefined}
                onTryAnotherCompany={onResetLimit}
              />
            ) : (
              <DemoSetupForm
                stage={stage}
                statusText={statusText}
                result={result}
                error={error}
                onGenerate={onGenerate}
                loadingSteps={loadingSteps}
                loadingIndex={loadingIndex}
              />
            )}
          </motion.div>
        </div>
      </div>
    </section>
  )
}

function getBrowserFingerprint() {
  const key = "finnor_demo_browser_id"
  let existing = window.localStorage.getItem(key)
  if (!existing) {
    existing = `${Date.now()}-${crypto.randomUUID?.() || Math.random().toString(36).slice(2)}`
    window.localStorage.setItem(key, existing)
  }

  return [
    existing,
    navigator.userAgent,
    navigator.language,
    Intl.DateTimeFormat().resolvedOptions().timeZone,
    `${screen.width}x${screen.height}`,
  ].join("|")
}

function localDemoKey(
  companyName: string,
  websiteUrl: string,
  workflowType: DemoWorkflowType
) {
  const domain = normalizeClientDomain(websiteUrl)
  const company = companyName
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
  return domain && company
    ? `finnor_demo_generated:${domain}:${company}:${workflowType}`
    : ""
}

function normalizeClientDomain(input: string) {
  try {
    const url = new URL(/^https?:\/\//i.test(input) ? input : `https://${input}`)
    return url.hostname.toLowerCase().replace(/^www\./, "")
  } catch {
    return ""
  }
}

function GenerationTheatre({
  activeIndex,
  steps,
}: {
  activeIndex: number
  steps: string[]
}) {
  return (
    <section className="relative border-t border-slate-200 py-16 md:py-20">
      <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-sky-200 to-transparent" />
      <div className="container px-4 md:px-6">
        <div className="grid gap-6 lg:grid-cols-[0.9fr_1.1fr] lg:items-start">
          <motion.div
            initial={false}
            animate={{ opacity: 1, y: 0 }}
            className="ops-card rounded-2xl bg-white/86 p-5 md:p-7"
          >
            <p className="text-xs font-black uppercase tracking-[0.28em] text-sky-800">
              Analyzing company...
            </p>
            <div className="mt-6 space-y-3">
              {steps.map((step, index) => {
                const active = activeIndex === index
                const complete = activeIndex > index
                return (
                  <div
                    key={step}
                    className={`flex items-center gap-4 rounded-xl border p-4 transition-all duration-500 ${
                      active
                        ? "border-sky-200 bg-sky-50"
                        : complete
                          ? "border-teal-100 bg-teal-50"
                          : "border-slate-200 bg-white"
                    }`}
                  >
                    <span
                      className={`flex h-8 w-8 items-center justify-center rounded-full border text-xs font-black ${
                        complete
                          ? "border-teal-200 bg-teal-100 text-teal-800"
                          : active
                            ? "border-sky-300 text-sky-800 shadow-[0_0_18px_rgba(14,165,233,0.12)]"
                            : "border-slate-200 text-slate-600"
                      }`}
                    >
                      {complete ? <CheckCircle2 className="h-4 w-4" /> : index + 1}
                    </span>
                    <span className="text-sm font-black uppercase tracking-widest text-slate-600">
                      {step}
                    </span>
                  </div>
                )
              })}
            </div>
          </motion.div>

          <div className="grid gap-4 sm:grid-cols-2">
            {["Voice script", "Response workflow", "Handoff preview", "Proof panels"].map((label, index) => (
              <motion.div
                key={label}
              initial={false}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: index * 0.08 }}
                className="relative overflow-hidden rounded-2xl border border-slate-200 bg-white/74 p-5 shadow-sm"
                data-cursor="hover"
              >
                <SkeletonShimmer />
                <div className="relative z-10">
                  <div className="mb-5 h-3 w-28 rounded-full bg-slate-200" />
                  <div className="space-y-3">
                    <div className="h-4 w-4/5 rounded-full bg-sky-100" />
                    <div className="h-4 w-full rounded-full bg-slate-100" />
                    <div className="h-4 w-3/5 rounded-full bg-slate-100" />
                  </div>
                  <p className="mt-6 text-xs font-black uppercase tracking-widest text-slate-500">
                    {label}
                  </p>
                </div>
              </motion.div>
            ))}
          </div>
        </div>
      </div>
    </section>
  )
}

function SkeletonShimmer() {
  return (
    <div className="pointer-events-none absolute inset-0 -translate-x-full animate-[shimmer_1.8s_linear_infinite] bg-gradient-to-r from-transparent via-white/70 to-transparent" />
  )
}

function EmptyStatePreview() {
  const previews = [
    { label: "Voice call preview", type: "waveform" },
    { label: "Workflow pulse", type: "nodes" },
    { label: "Recovered lead route", type: "phone" },
    { label: "Booking route", type: "table" },
  ]

  return (
    <section className="relative border-t border-slate-200 py-16">
      <div className="container px-4 md:px-6">
        <div className="grid gap-4 md:grid-cols-4">
          {previews.map((preview, index) => (
            <motion.div
              key={preview.label}
              initial={false}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ delay: index * 0.06 }}
              className="relative overflow-hidden rounded-2xl border border-slate-200 bg-white/74 p-5 shadow-sm transition hover:-translate-y-0.5 hover:border-sky-200 hover:bg-white"
              data-cursor="hover"
            >
              <div className="absolute inset-x-0 top-0 h-px animate-pulse bg-gradient-to-r from-transparent via-sky-300 to-transparent" />
              <div className="mb-5 flex items-center gap-2">
                <CheckCircle2 className="h-4 w-4 text-slate-500" />
                <span className="text-xs font-black uppercase tracking-widest text-slate-600">
                  0{index + 1}
                </span>
              </div>
              <SkeletonPreview type={preview.type} />
              <p className="mt-5 text-lg font-black tracking-tight text-slate-700">{preview.label}</p>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  )
}

function SkeletonPreview({ type }: { type: string }) {
  if (type === "waveform") {
    return (
      <div className="flex h-16 items-end gap-1.5 rounded-2xl border border-slate-200 bg-white p-4">
        {[0.45, 0.75, 0.55, 0.92, 0.62, 0.8].map((height, index) => (
          <motion.span
            key={index}
            animate={{ scaleY: [0.45, height, 0.5] }}
            transition={{ duration: 1.1, repeat: Infinity, delay: index * 0.08 }}
            className="h-8 w-1.5 origin-bottom rounded-full bg-sky-400/45"
          />
        ))}
      </div>
    )
  }
  if (type === "nodes") {
    return (
      <div className="flex h-16 items-center gap-2 rounded-2xl border border-slate-200 bg-white p-4">
        {[0, 1, 2].map((item) => (
          <div key={item} className="flex flex-1 items-center gap-2">
            <span className="h-4 w-4 rounded-full bg-teal-400/55 shadow-[0_0_14px_rgba(20,184,166,0.18)]" />
            {item < 2 ? <span className="h-px flex-1 bg-gradient-to-r from-teal-300/55 to-slate-200" /> : null}
          </div>
        ))}
      </div>
    )
  }
  if (type === "phone") {
    return (
      <div className="h-16 rounded-2xl border border-slate-200 bg-white p-4">
        <div className="h-3 w-24 rounded-full bg-slate-200" />
        <div className="mt-3 h-3 w-full rounded-full bg-slate-100" />
        <div className="mt-2 h-3 w-3/4 rounded-full bg-sky-100" />
      </div>
    )
  }
  return (
    <div className="h-16 rounded-2xl border border-slate-200 bg-white p-4">
      {["Caller", "Concern", "Equipment"].map((row) => (
        <div key={row} className="mb-2 grid grid-cols-[70px_1fr] gap-2">
          <span className="h-2 rounded-full bg-slate-200" />
          <span className="h-2 rounded-full bg-sky-100" />
        </div>
      ))}
    </div>
  )
}
