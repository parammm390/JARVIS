"use client"

// D6.T2 — role-first landing scenes. The backend remains authoritative for every
// permission; this only selects a useful first surface after /api/me has resolved the
// signed-in role. A saved homepage overrides the role default only when it is a scene
// that role may actually use, so a stale preference never turns into a courtesy-based
// authorization leak.

import { useEffect, useState } from "react"
import dynamic from "next/dynamic"
import { Map, Wrench } from "lucide-react"
import { JarvisAuthProvider, useJarvisAuth, type JarvisRole } from "./lib/jarvis-auth"
import { JarvisDataProvider } from "./lib/data-core"
import { jarvisGet } from "./lib/api"
import { SinceYouWereAway } from "./SinceYouWereAway"
import { PushOptIn } from "./PushOptIn"
import "./jarvis-theme.css"

// Dispatcher and technician-only scenes keep their existing components, but do
// not belong in the owner/public Thread's initial route graph.
const Bridge = dynamic(() => import("./bridge/Bridge").then((m) => m.Bridge), { ssr: false })
// The canonical owner Thread is the dominant interaction surface, but it is
// still a client-only graph. Keep it out of the initial `/jarvis` route bundle
// so the shell can establish auth/public-preview posture before loading the
// liveframe implementation. The loading surface is intentionally compact and
// truthful; it does not present private facts or imply a workflow state.
const InstructionThreadBridge = dynamic(
  () => import("./bridge/ThreadBridge").then((m) => m.InstructionThreadBridge),
  {
    ssr: false,
    loading: () => (
      <div className="flex min-h-screen items-center justify-center bg-[#04070f] px-6 text-center text-white">
        <div>
          <div className="j-fs-micro font-black uppercase tracking-[0.24em] text-cyan-200">JARVIS</div>
          <p className="mt-2 j-fs-sm text-[color:var(--j-text-dim)]">Preparing the instruction thread…</p>
        </div>
      </div>
    ),
  },
)
const ApprovalCockpit = dynamic(() => import("./bridge/ApprovalCockpit").then((m) => m.ApprovalCockpit), { ssr: false })
const DispatchMap = dynamic(() => import("./panels/DispatchMap").then((m) => m.DispatchMap), { ssr: false })
const MyDay = dynamic(() => import("./panels/MyDay").then((m) => m.MyDay), { ssr: false })

type Homepage = "bridge" | "map" | "my-day" | null
type Prefs = { homepage: Homepage; accent: string | null }
const DEFAULT_HOME: Record<JarvisRole, Exclude<Homepage, null>> = { owner: "bridge", dispatcher: "map", technician: "my-day" }
const ALLOWED_HOME: Record<JarvisRole, Homepage[]> = { owner: ["bridge"], dispatcher: ["map"], technician: ["my-day"] }

function SceneFrame({ children, accent }: { children: React.ReactNode; accent: string | null }) {
  return <div className="jarvis-root min-h-screen bg-[var(--j-bg)] text-[color:var(--j-text)]" data-tenant-accent={accent ?? undefined}><div className="fixed right-3 top-3 z-50"><PushOptIn /></div>{children}</div>
}

function RoleLanding() {
  const { session, role, roleLoading, roleError, retryRole, authError, retryAuth } = useJarvisAuth()
  const [prefs, setPrefs] = useState<Prefs | null>(null)
  useEffect(() => {
    if (!session) { setPrefs(null); return }
    let cancelled = false
    void jarvisGet<{ prefs: Prefs }>("user-prefs").then((response) => { if (!cancelled) setPrefs(response.prefs) }).catch(() => { if (!cancelled) setPrefs({ homepage: null, accent: null }) })
    return () => { cancelled = true }
  }, [session])
  useEffect(() => {
    const root = document.documentElement
    if (prefs?.accent) root.dataset.jarvisTenantAccent = prefs.accent
    else delete root.dataset.jarvisTenantAccent
    return () => { delete root.dataset.jarvisTenantAccent }
  }, [prefs?.accent])

  // A public JARVIS Thread is safe before session restoration; private requests
  // keep failing closed until the bearer is present. Only wait for a role once a
  // real session has been restored, avoiding an avoidable blank first paint.
  if (authError) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-[#04070f] px-6 text-center">
        <h1 className="text-lg font-black text-white">JARVIS could not restore sign-in</h1>
        <p className="max-w-md j-fs-sm text-[color:var(--j-text-dim)]">{authError}</p>
        <button type="button" onClick={retryAuth} className="rounded-full bg-teal-300 px-4 py-1.5 j-fs-micro font-black text-slate-950 hover:bg-teal-200">Retry connection</button>
      </div>
    )
  }
  if (session && roleError) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-[#04070f] px-6 text-center">
        <h1 className="text-lg font-black text-white">JARVIS could not load your workspace</h1>
        <p className="max-w-md j-fs-sm text-[color:var(--j-text-dim)]">{roleError}</p>
        <button type="button" onClick={retryRole} className="rounded-full bg-teal-300 px-4 py-1.5 j-fs-micro font-black text-slate-950 hover:bg-teal-200">Retry connection</button>
      </div>
    )
  }
  if (session && (roleLoading || !role)) return <div className="flex min-h-screen items-center justify-center bg-[#04070f] text-white">Waking JARVIS…</div>
  if (!session) return <InstructionThreadBridge standalone={false} />
  // The owner lands in the canonical Instruction Thread: the same kernel owns
  // realtime traces, scoped approvals, execution state, voice handoff, and the
  // spatial shell. The older two-rail Bridge remains available at /jarvis/bridge
  // for its own explicit route and does not compete with this product surface.
  if (role === "owner") return <InstructionThreadBridge standalone={false} />
  const selected = role && prefs && ALLOWED_HOME[role].includes(prefs.homepage) ? prefs.homepage! : DEFAULT_HOME[role!]
  if (selected === "bridge") return <SceneFrame accent={prefs?.accent ?? null}><Bridge /></SceneFrame>
  return <SceneFrame accent={prefs?.accent ?? null}><main className="mx-auto min-h-screen max-w-7xl space-y-5 p-5 md:p-8"><SinceYouWereAway />{selected === "map" ? <><header><div className="j-label flex items-center gap-2"><Map className="h-4 w-4" /> Dispatcher scene</div><h1 className="mt-1 text-2xl font-black">Dispatch and approvals</h1></header><DispatchMap /><ApprovalCockpit /></> : <><header><div className="j-label flex items-center gap-2"><Wrench className="h-4 w-4" /> Technician scene</div><h1 className="mt-1 text-2xl font-black">Your assigned day</h1></header><MyDay /></>}</main></SceneFrame>
}

export default function PersonalizedHome() {
  return <JarvisAuthProvider><JarvisDataProvider><RoleLanding /></JarvisDataProvider></JarvisAuthProvider>
}
