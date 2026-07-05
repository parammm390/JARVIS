"use client"

import { motion } from "framer-motion"
import { memo, useMemo } from "react"
import type { ReactNode } from "react"
import {
  BellRing,
  CalendarDays,
  CheckCircle2,
  ClipboardCheck,
  ClipboardList,
  DatabaseZap,
  FileText,
  LucideIcon,
  PhoneCall,
  Send,
  ShieldCheck,
} from "lucide-react"
import type { DemoIntakeHandoff, DemoProofArtifacts, NormalizedTranscriptItem } from "@/lib/demo/types"
import {
  buildLiveIntakeSnapshot,
  NEEDS_CONFIRMATION,
  NOT_CAPTURED,
} from "@/lib/demo/intake-extraction"
import { CALENDLY_URL } from "@/components/demo/CalendlyCta"
import { getWorkflowDefinition, type DemoWorkflowType } from "@/lib/demo/workflows"
import { writeLifecycleHandoff } from "@/lib/memory/handoff"

export type DemoTranscriptItem = NormalizedTranscriptItem
export type IntakeSnapshot = DemoIntakeHandoff

export function buildIntakeSnapshot(
  transcript: DemoTranscriptItem[],
  companyName = "Generated company",
  workflowType: DemoWorkflowType = "water_treatment"
): IntakeSnapshot {
  return buildLiveIntakeSnapshot(transcript, companyName, workflowType)
}

export function PostCallHandoff({
  companyName,
  transcript,
  artifacts,
  intake,
}: {
  companyName: string
  transcript: DemoTranscriptItem[]
  artifacts: DemoProofArtifacts
  intake: IntakeSnapshot
}) {
  const workflow = getWorkflowDefinition(intake.workflowType)
  const alertMessage = useMemo(() => intake.dispatchAlertText || buildAlertMessage(intake), [intake])
  const crmFields = useMemo(
    () =>
      intake.workflowType === "water_treatment"
        ? [
            ["Lead type", intake.leadType],
            ["Company", companyName || intake.companyName || NEEDS_CONFIRMATION],
            ["Caller", intake.callerName],
            ["Location", intake.facilityName],
            ["Water concern", intake.mainConcern],
            ["Water source", intake.waterSource],
            ["System interest", intake.systemInterest],
            ["Timeline", intake.timeline],
            ["Callback preference", intake.callbackPreference],
            ["Follow-up owner", "CSR / sales team"],
            ["Status", intake.status],
          ]
        : [
            ["Lead type", intake.leadType],
            ["Company", companyName || intake.companyName || NEEDS_CONFIRMATION],
            ["Caller", intake.callerName],
            ["Service address", intake.facilityName],
            ["Issue", intake.mainConcern],
            ["Whole-house or partial", intake.wholeHouseOrPartial],
            ["Since when", intake.sinceWhen],
            ["People affected", intake.peopleAffected],
            ["Safety screen", intake.safetyScreen],
            ["Callback", intake.callbackNumber],
            ["Owner", "On-call dispatch"],
            ["Status", intake.status],
          ],
    [companyName, intake]
  )

  return (
    <motion.div
      initial={{ opacity: 0, y: 28 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.75, ease: [0.16, 1, 0.3, 1] }}
      className="mt-8 overflow-hidden rounded-[2rem] border border-teal-300/40 bg-[linear-gradient(145deg,#0f766e_0%,#0891b2_52%,#0e7490_100%)] shadow-[0_30px_120px_rgba(8,145,178,0.28)]"
    >
      <div className="border-b border-white/35 p-5 md:p-7">
        <div className="flex flex-col gap-5 md:flex-row md:items-end md:justify-between">
          <div>
            <div className="mb-4 inline-flex items-center rounded-full border border-cyan-200/20 bg-cyan-200/[0.065] px-4 py-1.5 text-[10px] font-black uppercase tracking-[0.22em] text-cyan-50">
              <span className="mr-2 h-1.5 w-1.5 rounded-full bg-cyan-200 shadow-[0_0_18px_rgba(103,232,249,0.9)]" />
              {workflow.handoffStatus}
            </div>
            <h3 className="text-3xl font-black tracking-tight text-white md:text-5xl">
              {workflow.handoffTitle}
            </h3>
            <p className="mt-3 max-w-3xl text-sm font-medium leading-relaxed text-white/85 md:text-base">
              The call is converted into a booking or urgent-route workflow the human team can act on.
            </p>
          </div>
          <div className="rounded-2xl border border-white/35 bg-white/15 px-4 py-3">
            <p className="text-[10px] font-black uppercase tracking-widest text-white/85">
              Transcript events
            </p>
            <p className="mt-1 text-2xl font-black text-white">{transcript.length}</p>
          </div>
        </div>
        {intake.isPreview ? (
          <div className="mt-5 rounded-2xl border border-cyan-200/15 bg-cyan-200/[0.045] px-4 py-3 text-sm font-semibold leading-relaxed text-cyan-50/85">
            {intake.previewReason || "Demo booking-route preview generated from the scenario"}
          </div>
        ) : null}
      </div>

      <div className="grid gap-5 p-5 md:p-7 xl:grid-cols-[1.02fr_0.98fr]">
        <div className="space-y-5">
          <HandoffCard icon={PhoneCall} label="Call Summary">
            <FieldGrid
              fields={[
                ["Caller name", intake.callerName],
                [intake.workflowType === "water_treatment" ? "Location" : "Service address", intake.facilityName],
                ["Main concern", intake.mainConcern],
                [
                  intake.workflowType === "water_treatment" ? "System interest" : "Equipment",
                  intake.workflowType === "water_treatment"
                    ? intake.systemInterest
                    : intake.equipmentType,
                ],
                ["Immediate danger", intake.immediateDanger],
                ["Callback number", intake.callbackNumber],
                ["Status", intake.status],
              ]}
            />
          </HandoffCard>

          <HandoffCard icon={ClipboardList} label="Booking Context">
            <div className="grid gap-3 sm:grid-cols-2">
              {[
                ["Caller identity", intake.callerIdentity],
                ["Location context", intake.clientContext],
                [
                  intake.workflowType === "water_treatment" ? "Water source" : "Issue scope",
                  intake.workflowType === "water_treatment"
                    ? intake.waterSource
                    : intake.wholeHouseOrPartial,
                ],
                [
                  intake.workflowType === "water_treatment" ? "Timeline" : "Since when",
                  intake.workflowType === "water_treatment" ? intake.timeline : intake.sinceWhen,
                ],
                ["Safety screen", intake.safetyScreen],
                ["Follow-up path", intake.followUpPath],
              ].map(([label, value]) => (
                <motion.div
                  key={label}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.45 }}
                  className="rounded-2xl border border-slate-200 bg-slate-50 p-4"
                >
                  <div className="mb-3 flex items-center gap-2 text-[10px] font-black uppercase tracking-widest text-slate-500">
                    <CheckCircle2
                      className={`h-3.5 w-3.5 ${isCapturedValue(value) ? "text-teal-600" : "text-slate-300"}`}
                    />
                    {label}
                  </div>
                  <p className="text-sm font-bold leading-relaxed text-slate-700">{value}</p>
                </motion.div>
              ))}
            </div>
          </HandoffCard>
        </div>

        <div className="space-y-5">
          {intake.nextAction ? (
            <HandoffCard icon={ClipboardCheck} label="Next Revenue Action">
              <div className="rounded-3xl border border-teal-200 bg-teal-50 p-5">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <p className="text-base font-black text-slate-950">{intake.nextAction.label}</p>
                    <p className="mt-1.5 text-xs font-bold uppercase tracking-widest text-teal-700">
                      {intake.nextAction.due}
                    </p>
                  </div>
                  {typeof intake.nextAction.revenue === "number" ? (
                    <span className="shrink-0 rounded-full border border-teal-200 bg-white px-3 py-1.5 text-sm font-black text-teal-800">
                      ${intake.nextAction.revenue.toLocaleString("en-US")}
                    </span>
                  ) : null}
                </div>
                <p className="mt-3 text-sm font-semibold leading-relaxed text-slate-700">
                  This call is now a household memory record. Every record carries its next
                  revenue action — and the record never forgets.
                </p>
                {intake.household ? (
                  <button
                    type="button"
                    data-cursor="hover"
                    onClick={() => {
                      const record = intake.household
                      if (!record) return
                      writeLifecycleHandoff({
                        householdId: record.id,
                        dealerName: record.dealer.name,
                        zip: record.dealer.zip,
                        tier: record.dealer.tier,
                        services: record.dealer.services,
                        onWell: true,
                        customerName: record.customer.name,
                        concern: record.customer.concern,
                      })
                      window.location.href = "/demo/lifecycle"
                    }}
                    className="mt-4 inline-flex h-11 w-full items-center justify-center gap-2 rounded-full bg-slate-950 px-5 text-sm font-black text-white transition hover:bg-slate-800"
                  >
                    Watch this record&apos;s next two years
                    <CalendarDays className="h-4 w-4" />
                  </button>
                ) : null}
              </div>
            </HandoffCard>
          ) : null}
          <AnimatedHandoffSequence workflowType={intake.workflowType} />

          <HandoffCard icon={BellRing} label={workflow.alertLabel}>
            <div className="rounded-3xl border border-cyan-200 bg-cyan-50 p-5">
              <div className="mb-4 flex items-center justify-between gap-4">
                <div>
                  <p className="text-[10px] font-black uppercase tracking-widest text-slate-500">
                    To
                  </p>
                  <p className="mt-1 text-base font-black text-slate-950">
                    {artifacts.alertPreview?.to || workflow.handoffTarget}
                  </p>
                </div>
                <span className="rounded-full border border-cyan-200 bg-white px-3 py-1 text-[10px] font-black uppercase tracking-widest text-cyan-800">
                  {artifacts.alertPreview?.delivery || "Under 60 seconds target"}
                </span>
              </div>
              <p className="text-sm font-semibold leading-relaxed text-slate-700">{alertMessage}</p>
            </div>
          </HandoffCard>

          <HandoffCard icon={DatabaseZap} label="Booking Route">
            <div className="overflow-hidden rounded-3xl border border-slate-200 bg-white">
              <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
                <div>
                  <p className="text-[10px] font-black uppercase tracking-widest text-slate-500">
                    Lead record
                  </p>
                  <p className="mt-1 text-lg font-black text-slate-950">
                    {artifacts.crmUpdate?.record || "New lead created"}
                  </p>
                </div>
                <span className="rounded-full border border-white/12 bg-slate-100 px-3 py-1 text-[10px] font-black uppercase tracking-widest text-slate-700">
                  {intake.priority}
                </span>
              </div>
              <FieldGrid fields={crmFields} compact />
              <div className="border-t border-slate-200 px-5 py-4 text-sm font-semibold leading-relaxed text-slate-700">
                {intake.crmSummary}
              </div>
            </div>
          </HandoffCard>
        </div>
      </div>

      <div className="border-t border-white/35 p-5 md:p-7">
        <div className="rounded-3xl border border-white/60 bg-white p-5 shadow-lg md:p-6">
          <div className="flex flex-col gap-5 md:flex-row md:items-center md:justify-between">
            <div>
              <p className="text-[10px] font-black uppercase tracking-[0.24em] text-teal-700">
                {workflow.handoffStatus}
              </p>
              <h4 className="mt-2 text-2xl font-black tracking-tight text-slate-950">
                Apply for the Booking & Lead Recovery Pilot
              </h4>
              <p className="mt-2 max-w-2xl text-sm font-medium leading-relaxed text-slate-600">
                Bring your company&apos;s demo. We will review the selected booking logic, routing
                language, urgent paths, and the scoped 7-day workflow for your team.
              </p>
            </div>
            <a
              href={CALENDLY_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex h-12 shrink-0 items-center justify-center gap-2 rounded-full bg-teal-700 px-6 text-sm font-black text-white transition hover:bg-teal-800"
            >
              <CalendarDays className="h-4 w-4" />
              Apply for Founding Pilot
            </a>
          </div>
        </div>
      </div>
    </motion.div>
  )
}

function AnimatedHandoffSequence({ workflowType }: { workflowType: DemoWorkflowType }) {
  const workflow = getWorkflowDefinition(workflowType)
  const steps = [
    ["Lead answered", PhoneCall],
    ["Booking context", ClipboardCheck],
    [workflowType === "water_treatment" ? "Notifying CSR / sales" : "Notifying dispatch", Send],
    ["Creating booking route", DatabaseZap],
    [workflow.handoffStatus, ShieldCheck],
  ] as const

  return (
    <HandoffCard icon={FileText} label={workflow.handoffStatus}>
      <div className="relative overflow-hidden rounded-3xl border border-slate-200 bg-slate-50 p-4">
        <motion.div
          initial={{ x: "-18%" }}
          animate={{ x: "112%" }}
          transition={{ duration: 4.5, repeat: Infinity, ease: "linear" }}
          className="pointer-events-none absolute top-1/2 h-px w-1/3 bg-gradient-to-r from-transparent via-cyan-100/80 to-transparent"
        />
        <div className="relative grid gap-3">
          {steps.map(([label, Icon], index) => (
            <motion.div
              key={label}
              initial={{ opacity: 0, x: -8 }}
              animate={{
                opacity: 1,
                x: 0,
              }}
              transition={{
                duration: 0.55,
                delay: index * 0.34,
                ease: [0.16, 1, 0.3, 1],
              }}
              className="relative flex items-center gap-3 overflow-hidden rounded-2xl border border-slate-200 bg-white px-4 py-3"
            >
              <motion.span
                className="pointer-events-none absolute inset-0 bg-cyan-200/[0.055]"
                initial={{ opacity: 0 }}
                animate={{ opacity: [0, 1, 0] }}
                transition={{
                  duration: 1.2,
                  repeat: Infinity,
                  repeatDelay: 2.05,
                  delay: index * 0.34,
                  ease: "easeInOut",
                }}
              />
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-teal-100 bg-teal-50">
                <Icon className="h-4 w-4 text-teal-700" />
              </span>
              <span className="text-sm font-black text-slate-800">{label}</span>
            </motion.div>
          ))}
        </div>
      </div>
    </HandoffCard>
  )
}

function HandoffCard({
  icon: Icon,
  label,
  children,
}: {
  icon: LucideIcon
  label: string
  children: ReactNode
}) {
  return (
    <motion.article
      initial={{ opacity: 0, y: 18 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.62, ease: [0.16, 1, 0.3, 1] }}
      className="rounded-3xl border border-white/60 bg-white p-5 shadow-[0_18px_80px_rgba(15,118,110,0.18)]"
    >
      <div className="mb-5 flex items-center justify-between gap-4">
        <div>
          <p className="text-[10px] font-black uppercase tracking-[0.24em] text-teal-700">
            {label}
          </p>
          <h4 className="mt-2 text-xl font-black tracking-tight text-slate-950">{label}</h4>
        </div>
        <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border border-teal-100 bg-teal-50">
          <Icon className="h-5 w-5 text-teal-700" />
        </span>
      </div>
      {children}
    </motion.article>
  )
}

function FieldGrid({ fields, compact = false }: { fields: string[][]; compact?: boolean }) {
  return (
    <div className={compact ? "divide-y divide-slate-200" : "grid gap-3 sm:grid-cols-2"}>
      {fields.map(([label, value]) => (
        <div
          key={label}
          className={
            compact
              ? "grid gap-2 px-5 py-3 sm:grid-cols-[145px_1fr]"
              : "rounded-2xl border border-slate-200 bg-slate-50 p-4"
          }
        >
          <p className="text-[10px] font-black uppercase tracking-widest text-slate-500">{label}</p>
          <p className="text-sm font-bold leading-relaxed text-slate-700">
            {value || NOT_CAPTURED}
          </p>
        </div>
      ))}
    </div>
  )
}

function buildAlertMessage(intake: IntakeSnapshot) {
  if (intake.workflowType === "water_treatment") {
    return [
      "Water treatment booking route ready.",
      `${intake.callerName} reports ${intake.mainConcern}.`,
      `Water source: ${intake.waterSource}.`,
      `System interest: ${intake.systemInterest}.`,
      `Timeline: ${intake.timeline}.`,
      `Callback preference: ${intake.callbackPreference}.`,
    ].join(" ")
  }
  return [
    "Well pump urgent route ready.",
    `${intake.callerName} calling about ${intake.facilityName}.`,
    `Issue: ${intake.mainConcern}.`,
    `Scope: ${intake.wholeHouseOrPartial}.`,
    `Since: ${intake.sinceWhen}.`,
    `People affected: ${intake.peopleAffected}.`,
    `Safety screen: ${intake.safetyScreen}.`,
    `Callback: ${intake.callbackNumber}.`,
  ].join(" ")
}

function isCapturedValue(value: string) {
  return Boolean(value && value !== NEEDS_CONFIRMATION && value !== NOT_CAPTURED && value !== "Not captured yet")
}

export const MemoPostCallHandoff = memo(PostCallHandoff)
