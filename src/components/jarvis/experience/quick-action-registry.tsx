"use client"

import Link from "next/link"
import { ArrowUpRight, LoaderCircle, Sparkles } from "lucide-react"
import { useState } from "react"
import { useKernel } from "../kernel/store"
import type { ExperienceQuickActionKey, ExperienceRole, TenantWorkspaceConfig } from "../lib/workspace-config"

type QuickActionDefinition = {
  label: string
  roles: ReadonlySet<ExperienceRole>
  instruction?: string
  href?: string
  instructionRoles?: ReadonlySet<ExperienceRole>
}

/** Manifest keys choose only these existing command/navigation paths. Instruction
 * shortcuts call the same kernel.submit path as typed input, so planner, target
 * resolution, authority, approvals, execution, and receipts remain unchanged. */
export const EXPERIENCE_QUICK_ACTION_REGISTRY: Record<ExperienceQuickActionKey, QuickActionDefinition> = {
  review_pending_approvals: { label: "Review pending approvals", roles: new Set(["owner", "dispatcher"]), instruction: "Show actions awaiting approval", instructionRoles: new Set(["owner"]), href: "/jarvis/work" },
  review_overdue_invoices: { label: "Review overdue invoices", roles: new Set(["owner"]), instruction: "Show overdue invoices" },
  inspect_blocked_work: { label: "Inspect blocked Work", roles: new Set(["owner", "dispatcher"]), instruction: "Show blocked Work", instructionRoles: new Set(["owner"]), href: "/jarvis/work" },
  review_pipeline: { label: "Review the pipeline", roles: new Set(["owner"]), instruction: "Show current business pipeline" },
  review_stock_risk: { label: "Review stock risk", roles: new Set(["owner"]), instruction: "Show current inventory stock risk" },
  review_schedule: { label: "Review today’s schedule", roles: new Set(["owner", "dispatcher"]), instruction: "Show today’s schedule", instructionRoles: new Set(["owner"]), href: "/jarvis/schedule" },
  review_technician_load: { label: "Review technician load", roles: new Set(["owner", "dispatcher"]), instruction: "Show current technician load", instructionRoles: new Set(["owner"]), href: "/jarvis/schedule" },
  open_my_day: { label: "Open My Day", roles: new Set(["technician"]), href: "/jarvis/schedule" },
}

type ConfiguredAction = TenantWorkspaceConfig["roles"][ExperienceRole]["ready"]["quickActions"][number]

export function RegisteredQuickActions({ actions, role }: { actions: readonly ConfiguredAction[]; role: ExperienceRole }) {
  const kernel = useKernel()
  const [busy, setBusy] = useState<ExperienceQuickActionKey | null>(null)
  const [error, setError] = useState<string | null>(null)
  const visible = actions.filter((action) => EXPERIENCE_QUICK_ACTION_REGISTRY[action.key]?.roles.has(role))
  if (visible.length === 0) return null
  const run = async (key: ExperienceQuickActionKey, instruction: string) => {
    if (busy) return
    setBusy(key); setError(null)
    try {
      const outcome = await kernel.submit(instruction, "typed")
      if (outcome !== "accepted") setError("The quick action was not accepted. Use the command composer to retry.")
    } catch {
      setError("The quick action could not reach the governed command path.")
    } finally {
      setBusy(null)
    }
  }
  return (
    <div className="jarvis-experience-actions" aria-label="Configured quick actions">
      {visible.map((action) => {
        const definition = EXPERIENCE_QUICK_ACTION_REGISTRY[action.key]
        const label = action.label ?? definition.label
        const canSubmit = Boolean(definition.instruction && (!definition.instructionRoles || definition.instructionRoles.has(role)))
        return canSubmit ? (
          <button key={action.key} type="button" disabled={busy !== null} onClick={() => void run(action.key, definition.instruction!)} data-quick-action-key={action.key}>
            {busy === action.key ? <LoaderCircle className="animate-spin" size={14} aria-hidden /> : <Sparkles size={14} aria-hidden />}{label}
          </button>
        ) : definition.href ? (
          <Link key={action.key} href={definition.href} data-quick-action-key={action.key}>{label}<ArrowUpRight size={14} aria-hidden /></Link>
        ) : null
      })}
      {error && <p role="status">{error}</p>}
    </div>
  )
}

export function isRegisteredQuickActionForRole(key: string, role: ExperienceRole): boolean {
  return Boolean(EXPERIENCE_QUICK_ACTION_REGISTRY[key as ExperienceQuickActionKey]?.roles.has(role))
}
