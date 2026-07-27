"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { DecryptText } from "./ui/fx/DecryptText"
import { ActionRenderer } from "./ui/renderers/ActionRenderer"
import { Stagger } from "./ui/motion/primitives"
import { jarvisGet } from "./lib/api"
import { useJarvis, type PendingAction } from "./lib/data-core"

type Digest = { firstVisit: boolean; greeting: string; newActions: number; pendingActions: number; top: Array<{ id: string; actionType: string; summary: string | null }> }

// F10.T1 — FLOW-98 GreetingCurrent: extends D6.T4's digest with real D3-renderer
// mini-scenes. The digest endpoint (`GET user-prefs/digest`) only ever returns
// {id, actionType, summary} — it was never meant to carry a full action payload,
// and F-track makes zero backend changes (hard rule), so no new field was added
// there. Instead this cross-references each digest item's id against the SAME
// real `pendingActions` list `ApprovalCockpit`/`ActivityTheater` already fetch
// through `useJarvis()` — when a digest item is still genuinely pending, its
// real payload is already in memory and a full `ActionRenderer` mini-scene
// renders from it (same component, same tier resolution as the cockpit/feed/
// receipt contexts D3's own exit gate already proved). When a digest item isn't
// in that list (already decided, or this session never loaded the queue), it
// falls back to the original plain chip — graceful-absent, the D2-established
// pattern, never a fabricated payload.
export function SinceYouWereAwayView({
  digest,
  pendingActions,
  skipped,
  onSkip,
}: {
  digest: Digest
  pendingActions: PendingAction[]
  skipped: boolean
  onSkip: () => void
}) {
  const byId = new Map(pendingActions.map((a) => [a.id, a]))
  return (
    <section className="j-panel border-cyan-300/20 p-4" aria-label="Since you were away">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="j-label">Since you were away</div>
          <p className="mt-1 text-sm text-cyan-50">{skipped ? digest.greeting : <DecryptText text={digest.greeting} cursor />}</p>
        </div>
        <button onClick={onSkip} className="text-[10px] font-bold text-[color:var(--j-text-dim)] hover:text-white">Skip</button>
      </div>
      <div className="mt-3 flex gap-3 text-[11px] text-[color:var(--j-text-dim)]">
        <span><b className="text-white">{digest.newActions}</b> new actions</span>
        <span><b className="text-white">{digest.pendingActions}</b> awaiting approval</span>
      </div>
      {digest.top.length > 0 && (
        <Stagger className="mt-3 flex flex-wrap gap-2" staggerMs={60}>
          {digest.top.map((item) => {
            const live = byId.get(item.id)
            return (
              <Link
                key={item.id}
                href="/jarvis/bridge#approval-cockpit"
                className="j-chip block max-w-full border border-white/10 bg-white/[.035] text-cyan-100"
              >
                {live ? <ActionRenderer actionType={live.actionType} payload={live.payload} compact /> : (item.summary ?? item.actionType.replaceAll("_", " "))}
              </Link>
            )
          })}
        </Stagger>
      )}
    </section>
  )
}

// D6.T4 / FLOW-23 (extended by F10.T1's FLOW-98 above): the cinematic is a
// skippable reveal of an authenticated endpoint's actual delta payload. It
// intentionally renders nothing until the request succeeds.
export function SinceYouWereAway() {
  const [digest, setDigest] = useState<Digest | null>(null)
  const [skipped, setSkipped] = useState(false)
  const { pendingActions } = useJarvis()
  useEffect(() => { void jarvisGet<Digest>("user-prefs/digest").then(setDigest).catch(() => undefined) }, [])
  if (!digest) return null
  return <SinceYouWereAwayView digest={digest} pendingActions={pendingActions} skipped={skipped} onSkip={() => setSkipped(true)} />
}
