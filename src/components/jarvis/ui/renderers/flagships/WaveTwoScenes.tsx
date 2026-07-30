"use client"

// D7.T1 — the second renderer wave. These scenes only visualize fields that are
// actually on the proposed action payload; they never imply an emulator, document,
// source, deadline, or household record exists when it has not been supplied.

import { motion, useReducedMotion } from "framer-motion"
import type { ReactNode } from "react"
import { FileText, Globe2, HeartPulse, Megaphone, ShieldCheck, Wrench } from "lucide-react"
import { Panel, StatusDot } from "../../primitives"
import { Enter } from "../../motion/primitives"
import type { ActionRendererProps } from "../types"

const text = (v: unknown, fallback = "Not provided") => typeof v === "string" && v.trim() ? v : fallback
const num = (v: unknown) => typeof v === "number" && Number.isFinite(v) ? v : null

function Chrome({ children, label, icon: Icon, compact }: { children: ReactNode; label: string; icon: typeof Globe2; compact?: boolean }) {
  return <Panel className={compact ? "p-2.5" : "p-4"}><div className="mb-2 flex items-center gap-2"><Icon className="h-3.5 w-3.5 text-cyan-300" /><span className="j-label">{label}</span></div>{children}</Panel>
}

export function MaintenanceScene({ payload, compact }: ActionRendererProps) {
  const p = payload as Record<string, unknown>; const reduced = useReducedMotion(); const cadence = text(p.cadence, "annual");
  return <Chrome label="Maintenance agreement" icon={HeartPulse} compact={compact}><div className="flex items-center gap-3"><motion.div className="grid h-12 w-12 shrink-0 place-items-center rounded-full border-2 border-teal-300/60 j-fs-micro font-black text-teal-100" animate={reduced ? {} : { rotate: 360 }} transition={{ duration: 12, repeat: Infinity, ease: "linear" }}><span>AMC</span></motion.div><div className="min-w-0"><div className="truncate j-fs-sm font-bold text-white">{text(p.householdLabel)}</div><div className="j-fs-micro text-white/50">{cadence} renewal · confirmation required</div></div></div></Chrome>
}

export function ResearchScene({ actionType, payload, compact }: ActionRendererProps) {
  const p = payload as Record<string, unknown>; const query = text(p.query, actionType === "scan_competitors" ? `${text(p.focus)} in ${text(p.area)}` : `${text(p.businessName)} reviews in ${text(p.area)}`);
  return <Chrome label="Web research" icon={Globe2} compact={compact}><div className="rounded-lg border border-violet-300/20 bg-violet-300/[.05] p-2"><div className="j-fs-micro font-bold text-violet-100">{query}</div><div className="mt-1 j-fs-micro text-white/45">Sources and extracted claims appear only after the real research action completes.</div></div></Chrome>
}

export function OpsOverviewScene({ payload, compact }: ActionRendererProps) {
  const p = payload as Record<string, unknown>; const question = typeof p.question === "string" ? p.question : null;
  return <Chrome label="Operations overview" icon={HeartPulse} compact={compact}><div className="grid grid-cols-3 gap-1.5">{["Pipeline", "Cash", "Visits"].map((label) => <div key={label} className="rounded-lg border border-white/8 bg-white/[.025] p-2"><div className="j-fs-micro uppercase tracking-wider text-white/40">{label}</div><div className="mt-1 j-fs-micro font-bold text-cyan-100">live tile</div></div>)}</div><p className="mt-2 j-fs-micro text-white/55">{question ? question : `Focus: ${text(p.focus, "current operations")}`}</p></Chrome>
}

export function ReminderScene({ payload, compact }: ActionRendererProps) {
  const p = payload as Record<string, unknown>; return <Chrome label="Service reminder" icon={Wrench} compact={compact}><div className="flex items-center gap-2 j-fs-micro"><span className="h-2 w-2 rounded-full bg-teal-300"/><span className="text-white/75">Last serviced: {text(p.lastServicedAt)}</span><span className="h-px flex-1 bg-teal-300/30"/><span className="text-amber-200">due check</span></div><div className="mt-2 j-fs-micro font-semibold text-white">{text(p.equipmentType)} </div></Chrome>
}

export function TechnicianReportScene({ actionType, payload, compact }: ActionRendererProps) {
  const p = payload as Record<string, unknown>; const report = text(actionType === "flag_visit_issue" ? p.issue : p.report);
  return <Chrome label="Technician report" icon={Wrench} compact={compact}><div className="border-l-2 border-cyan-300/70 pl-2.5 j-fs-micro leading-relaxed text-white/75">{report}</div>{actionType === "log_visit_report" && <div className="mt-2 flex items-center gap-1.5 j-fs-micro text-teal-200"><StatusDot status="ok" />{p.markCompleted === true ? "Completion requested" : "Report only"}</div>}</Chrome>
}

export function ComplianceScene({ payload, compact }: ActionRendererProps) {
  const p = payload as Record<string, unknown>; const profile = p.waterProfile && typeof p.waterProfile === "object" ? Object.entries(p.waterProfile as Record<string, unknown>) : [];
  return <Chrome label="Compliance document" icon={ShieldCheck} compact={compact}><div className="rounded-lg border border-amber-300/20 bg-amber-300/[.04] p-2"><div className="flex items-center justify-between j-fs-micro font-bold text-amber-100"><span>{text(p.householdLabel)}</span><span>preview 1 / 1</span></div><div className="mt-2 space-y-1">{profile.slice(0, 3).map(([key, value]) => <div key={key} className="flex justify-between j-fs-micro text-white/55"><span>{key.replaceAll("_", " ")}</span><span>{String(value)}</span></div>)}</div></div><p className="mt-2 j-fs-micro text-white/40">Generated document is available only after execution.</p></Chrome>
}

export function MarketingScene({ actionType, payload, compact }: ActionRendererProps) {
  const p = payload as Record<string, unknown>; const label = actionType === "launch_ad_campaign" ? text(p.name) : actionType === "create_review_request" ? `Review request · ${text(p.contactName)}` : `Performance · ${num(p.windowDays) ?? "?"} days`;
  return <Chrome label="Marketing" icon={Megaphone} compact={compact}><div className="flex items-center justify-between gap-2"><div className="min-w-0 truncate j-fs-micro font-bold text-white">{label}</div><span className="shrink-0 rounded-full border border-violet-300/30 bg-violet-300/10 px-1.5 py-0.5 j-fs-micro font-black text-violet-200">EMU</span></div><p className="mt-1.5 j-fs-micro text-white/45">Emulator/sandbox status is explicit; no campaign or request has been sent by this proposal.</p></Chrome>
}

export function WaveTwoScene(props: ActionRendererProps) {
  switch (props.actionType) {
    case "renew_maintenance_agreement": return <MaintenanceScene {...props} />
    case "search_web": case "scan_competitors": case "check_business_reviews": return <ResearchScene {...props} />
    case "get_business_overview": case "answer_business_question": return <OpsOverviewScene {...props} />
    case "check_reminder_due": return <ReminderScene {...props} />
    case "log_visit_report": case "flag_visit_issue": return <TechnicianReportScene {...props} />
    case "generate_compliance_summary": return <ComplianceScene {...props} />
    case "summarize_ad_performance": case "launch_ad_campaign": case "create_review_request": return <MarketingScene {...props} />
    default: return <Chrome label="Action scene" icon={FileText} compact={props.compact}><Enter><span className="j-fs-micro text-white/60">{props.actionType}</span></Enter></Chrome>
  }
}
