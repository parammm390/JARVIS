"use client"

import { motion } from "framer-motion"
import { BellRing, ClipboardList, DatabaseZap, Gauge, LucideIcon } from "lucide-react"
import type { DemoProofArtifacts } from "@/lib/demo/types"

type ProofArtifactsProps = {
  artifacts: DemoProofArtifacts
  activated?: boolean
}

export function ProofArtifacts({ artifacts, activated = false }: ProofArtifactsProps) {
  const safeArtifacts = withArtifactFallbacks(artifacts)
  const isWaterTreatment = safeArtifacts.workflowType === "water_treatment"
  const cards = [
    {
      icon: ClipboardList,
      eyebrow: "Booking context",
      title: "Action-ready call notes",
      rows: [
        ["Caller", safeArtifacts.intakeSummary.caller],
        [isWaterTreatment ? "Location" : "Service address", safeArtifacts.intakeSummary.client],
        ["Concern", safeArtifacts.intakeSummary.concern],
        [isWaterTreatment ? "Water source" : "Whole-house or partial", safeArtifacts.intakeSummary.safetyRisk],
        [isWaterTreatment ? "System interest" : "Equipment context", safeArtifacts.intakeSummary.issueType],
        [isWaterTreatment ? "Timeline" : "Safety screen", safeArtifacts.intakeSummary.immediateDanger],
        ["Callback", safeArtifacts.intakeSummary.callback],
        ["Status", safeArtifacts.intakeSummary.status],
      ],
    },
    {
      icon: BellRing,
      eyebrow: "Alert preview",
      title: isWaterTreatment ? "CSR follow-up alert" : "On-call dispatch alert",
      rows: [
        ["To", safeArtifacts.alertPreview.to],
        ["Message", safeArtifacts.alertPreview.message],
        ["Timestamp", safeArtifacts.alertPreview.timestamp],
        ["Badge", safeArtifacts.alertPreview.delivery],
      ],
    },
    {
      icon: DatabaseZap,
      eyebrow: "Record / database",
      title: "Record created",
      rows: [
        ["Record", safeArtifacts.crmUpdate.record],
        ["Fields mapped", safeArtifacts.crmUpdate.fieldsMapped.join(", ")],
        ["Status", safeArtifacts.crmUpdate.status],
        ["Priority", safeArtifacts.crmUpdate.priority],
        ["Lead type", safeArtifacts.crmUpdate.issueType],
        ["Source", safeArtifacts.crmUpdate.source],
      ],
    },
    {
      icon: Gauge,
      eyebrow: "Recovery event",
      title: "Operational route",
      rows: [
        ["Response time", safeArtifacts.dashboardEvent.responseTime],
        ["Booking context ready", safeArtifacts.dashboardEvent.intakeCaptured],
        ["Human owner", safeArtifacts.dashboardEvent.humanOwner],
        ["Follow-up required", safeArtifacts.dashboardEvent.followUpNeeded],
        ["Audit trail logged", safeArtifacts.dashboardEvent.auditTrail],
      ],
    },
  ]

  return (
    <section className="relative overflow-hidden border-t border-slate-200 py-20 md:py-28">
      <div className="absolute bottom-0 right-0 h-[520px] w-[520px] rounded-full bg-sky-100/70 blur-[140px]" />
      <div className="container relative z-10 px-4 md:px-6">
        <div className="mb-12 flex flex-col justify-between gap-6 md:flex-row md:items-end">
          <div className="max-w-3xl">
            <motion.div
              initial={{ opacity: 0, y: 18 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              className="mb-6 inline-flex items-center rounded-full border border-slate-200 bg-white/72 px-4 py-1.5 text-xs font-black uppercase tracking-widest text-slate-500"
            >
              <span
                className={`mr-2 h-1.5 w-1.5 rounded-full ${
                  activated ? "bg-teal-500 shadow-[0_0_16px_rgba(20,184,166,0.22)]" : "bg-slate-300"
                }`}
              />
              {activated ? "Updated from call" : "Proof artifacts"}
            </motion.div>
            <motion.h2
              initial={{ opacity: 0, y: 22 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              className="text-4xl font-black tracking-tight text-slate-950 md:text-6xl"
            >
              What the team gets after the call
            </motion.h2>
          </div>
          <motion.p
            initial={{ opacity: 0, y: 18 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ delay: 0.1 }}
            className="max-w-md text-base font-medium leading-relaxed text-slate-600 md:text-right"
          >
            These are demo artifacts, but they reflect the operational objects FINNOR creates:
            booking context, alerts, records, and logged recovery events.
          </motion.p>
        </div>

        <div className="grid gap-5 lg:grid-cols-2">
          {cards.map((card, index) => (
            <ProofCard key={card.eyebrow} card={card} index={index} />
          ))}
        </div>
      </div>
    </section>
  )
}

function withArtifactFallbacks(artifacts: DemoProofArtifacts): DemoProofArtifacts {
  if (artifacts.workflowType === "well_pump_emergency") {
    return {
      workflowType: artifacts.workflowType,
      intakeSummary: {
        caller: artifacts.intakeSummary?.caller || "Sarah",
        client: artifacts.intakeSummary?.client || "142 Millbrook Road, Harrisonburg VA",
        concern: artifacts.intakeSummary?.concern || "No water / zero pressure",
        safetyRisk: artifacts.intakeSummary?.safetyRisk || "Whole house",
        issueType:
          artifacts.intakeSummary?.issueType || "Submersible well pump and pressure tank",
        immediateDanger:
          artifacts.intakeSummary?.immediateDanger || "No immediate danger reported",
        callback: artifacts.intakeSummary?.callback || "Collected",
        status: artifacts.intakeSummary?.status || "Ready for on-call dispatch",
      },
      alertPreview: {
        to: artifacts.alertPreview?.to || "On-call dispatch",
        message:
          artifacts.alertPreview?.message ||
          "Well pump urgent route ready. Whole house without water since 11pm. Family of 4 affected. Safety screen complete. Ready for on-call dispatch.",
        timestamp: artifacts.alertPreview?.timestamp || "Dispatch alert",
        delivery: artifacts.alertPreview?.delivery || "Under 60 seconds target",
      },
      crmUpdate: {
        record: artifacts.crmUpdate?.record || "New emergency dispatch record",
        fieldsMapped:
          artifacts.crmUpdate?.fieldsMapped?.length
            ? artifacts.crmUpdate.fieldsMapped
            : [
                "Caller name",
                "Service address",
                "No-water / low-pressure issue",
                "Whole-house or partial",
                "Since when",
                "People affected",
                "Safety screen",
                "Callback number",
              ],
        status: artifacts.crmUpdate?.status || "Ready for on-call dispatch",
        priority: artifacts.crmUpdate?.priority || "High",
        issueType: artifacts.crmUpdate?.issueType || "Well pump / no-water emergency",
        source: artifacts.crmUpdate?.source || "Voice AI",
      },
      dashboardEvent: {
        responseTime: artifacts.dashboardEvent?.responseTime || "Under 60 seconds target",
        intakeCaptured: artifacts.dashboardEvent?.intakeCaptured || "Yes",
        followUpNeeded: artifacts.dashboardEvent?.followUpNeeded || "Yes",
        humanOwner: artifacts.dashboardEvent?.humanOwner || "On-call dispatch",
        auditTrail: artifacts.dashboardEvent?.auditTrail || "Yes",
      },
    }
  }

  return {
    workflowType: "water_treatment",
    intakeSummary: {
      caller: artifacts.intakeSummary?.caller || "Jennifer",
      client: artifacts.intakeSummary?.client || "142 Millbrook Road, Harrisonburg VA",
      concern: artifacts.intakeSummary?.concern || "Sulfur smell and hard water",
      safetyRisk: artifacts.intakeSummary?.safetyRisk || "Well water",
      issueType:
        artifacts.intakeSummary?.issueType || "Water softener and whole-house filtration",
      immediateDanger: artifacts.intakeSummary?.immediateDanger || "Within the next few weeks",
      callback: artifacts.intakeSummary?.callback || "Collected",
      status: artifacts.intakeSummary?.status || "Ready for CSR follow-up",
    },
    alertPreview: {
      to: "CSR / sales team",
      message:
        artifacts.alertPreview?.message ||
        "Water treatment booking route ready. Homeowner is on well water and reports sulfur smell plus hard water. Interested in softener and whole-house filtration. Timeline and callback preference confirmed. Ready for CSR follow-up.",
      timestamp: artifacts.alertPreview?.timestamp || "Water treatment lead event",
      delivery: artifacts.alertPreview?.delivery || "Under 60 seconds target",
    },
    crmUpdate: {
      record: "New water treatment lead created",
      fieldsMapped:
        artifacts.crmUpdate?.fieldsMapped?.length
          ? artifacts.crmUpdate.fieldsMapped
          : ["Caller name", "Callback", "Address", "Water source", "Water concern", "System interest", "Timeline", "Lead source"],
      status: artifacts.crmUpdate?.status || "Ready for CSR follow-up",
      priority: artifacts.crmUpdate?.priority || "Standard",
      issueType: artifacts.crmUpdate?.issueType || "Water treatment lead",
      source: artifacts.crmUpdate?.source || "Voice AI",
    },
    dashboardEvent: {
      responseTime: artifacts.dashboardEvent?.responseTime || "Under 60 seconds target",
      intakeCaptured: artifacts.dashboardEvent?.intakeCaptured || "Yes",
      followUpNeeded: artifacts.dashboardEvent?.followUpNeeded || "Yes",
      humanOwner: "CSR / sales team",
      auditTrail: artifacts.dashboardEvent?.auditTrail || "Yes",
    },
  }
}

function ProofCard({
  card,
  index,
}: {
  card: {
    icon: LucideIcon
    eyebrow: string
    title: string
    rows: string[][]
  }
  index: number
}) {
  const Icon = card.icon

  return (
    <motion.article
      initial={{ opacity: 0, y: 24 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-80px" }}
      transition={{ delay: index * 0.07, duration: 0.65, ease: [0.16, 1, 0.3, 1] }}
      className="ops-card ops-card-hover group relative overflow-hidden rounded-3xl bg-white/84 p-6 md:p-7"
    >
      <div className="absolute right-0 top-0 h-48 w-48 rounded-full bg-sky-100/75 blur-[80px] opacity-0 transition-opacity duration-500 group-hover:opacity-100" />
      <div className="relative z-10">
        <div className="mb-6 flex items-center justify-between gap-4">
          <div>
            <p className="text-xs font-black uppercase tracking-[0.24em] text-slate-600">
              {card.eyebrow}
            </p>
            <h3 className="mt-2 text-2xl font-black tracking-tight text-slate-950">{card.title}</h3>
          </div>
          <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl border border-sky-100 bg-sky-50">
            <Icon className="h-6 w-6 text-sky-700" />
          </div>
        </div>

        <div className="space-y-3">
          {card.rows.map(([label, value]) => (
            <div
              key={label}
              className="grid gap-2 rounded-2xl border border-slate-200 bg-white/78 p-3 sm:grid-cols-[150px_1fr]"
            >
              <span className="text-[10px] font-black uppercase tracking-widest text-slate-600">
                {label}
              </span>
              <span className="text-sm font-semibold leading-relaxed text-slate-600">{value}</span>
            </div>
          ))}
        </div>
      </div>
    </motion.article>
  )
}
