"use client"

// First-run posture is intentionally a read-only view of the two sanity-lane
// contracts. It never guesses a capability is ready, and it does not pretend a
// local control can configure a provider when configuration remains external.

import { useLanePresentation } from "../kernel/useSelectorInput"
import { PermissionVeil } from "../ui/primitives/PermissionVeil"
import { JARVIS_SETUP_HREF } from "./setup-link"

function readable(value: string): string {
  return value.replaceAll("_", " ")
}

export function FirstRunScene() {
  const { setupStatus, setupDegraded, integrationsStatus, integrationsDegraded } = useLanePresentation()

  if (setupDegraded || integrationsDegraded || !setupStatus || !integrationsStatus) {
    return (
      <section className="mx-auto max-w-[720px] px-4 pt-8" aria-label="Setup status">
        <div className="j-panel rounded-2xl border border-amber-300/20 bg-amber-300/[.04] p-4">
          <p className="j-fs-micro font-black uppercase tracking-[0.16em] text-amber-200">Setup status unavailable</p>
          <p className="mt-1 j-fs-sm text-[color:var(--j-text-dim)]">JARVIS cannot name a next setup action until the live setup and integration checks return.</p>
        </div>
      </section>
    )
  }

  const nextAction = setupStatus.actionTypes.find((entry) => entry.status !== "configured")
  const providers = Object.entries(integrationsStatus)
    .filter(([key, value]) => key !== "bindings" && key !== "summary" && typeof value === "object" && value !== null && "configured" in value)
    .filter(([, value]) => !(value as { configured: boolean }).configured)
    .map(([key]) => key)

  if (!nextAction && providers.length === 0) return null

  return (
    <section className="mx-auto max-w-[720px] px-4 pt-8" aria-label="First-run setup">
      <div className="j-panel rounded-2xl border border-cyan-300/20 bg-cyan-300/[.035] p-4">
        <p className="j-fs-micro font-black uppercase tracking-[0.16em] text-cyan-200">First-run setup</p>
        {nextAction ? (
          <div className="mt-2">
            <p className="j-fs-sm font-bold text-[color:var(--j-text)]">Next action: configure {readable(nextAction.actionType)}</p>
            <p className="mt-1 j-fs-micro text-[color:var(--j-text-dim)]">
              {nextAction.pluginName} reports this action as {nextAction.status}. {nextAction.hasPolicyRow ? "A policy row is present." : "A policy row is not present."}
              {nextAction.requiresConfirmation ? " It requires confirmation." : " It does not require confirmation."}
            </p>
          </div>
        ) : (
          <p className="mt-2 j-fs-sm text-[color:var(--j-text-dim)]">All action types report configured.</p>
        )}
        {providers.length > 0 && (
          <div className="mt-3">
            <PermissionVeil
              reason={`Not connected — add credentials to activate: ${providers.map(readable).join(", ")}.`}
              actionLabel="Connect"
              actionHref={JARVIS_SETUP_HREF}
            />
          </div>
        )}
      </div>
    </section>
  )
}
