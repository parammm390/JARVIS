"use client"

// P1.T4 — Setup Rail. First-run posture is intentionally a read-only view of the
// two sanity-lane contracts. It never guesses a capability is ready, and it does
// not pretend a local control can configure a provider when configuration remains
// external.

import Link from "next/link"
import { useLanePresentation } from "../kernel/useSelectorInput"
import { JARVIS_SETUP_HREF } from "./setup-link"

const HUMAN_LABELS: Record<string, string> = {
  meta_ads: "Meta Ads",
  google_ads: "Google Ads",
  quickbooks: "QuickBooks",
  vapi: "Vapi",
  ghl: "GHL",
  stripe: "Stripe",
  docusign: "DocuSign",
  start_invoice_to_cash_workflow: "Invoice to cash workflow",
  schedule_water_test: "Schedule water test",
  gated_by_choice: "gated by choice",
}

function humanize(value: string): string {
  const known = HUMAN_LABELS[value]
  if (known) return known
  const words = value.replaceAll("_", " ").replaceAll("-", " ").split(" ").filter(Boolean)
  return words.map((word, index) => index === 0 ? `${word.charAt(0).toUpperCase()}${word.slice(1).toLowerCase()}` : word.toLowerCase()).join(" ")
}

function SetupAction({ children }: { children: React.ReactNode }) {
  return (
    <Link
      href={JARVIS_SETUP_HREF}
      className="inline-flex min-h-11 shrink-0 items-center justify-center rounded-xl border border-white/10 bg-white/[.04] px-3 j-fs-micro font-black text-[color:var(--j-text)] transition hover:border-cyan-200/60 hover:bg-cyan-300/[.08]"
    >
      {children}
    </Link>
  )
}

export function SetupRail() {
  const { setupStatus, setupDegraded, integrationsStatus, integrationsDegraded } = useLanePresentation()

  if (setupDegraded || integrationsDegraded || !setupStatus || !integrationsStatus) {
    return (
      <section className="mx-auto max-w-[720px] px-4 pt-4" aria-label="Setup rail" data-jarvis-setup-rail data-setup-state="unavailable">
        <div className="j-panel rounded-2xl border border-white/10 bg-white/[.025] p-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0 flex-1">
              <p className="j-fs-sm font-bold text-[color:var(--j-text)]">Capability status needs a refresh.</p>
              <p className="mt-1 j-fs-micro text-amber-100/80">Safe work remains available; provider-dependent actions will stay gated until setup truth returns.</p>
            </div>
            <SetupAction>Review setup</SetupAction>
            <span className="inline-flex min-h-11 min-w-[8.5rem] shrink-0 items-center justify-center rounded-xl border border-white/10 px-3 j-fs-micro font-black text-[color:var(--j-text-faint)]" aria-label="Setup details unavailable">Details unavailable</span>
          </div>
        </div>
      </section>
    )
  }

  const actionTypes = setupStatus.actionTypes.filter((entry) => entry.status !== "configured")
  const providerEntries = Object.entries(integrationsStatus)
    .filter(([key, value]) => key !== "bindings" && key !== "summary" && typeof value === "object" && value !== null && "configured" in value)
  const providersNeedingAttention = providerEntries.filter(([, value]) => {
    const health = value as { configured: boolean; healthy: boolean | null }
    return !health.configured || health.healthy === false
  })

  if (actionTypes.length === 0 && providersNeedingAttention.length === 0) return null

  const connectionsNeedingAttention = providersNeedingAttention.length
  const connectionCopy = `${connectionsNeedingAttention} connection${connectionsNeedingAttention === 1 ? "" : "s"} ${connectionsNeedingAttention === 1 ? "needs" : "need"} attention.`

  return (
    <section className="mx-auto max-w-[720px] px-4 pt-4" aria-label="Setup rail" data-jarvis-setup-rail data-setup-state="attention" data-connections-needing-attention={connectionsNeedingAttention}>
      <div className="j-panel rounded-2xl border border-white/10 bg-white/[.025] p-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0 flex-1">
              <p className="j-fs-sm font-bold text-[color:var(--j-text)]">Some connected capabilities need attention.</p>
              <p className="mt-1 j-fs-micro text-[color:var(--j-text-dim)]">{connectionCopy}</p>
            </div>
            <SetupAction>Review setup</SetupAction>
            <details className="relative shrink-0">
              <summary className="inline-flex min-h-11 min-w-[8.5rem] cursor-pointer list-none items-center justify-center rounded-xl border border-white/10 px-3 j-fs-micro font-black text-[color:var(--j-text-dim)] hover:text-cyan-100">View setup details</summary>
              <div className="absolute right-0 top-full z-30 mt-2 w-[min(24rem,calc(100vw-2rem))] rounded-2xl border border-white/10 bg-[#07101d]/[.98] p-3 text-left shadow-[0_16px_48px_rgba(0,0,0,0.45)] backdrop-blur-xl">
                <div className="grid gap-3 sm:grid-cols-2">
                  {providersNeedingAttention.length > 0 && (
                    <div>
                      <p className="j-fs-micro font-bold text-[color:var(--j-text-faint)]">Connections</p>
                      <ul className="mt-1 space-y-1">
                        {providersNeedingAttention.map(([key, value]) => {
                          const health = value as { configured: boolean; healthy: boolean | null }
                          const state = health.configured && health.healthy === false ? "Health check failed" : "Not connected"
                          return <li key={key} className="j-fs-micro text-[color:var(--j-text-dim)]">{humanize(key)} · {state}</li>
                        })}
                      </ul>
                    </div>
                  )}
                  {actionTypes.length > 0 && (
                    <div>
                      <p className="j-fs-micro font-bold text-[color:var(--j-text-faint)]">Action types</p>
                      <ul className="mt-1 space-y-1">
                        {actionTypes.map((entry) => (
                          <li key={entry.actionType} className="j-fs-micro text-[color:var(--j-text-dim)]">
                            {humanize(entry.actionType)} · {humanize(entry.status)}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              </div>
            </details>
          </div>
        </div>
      </section>
  )
}

/** Backward-compatible export for older local imports; the canonical bridge uses SetupRail. */
export const FirstRunScene = SetupRail
