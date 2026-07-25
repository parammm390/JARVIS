"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { DecryptText } from "./ui/fx/DecryptText"
import { jarvisGet } from "./lib/api"

type Digest = { firstVisit: boolean; greeting: string; newActions: number; pendingActions: number; top: Array<{ id: string; actionType: string; summary: string | null }> }

// D6.T4 / FLOW-23: the cinematic is a skippable reveal of an authenticated endpoint's
// actual delta payload. It intentionally renders nothing until the request succeeds.
export function SinceYouWereAway() {
  const [digest, setDigest] = useState<Digest | null>(null)
  const [skipped, setSkipped] = useState(false)
  useEffect(() => { void jarvisGet<Digest>("user-prefs/digest").then(setDigest).catch(() => undefined) }, [])
  if (!digest) return null
  return <section className="j-panel border-cyan-300/20 p-4" aria-label="Since you were away"><div className="flex items-start justify-between gap-4"><div><div className="j-label">Since you were away</div><p className="mt-1 text-sm text-cyan-50">{skipped ? digest.greeting : <DecryptText text={digest.greeting} cursor />}</p></div><button onClick={() => setSkipped(true)} className="text-[10px] font-bold text-[color:var(--j-text-dim)] hover:text-white">Skip</button></div><div className="mt-3 flex gap-3 text-[11px] text-[color:var(--j-text-dim)]"><span><b className="text-white">{digest.newActions}</b> new actions</span><span><b className="text-white">{digest.pendingActions}</b> awaiting approval</span></div>{digest.top.length > 0 && <div className="mt-3 flex flex-wrap gap-2">{digest.top.map((item) => <Link key={item.id} href={`/jarvis/bridge#approval-cockpit`} className="j-chip border border-white/10 bg-white/[.035] text-cyan-100">{item.summary ?? item.actionType.replaceAll("_", " ")}</Link>)}</div>}</section>
}
