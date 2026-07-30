"use client"

// D6.T2 — role-first landing scenes. The backend remains authoritative for every
// permission; this only selects a useful first surface after /api/me has resolved the
// signed-in role. A saved homepage overrides the role default only when it is a scene
// that role may actually use, so a stale preference never turns into a courtesy-based
// authorization leak.

import { useEffect, useState } from "react"
import { Map, Wrench } from "lucide-react"
import JarvisCommandCenter from "./JarvisCommandCenter"
import { Bridge as InstructionThreadBridge } from "./bridge/ThreadBridge"
import { Bridge } from "./bridge/Bridge"
import { ApprovalCockpit } from "./bridge/ApprovalCockpit"
import { DispatchMap } from "./panels/DispatchMap"
import { MyDay } from "./panels/MyDay"
import { JarvisAuthProvider, useJarvisAuth, type JarvisRole } from "./lib/jarvis-auth"
import { JarvisDataProvider } from "./lib/data-core"
import { jarvisGet } from "./lib/api"
import { SinceYouWereAway } from "./SinceYouWereAway"
import { PushOptIn } from "./PushOptIn"
import "./jarvis-theme.css"

type Homepage = "bridge" | "map" | "my-day" | null
type Prefs = { homepage: Homepage; accent: string | null }
const DEFAULT_HOME: Record<JarvisRole, Exclude<Homepage, null>> = { owner: "bridge", dispatcher: "map", technician: "my-day" }
const ALLOWED_HOME: Record<JarvisRole, Homepage[]> = { owner: ["bridge"], dispatcher: ["map"], technician: ["my-day"] }

function SceneFrame({ children, accent }: { children: React.ReactNode; accent: string | null }) {
  return <div className="jarvis-root min-h-screen bg-[var(--j-bg)] text-[color:var(--j-text)]" data-tenant-accent={accent ?? undefined}><div className="fixed right-3 top-3 z-50"><PushOptIn /></div>{children}</div>
}

function RoleLanding() {
  const { session, loading, role } = useJarvisAuth()
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

  // A public JARVIS shell is safe before session restoration; private requests keep
  // failing closed until the bearer is present. Only wait for a role once a real
  // session has been restored, avoiding an avoidable blank first paint.
  if (session && !role) return <div className="min-h-screen bg-[#04070f]" />
  if (!session) return <JarvisCommandCenter />
  // Command Bridge (D1) is still mid-migration — only Overview/Pipeline scenes exist
  // there today, and it has no voice entry point at all (it only reads voiceState to
  // color the orb, never renders a mic control). Command Center already has every
  // real feature (CRM, Voice Console, Customers, Workflows, Inventory, Water
  // Compliance, Web Research, Activity, Dispatch Map, My Day) plus a working,
  // properly auth-gated voice session, so an owner's signed-in home stays there until
  // Bridge actually reaches feature parity. Bridge is still reachable directly at
  // /jarvis/bridge for anyone who wants to see it.
  if (role === "owner") return <JarvisCommandCenter />
  const selected = role && prefs && ALLOWED_HOME[role].includes(prefs.homepage) ? prefs.homepage! : DEFAULT_HOME[role!]
  if (selected === "bridge") return <SceneFrame accent={prefs?.accent ?? null}><Bridge /></SceneFrame>
  return <SceneFrame accent={prefs?.accent ?? null}><JarvisDataProvider><main className="mx-auto min-h-screen max-w-7xl space-y-5 p-5 md:p-8"><SinceYouWereAway />{selected === "map" ? <><header><div className="j-label flex items-center gap-2"><Map className="h-4 w-4" /> Dispatcher scene</div><h1 className="mt-1 text-2xl font-black">Dispatch and approvals</h1></header><DispatchMap /><ApprovalCockpit /></> : <><header><div className="j-label flex items-center gap-2"><Wrench className="h-4 w-4" /> Technician scene</div><h1 className="mt-1 text-2xl font-black">Your assigned day</h1></header><MyDay /></>}</main></JarvisDataProvider></SceneFrame>
}

export default function PersonalizedHome() {
  return <JarvisAuthProvider><RoleLanding /></JarvisAuthProvider>
}
