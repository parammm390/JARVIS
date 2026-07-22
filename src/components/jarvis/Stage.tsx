"use client"

// C1.T3 — /jarvis/stage: the dev harness + visual-QA + walkthrough surface every
// future FLOW primitive/choreography/renderer mounts on (C2/C3 land those next
// session — this page exists now so they have somewhere real to go, not a stub to
// throw away later). Owner-only: this is an internal QA tool, not a customer surface.
//
// Today's one section demonstrates C1's actual new infrastructure — useLiveQuery
// (C1.T2) driven by FIXTURE data (a hand-rolled paginated feed simulating what
// GET /api/activity, A2.T6, returns) rather than the real endpoint: /api/activity
// isn't in the jarvis proxy's allowlist yet (src/app/api/jarvis/[...path]/route.ts —
// a real, separate finding, not silently patched here; wiring it through the proxy is
// D1's job when the Activity Theater actually consumes it). Labeled FIXTURE
// throughout, matching this repo's own honest-spectacle convention — never presented
// as live data it isn't.

import { useState } from "react"
import Link from "next/link"
import "./jarvis-theme.css"
import { JarvisAuthProvider, useJarvisAuth } from "./lib/jarvis-auth"
import { useLiveQuery, type LiveQueryConnection } from "@/lib/jarvis/useLiveQuery"
import { FlowCatalogSection } from "./ui/motion/FlowCatalog"

interface FixtureActivityItem {
  source: "action_log" | "workflow_step" | "call"
  id: string
  occurredAt: string
  detail: Record<string, unknown>
}
interface FixtureActivityPage {
  items: FixtureActivityItem[]
  cursor: string | null
  hasMore: boolean
}

const SOURCES: FixtureActivityItem["source"][] = ["action_log", "workflow_step", "call"]

// Deterministic-enough fixture generator: each call mints one new fake event and a
// monotonically increasing cursor, so the panel visibly grows on every poll —
// exactly the shape /api/activity's real (occurredAt, id) keyset cursor produces.
let fixtureSeq = 0
async function fetchFixturePage(cursor: string | null): Promise<FixtureActivityPage & { cursor: string | null; hasMore: boolean }> {
  await new Promise((r) => setTimeout(r, 150)) // simulate real network latency
  fixtureSeq += 1
  const item: FixtureActivityItem = {
    source: SOURCES[fixtureSeq % SOURCES.length]!,
    id: `fixture-${fixtureSeq}`,
    occurredAt: new Date().toISOString(),
    detail: { note: "FIXTURE — not a real event", seq: fixtureSeq },
  }
  return { items: cursor === null && fixtureSeq === 1 ? [item] : fixtureSeq % 3 === 0 ? [item] : [], cursor: `${Date.now()}|${item.id}`, hasMore: false }
}

function ConnectionBadge({ connection }: { connection: LiveQueryConnection }) {
  const tone = connection === "sse" ? "text-cyan-300 bg-cyan-400/10" : connection === "polling" ? "text-amber-300 bg-amber-400/10" : "text-white/50 bg-white/5"
  return <span className={`j-chip ${tone}`}>{connection}</span>
}

function LiveQueryFixtureSection() {
  const { data, connection, error, lastUpdatedAt } = useLiveQuery<FixtureActivityPage, string>({
    // sseUrl intentionally omitted — B1 (the real SSE gateway) hasn't shipped; this
    // demonstrates the honest current reality (pure polling), not a fabricated
    // live connection.
    fetchPage: fetchFixturePage,
    reduce: (prev, next) => ({
      items: [...next.items, ...(prev?.items ?? [])].slice(0, 20),
      cursor: next.cursor,
      hasMore: next.hasMore,
    }),
    visibleIntervalMs: 2500,
  })

  return (
    <section className="j-panel p-5">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="j-label">useLiveQuery — cursor-delta fixture (C1.T2)</h2>
        <div className="flex items-center gap-2">
          <span className="j-chip bg-violet-400/12 text-violet-300">FIXTURE</span>
          <ConnectionBadge connection={connection} />
        </div>
      </div>
      <p className="mb-3 text-[11px] text-[color:var(--j-text-dim)]">
        Polling a fake feed every 2.5s (no sseUrl passed — B1&apos;s real SSE gateway doesn&apos;t exist yet, so this is the honest
        polling-only behavior every consumer of this hook gets today). {lastUpdatedAt ? `Last update ${new Date(lastUpdatedAt).toLocaleTimeString()}.` : "Waiting for first poll…"}
      </p>
      {error && <div className="mb-2 rounded-lg border border-red-400/30 bg-red-400/5 px-2 py-1.5 text-[10px] text-red-300">{error}</div>}
      <div className="space-y-1.5">
        {(data?.items ?? []).length === 0 && <div className="text-[11px] text-[color:var(--j-text-faint)]">No events yet…</div>}
        {(data?.items ?? []).map((item) => (
          <div key={item.id} className="flex items-center justify-between rounded-lg border border-white/8 bg-white/[0.015] px-3 py-1.5 text-[10.5px]">
            <span className="font-mono text-[color:var(--j-text-dim)]">{item.source}</span>
            <span className="text-[color:var(--j-text-faint)]">{item.id}</span>
          </div>
        ))}
      </div>
    </section>
  )
}

function StageContent() {
  const { session, loading, role, signOut } = useJarvisAuth()

  if (loading) {
    return (
      <div className="jarvis-root flex min-h-screen items-center justify-center bg-[color:var(--j-bg)] text-[color:var(--j-text-dim)]">
        Checking session…
      </div>
    )
  }

  if (!session || role !== "owner") {
    return (
      <div className="jarvis-root flex min-h-screen flex-col items-center justify-center gap-4 bg-[color:var(--j-bg)] px-6 text-center">
        <h1 className="text-lg font-black text-[color:var(--j-text)]">Owner access required</h1>
        <p className="max-w-sm text-[12px] text-[color:var(--j-text-dim)]">
          The Stage is an internal dev harness for visual QA of JARVIS primitives — not a customer surface.
        </p>
        <Link href="/jarvis/login" className="rounded-full bg-teal-300 px-4 py-1.5 text-[11px] font-black text-slate-950 hover:bg-teal-200">
          Sign in
        </Link>
      </div>
    )
  }

  return (
    <div className="jarvis-root min-h-screen space-y-5 bg-[color:var(--j-bg)] p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-black text-[color:var(--j-text)]">JARVIS Stage</h1>
          <p className="text-[11px] text-[color:var(--j-text-dim)]">
            Dev harness — every primitive/choreography/renderer mounts here from fixtures (C1.T3). C2&apos;s FLOW motion catalog (below) and
            C3&apos;s effects/primitive kit add their own sections next.
          </p>
        </div>
        <button onClick={() => void signOut()} className="rounded-full border border-white/12 px-3 py-1 text-[10px] font-bold text-white/60 hover:text-white">
          Sign out
        </button>
      </div>
      <LiveQueryFixtureSection />
      <FlowCatalogSection />
    </div>
  )
}

export function Stage() {
  return (
    <JarvisAuthProvider>
      <StageContent />
    </JarvisAuthProvider>
  )
}
