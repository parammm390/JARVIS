"use client"

import Link from "next/link"
import { useState } from "react"
import { recoveryPresentation } from "../kernel/recovery"
import type { RecoveryKind } from "../kernel/types"
import { JARVIS_SETUP_HREF } from "./setup-link"

/** §6.8's one visible recovery path for a failed step or receipt. The caller
 * supplies an action only when a real, authoritative operation is available;
 * no inert action is presented as a working recovery. */
export function RecoveryPanel({
  kind,
  onRecover,
  setupHref,
  errorDetail,
}: {
  kind: RecoveryKind
  onRecover?: () => Promise<void>
  setupHref?: string
  errorDetail?: string
}) {
  const recovery = recoveryPresentation(kind)
  const [recovering, setRecovering] = useState(false)
  const [recoverError, setRecoverError] = useState<string | null>(null)
  async function recover() {
    if (!onRecover || recovering) return
    setRecovering(true)
    setRecoverError(null)
    try {
      await onRecover()
    } catch (error) {
      setRecoverError(error instanceof Error ? error.message : "Recovery request failed")
    } finally {
      setRecovering(false)
    }
  }
  const action = recovery.affordance === "Connect"
    ? <Link href={setupHref ?? JARVIS_SETUP_HREF} data-recovery-affordance={recovery.affordance} className="inline-flex min-h-12 items-center rounded-full border border-cyan-400/30 px-3 py-1.5 j-fs-micro font-bold text-cyan-200 hover:border-cyan-400/60 hover:bg-cyan-400/10">{recovery.affordance}</Link>
      : onRecover
      ? <button type="button" autoFocus disabled={recovering} onClick={() => { void recover() }} data-recovery-affordance={recovery.affordance} className="inline-flex min-h-12 items-center rounded-full border border-red-300/30 px-3 py-1.5 j-fs-micro font-bold text-red-100 hover:border-red-300/60 hover:bg-red-300/10 disabled:cursor-not-allowed disabled:opacity-50">{recovery.affordance}</button>
      : null

  return (
    <section className="rounded-xl border border-red-400/25 bg-red-400/5 p-3" aria-label={`Recovery: ${kind}`} data-liveframe-motion="LF-13" data-recovery-kind={kind}>
      <p className="j-fs-sm font-bold text-red-100">{recovery.copy}</p>
      {action && <div className="mt-2">{action}</div>}
      {recoverError && <p role="alert" className="mt-2 j-fs-micro text-red-100/80">{recoverError}</p>}
      {errorDetail && (
        <details className="mt-2 j-fs-micro text-red-100/80">
          <summary className="cursor-pointer font-bold">{recovery.secondaryAffordance ?? "View error"}</summary>
          <p className="mt-1 break-words">{errorDetail}</p>
        </details>
      )}
    </section>
  )
}
