"use client"

import { Boxes, CalendarDays, CircleDollarSign, Radar, UsersRound, Wrench } from "lucide-react"
import { BusinessWorldScene } from "../BusinessWorldScene"
import { useWorkspaceConfig } from "../WorkspaceConfigProvider"
import type { BusinessScene } from "../lib/projection-definitions"
import type { ExperienceRole } from "../lib/workspace-config"
import { ExperienceSlot } from "./extension-registry"
import { RegisteredMetricStrip } from "./metric-registry"
import { RegisteredQuickActions } from "./quick-action-registry"

const FOCUS_COPY = {
  operational_attention: { title: "What needs attention now", copy: "Canonical Work is ranked below; no outcome is inferred before recorded evidence exists.", icon: Radar },
  cash: { title: "Cash pressure and movement", copy: "Source-backed money signals lead this tenant’s Ready state.", icon: CircleDollarSign },
  dispatch: { title: "The field, today", copy: "Schedule and assigned-load projections lead this tenant’s Ready state.", icon: CalendarDays },
  pipeline: { title: "Pipeline movement", copy: "Canonical customer and opportunity signals lead this tenant’s Ready state.", icon: UsersRound },
  service: { title: "Service continuity", copy: "Service attention is emphasized while FINNOR Work remains authoritative.", icon: Wrench },
  inventory: { title: "Installation readiness", copy: "Canonical stock-risk context leads this tenant’s Ready state.", icon: Boxes },
  assigned_work: { title: "Your assigned day", copy: "Only work visible through the signed-in technician’s backend scope is shown.", icon: Wrench },
} as const

const BUSINESS_SCENE_BY_PROJECTION: Partial<Record<string, BusinessScene>> = {
  customer: "customer",
  schedule: "schedule",
  money: "money",
  work: "work",
  inventory: "inventory",
  computer: "computer",
}

/** Config-driven Ready composition. Every number comes from an existing Truth
 * selector/read model and every command shortcut enters the existing kernel. */
export function TenantReadyExperience({ role, compact = false }: { role: ExperienceRole; compact?: boolean }) {
  const { config } = useWorkspaceConfig()
  const ready = config.roles[role].ready
  const focus = FOCUS_COPY[ready.primaryFocus]
  const Icon = focus.icon
  const businessScene = BUSINESS_SCENE_BY_PROJECTION[ready.primaryProjection]
  const context = { role, scene: "ready" as const, vocabulary: config.vocabulary, primaryProjection: ready.primaryProjection, activeWork: null }
  return (
    <section className="jarvis-tenant-ready" data-tenant-ready-role={role} data-ready-focus={ready.primaryFocus} data-compact={compact ? "true" : undefined}>
      <header><span><Icon size={15} aria-hidden /> Configured Ready focus</span><h2>{focus.title}</h2><p>{focus.copy}</p></header>
      <ExperienceSlot slot="ready.primary" context={context} />
      <ExperienceSlot slot={`role.${role}` as const} context={context} />
      <RegisteredMetricStrip keys={ready.pulseMetrics} heroKey={ready.heroMetric} role={role} />
      <RegisteredQuickActions actions={ready.quickActions} role={role} />
      {!compact && businessScene ? <BusinessWorldScene scene={businessScene} /> : null}
      <ExperienceSlot slot="ready.secondary" context={context} />
    </section>
  )
}
