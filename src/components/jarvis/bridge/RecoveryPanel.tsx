"use client"

import Link from "next/link"
import { recoveryPresentation } from "../kernel/recovery"
import type { RecoveryKind } from "../kernel/types"

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
  onRecover?: () => void
  setupHref?: string
  errorDetail?: string
}) {
  const recovery = recoveryPresentation(kind)
  const action = recovery.affordance === "Connect" && setupHref
    ? <Link href={setupHref} className="rounded-full border border-cyan-400/30 px-3 py-1.5 j-fs-micro font-bold text-cyan-200 hover:border-cyan-400/60 hover:bg-cyan-400/10">{recovery.affordance}</Link>
    : onRecover
      ? <button type="button" onClick={onRecover} className="rounded-full border border-red-300/30 px-3 py-1.5 j-fs-micro font-bold text-red-100 hover:border-red-300/60 hover:bg-red-300/10">{recovery.affordance}</button>
      : null

  return (
    <section className="rounded-xl border border-red-400/25 bg-red-400/5 p-3" aria-label={`Recovery: ${kind}`}>
      <p className="j-fs-sm font-bold text-red-100">{recovery.copy}</p>
      {action && <div className="mt-2">{action}</div>}
      {recovery.secondaryAffordance && errorDetail && (
        <details className="mt-2 j-fs-micro text-red-100/80">
          <summary className="cursor-pointer font-bold">{recovery.secondaryAffordance}</summary>
          <p className="mt-1 break-words">{errorDetail}</p>
        </details>
      )}
    </section>
  )
}
