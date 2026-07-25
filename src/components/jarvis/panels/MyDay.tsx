"use client"

import { useEffect, useState } from "react"
import { CheckCircle2, MapPin, Navigation } from "lucide-react"
import { jarvisGet, jarvisPost } from "../lib/api"
import { useJarvisAuth } from "../lib/jarvis-auth"

type Visit = { id: string; type: string; scheduledAt: string | null; completedAt: string | null; notes: string | null; address: string }
export function MyDay() {
  const { role } = useJarvisAuth(); const [visits, setVisits] = useState<Visit[] | null>(null); const [error, setError] = useState<string | null>(null)
  const load = () => jarvisGet<{ visits: Visit[] }>("technician/my-day").then((r) => setVisits(r.visits)).catch((e) => setError(e instanceof Error ? e.message : "Couldn't load your day."))
  useEffect(() => { if (role === "technician") load() }, [role])
  if (role !== "technician") return <div className="j-panel p-5 text-sm text-white/60">My Day is available to signed-in technician accounts.</div>
  return <div className="mx-auto max-w-lg space-y-3"><div><div className="j-label">My day</div><p className="mt-1 text-sm text-white/60">Only visits assigned to your linked technician record.</p></div>{error && <div className="rounded-xl border border-red-400/30 p-3 text-red-300">{error}</div>}{visits?.map((v, index) => <article key={v.id} className="j-panel p-4"><div className="flex items-start justify-between gap-3"><div><div className="text-[10px] font-black uppercase tracking-widest text-cyan-200">Stop {index + 1}</div><h2 className="mt-1 font-bold capitalize">{v.type.replaceAll("_", " ")}</h2><p className="mt-1 text-sm text-white/60">{v.address}</p></div><span className="text-[11px] text-white/45">{v.scheduledAt ? new Date(v.scheduledAt).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }) : "Unscheduled"}</span></div>{v.notes && <p className="mt-3 rounded-lg bg-white/[.035] p-2 text-xs text-white/60">{v.notes}</p>}<div className="mt-4 flex gap-2"><a className="inline-flex items-center gap-1 rounded-lg border border-white/15 px-3 py-2 text-xs font-bold text-cyan-100" target="_blank" rel="noreferrer" href={`https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(v.address)}`}><Navigation className="h-3.5 w-3.5" /> Navigate</a><button disabled={Boolean(v.completedAt)} onClick={() => void jarvisPost("technician/my-day", { visitId: v.id, confirm: true }).then(load).catch((e) => setError(e instanceof Error ? e.message : "Couldn't complete visit."))} className="inline-flex items-center gap-1 rounded-lg bg-cyan-300 px-3 py-2 text-xs font-black text-slate-950 disabled:opacity-50"><CheckCircle2 className="h-3.5 w-3.5" />{v.completedAt ? "Completed" : "Complete visit"}</button></div></article>)}{visits?.length === 0 && <div className="j-panel p-5 text-sm text-white/55">No assigned visits today.</div>}</div>
}
