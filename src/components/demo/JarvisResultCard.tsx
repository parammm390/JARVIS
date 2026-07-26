"use client"

// M4.T2 — the merged demo's new termination point (docs/marketing-demo-merge-contract.md
// Act 1 §1-4). Replaces PostCallHandoff.tsx's plain teal "Booking Route" card with a
// real JARVIS-styled Approval Cockpit card: the same `ActionRenderer`/`RiskBadge`
// components the authenticated console renders approvals with, reused unmodified,
// wrapped in a `JarvisProofSurface` and explicitly labeled DEMO — never implying a
// real action executes.
//
// Mapping rule (contract-required, documented here rather than guessed at call time):
//   - water_treatment  -> generate_quote (quotation plugin's own real payload shape:
//     householdLabel, items[], notes) — the call was a quote/system-interest inquiry.
//   - well_pump_emergency -> assign_technician_to_visit (scheduling plugin) — the call
//     was a dispatch request. That flagship's real payload is only {visitId,
//     technicianName}, so the richer captured fields (danger, since-when, people
//     affected) have no clean counterpart inside it; per the contract they render
//     separately below as a labeled grid instead of being invented into the action
//     payload or silently dropped.
// Risk tier rule (a demo heuristic, not a real risk model — never presented as one):
//   well_pump_emergency with immediateDanger === "Yes" -> high; well_pump_emergency
//   otherwise -> medium (it's already an emergency line); water_treatment -> low
//   (a standard quote/system-interest inquiry, nothing time-critical).

import { CheckCircle2, Sparkles } from "lucide-react"
import { CalendarDays } from "lucide-react"
import type { DemoIntakeHandoff } from "@/lib/demo/types"
import { NEEDS_CONFIRMATION, NOT_CAPTURED } from "@/lib/demo/intake-extraction"
import { JarvisProofSurface } from "@/components/sections/jarvis-proof/JarvisProofSurface"
import { Glass } from "@/components/jarvis/atmosphere"
import { RiskBadge, type RiskTier } from "@/components/jarvis/ui/primitives/RiskBadge"
import { ActionRenderer } from "@/components/jarvis/ui/renderers/ActionRenderer"
import { writeLifecycleHandoff } from "@/lib/memory/handoff"

function isCaptured(value: string) {
  return Boolean(value && value !== NEEDS_CONFIRMATION && value !== NOT_CAPTURED && value !== "Not captured yet")
}

function riskTierFor(intake: DemoIntakeHandoff): RiskTier {
  if (intake.workflowType === "well_pump_emergency") {
    return intake.immediateDanger === "Yes" ? "high" : "medium"
  }
  return "low"
}

function actionFor(intake: DemoIntakeHandoff): { actionType: string; payload: Record<string, unknown> } {
  if (intake.workflowType === "well_pump_emergency") {
    return {
      actionType: "assign_technician_to_visit",
      payload: {
        visitId: "demo-preview",
        technicianName: "Next available on-call technician",
      },
    }
  }
  const items = [intake.systemInterest, intake.timeline]
    .filter(isCaptured)
    .filter((v) => v !== "Not captured yet")
  return {
    actionType: "generate_quote",
    payload: {
      householdLabel: isCaptured(intake.callerName) ? intake.callerName : "this household",
      items: items.length ? items : ["System interest not yet captured on the call"],
      notes: isCaptured(intake.mainConcern) ? intake.mainConcern : undefined,
    },
  }
}

function capturedFieldsFor(intake: DemoIntakeHandoff): Array<[string, string]> {
  if (intake.workflowType === "well_pump_emergency") {
    return [
      ["Caller", intake.callerName],
      ["Service address", intake.facilityName],
      ["Issue", intake.mainConcern],
      ["Whole-house or partial", intake.wholeHouseOrPartial],
      ["Since when", intake.sinceWhen],
      ["People affected", intake.peopleAffected],
      ["Immediate danger", intake.immediateDanger],
      ["Callback", intake.callbackNumber],
    ]
  }
  return [
    ["Caller", intake.callerName],
    ["Location", intake.facilityName],
    ["Water source", intake.waterSource],
    ["Concern", intake.mainConcern],
    ["System interest", intake.systemInterest],
    ["Timeline", intake.timeline],
    ["Callback preference", intake.callbackPreference],
  ]
}

export function JarvisResultCard({
  companyName,
  intake,
}: {
  companyName: string
  intake: DemoIntakeHandoff
}) {
  const tier = riskTierFor(intake)
  const { actionType, payload } = actionFor(intake)
  const fields = capturedFieldsFor(intake)

  return (
    <div className="mt-8">
      <JarvisProofSurface className="overflow-hidden rounded-[2rem] border border-white/10 shadow-[0_30px_120px_rgba(8,24,39,0.35)]">
        <div className="border-b border-white/10 p-5 md:p-7">
          <div className="flex flex-wrap items-center gap-3">
            <span className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.05] px-4 py-1.5 text-[10px] font-black uppercase tracking-[0.22em] text-[color:var(--j-cyan)]">
              <Sparkles className="h-3.5 w-3.5" />
              Sample — here&apos;s what JARVIS would draft from that call
            </span>
            <RiskBadge tier={tier} />
          </div>
          <h3 className="mt-4 text-2xl font-black tracking-tight text-[color:var(--j-text)] md:text-3xl">
            {companyName}&apos;s draft, held for approval
          </h3>
          <p className="mt-2 max-w-2xl text-sm font-medium leading-relaxed text-[color:var(--j-text-dim)]">
            This is not a real approval and nothing here executes — it&apos;s the same card shape a
            real JARVIS approval uses, built from what the call actually captured.
          </p>
        </div>

        <div className="grid gap-5 p-5 md:p-7 lg:grid-cols-[0.9fr_1.1fr]">
          <div>
            <p className="mb-3 text-xs font-black uppercase tracking-widest text-[color:var(--j-text-dim)]">
              Proposed action
            </p>
            <ActionRenderer actionType={actionType} payload={payload} compact={false} />
          </div>

          <div>
            <p className="mb-3 text-xs font-black uppercase tracking-widest text-[color:var(--j-text-dim)]">
              What the call captured
            </p>
            <Glass className="rounded-2xl" noise>
              <div className="grid gap-3 p-4 sm:grid-cols-2">
                {fields.map(([label, value]) => (
                  <div key={label} className="rounded-xl border border-white/10 bg-white/[0.03] p-3">
                    <div className="mb-1.5 flex items-center gap-2 text-[10px] font-black uppercase tracking-widest text-[color:var(--j-text-dim)]">
                      <CheckCircle2
                        className={`h-3.5 w-3.5 ${isCaptured(value) ? "text-[color:var(--j-teal)]" : "text-white/20"}`}
                      />
                      {label}
                    </div>
                    <p className="text-sm font-semibold leading-relaxed text-[color:var(--j-text)]">
                      {value || NOT_CAPTURED}
                    </p>
                  </div>
                ))}
              </div>
            </Glass>
          </div>
        </div>

        {intake.household ? (
          <div className="border-t border-white/10 p-5 md:p-7">
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
              className="inline-flex h-12 items-center justify-center gap-2 rounded-full bg-[color:var(--j-cyan)] px-6 text-sm font-black text-[#03141c] transition hover:brightness-110"
            >
              Watch this record&apos;s next two years
              <CalendarDays className="h-4 w-4" />
            </button>
          </div>
        ) : null}
      </JarvisProofSurface>
    </div>
  )
}
