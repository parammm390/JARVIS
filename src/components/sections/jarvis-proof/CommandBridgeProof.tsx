"use client"

// M3.T1 — the Command Bridge proof section (plan §2.4 beat 4). Every capability named
// here is real and already shipped in the authenticated console (`src/app/jarvis/*`,
// `src/components/jarvis/*`) — the Orb (`bridge/Orb3D.tsx`), Pipeline Theater
// (`JARVIS-MAESTRO-PLAN.md` D4, `ActivityTheater.tsx`), and the activity feed backed by
// a real `GET /api/activity` join (`JARVIS-MAESTRO-STATE.md` D3 session log). No screen
// recording exists yet (M1.T4 stayed PARAM-blocked — no owner test credentials in this
// environment), so this section proves the console with the real Orb plus a written,
// source-grounded description instead of fabricated or placeholder footage.

import { motion } from "framer-motion"
import { Activity, GitBranch, Layers, Radio, Waves } from "lucide-react"
import type { LucideIcon } from "lucide-react"
import { JarvisProofSurface } from "@/components/sections/jarvis-proof/JarvisProofSurface"
import { Glass } from "@/components/jarvis/atmosphere"
import { BorderBeam } from "@/components/jarvis/ui/fx/BorderBeam"
import { RiskBadge } from "@/components/jarvis/ui/primitives/RiskBadge"
import dynamic from "next/dynamic"

const MarketingOrb = dynamic(
  () => import("@/components/sections/jarvis-proof/MarketingOrb").then((m) => m.MarketingOrb),
  {
    ssr: false,
    loading: () => (
      <div
        className="h-full w-full rounded-full"
        style={{
          background:
            "radial-gradient(circle at 38% 32%, rgba(34,211,238,0.35) 0%, rgba(34,211,238,0.12) 45%, rgba(6,11,24,0.05) 72%)",
        }}
      />
    ),
  },
)

const panels: Array<{ icon: LucideIcon; title: string; copy: string; tier: "low" | "medium" | "high" }> = [
  {
    icon: Radio,
    title: "The Orb",
    copy:
      "One shape, three states — idle, planning, executing. It's the same read whether you're watching one instruction or twenty.",
    tier: "low",
  },
  {
    icon: GitBranch,
    title: "Pipeline Theater",
    copy:
      "Every durable run shown as it actually executes — step by step, with compensation and failure states visible, not hidden in a log file.",
    tier: "medium",
  },
  {
    icon: Activity,
    title: "The activity feed",
    copy:
      "Every approval, every receipt, every rejected action — one ordered record instead of a scattered set of notifications.",
    tier: "high",
  },
]

export function CommandBridgeProof() {
  return (
    <section id="command-bridge" className="relative overflow-hidden py-20 md:py-28">
      <JarvisProofSurface className="relative">
        <div className="absolute inset-0 operational-grid opacity-[0.06]" />
        <div className="container relative z-10 px-4 md:px-6">
          <div className="mx-auto mb-14 max-w-3xl text-center">
            <motion.div
              initial={{ opacity: 0, y: 16 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              className="mb-5 inline-flex rounded-full border border-white/10 bg-white/[0.04] px-4 py-2 text-xs font-black uppercase tracking-[0.18em] text-[color:var(--j-cyan)]"
            >
              This is the actual product
            </motion.div>
            <motion.h2
              initial={{ opacity: 0, y: 18 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              className="text-4xl font-black tracking-tight text-[color:var(--j-text)] md:text-6xl"
            >
              Not a mockup. The console you&apos;d actually run.
            </motion.h2>
            <motion.p
              initial={{ opacity: 0, y: 16 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ delay: 0.08 }}
              className="mx-auto mt-6 max-w-2xl text-lg font-medium leading-relaxed text-[color:var(--j-text-dim)]"
            >
              Every screen below is a real, shipped part of the JARVIS console — the same one your
              team would sign into. What you see here is the Orb rendering live and a description
              of the rest, grounded in what the product actually does today.
            </motion.p>
          </div>

          <div className="grid gap-10 lg:grid-cols-[0.85fr_1.15fr] lg:items-center">
            <motion.div
              initial={{ opacity: 0, scale: 0.96 }}
              whileInView={{ opacity: 1, scale: 1 }}
              viewport={{ once: true, margin: "-60px" }}
              className="relative mx-auto aspect-square w-full max-w-[380px]"
            >
              <MarketingOrb className="h-full w-full" />
            </motion.div>

            <div className="grid gap-4">
              {panels.map((panel, index) => (
                <motion.div
                  key={panel.title}
                  initial={{ opacity: 0, x: 24 }}
                  whileInView={{ opacity: 1, x: 0 }}
                  viewport={{ once: true, margin: "-60px" }}
                  transition={{ delay: index * 0.08 }}
                >
                  <BorderBeam className="rounded-2xl">
                    <Glass className="rounded-2xl" glow={index === 2 ? "cyan" : "none"} noise>
                      <div className="flex gap-4 p-5 md:p-6">
                        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-white/[0.05] text-[color:var(--j-cyan)]">
                          <panel.icon className="h-5 w-5" />
                        </span>
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <h3 className="font-black tracking-tight text-[color:var(--j-text)]">
                              {panel.title}
                            </h3>
                            <RiskBadge tier={panel.tier} />
                          </div>
                          <p className="mt-1.5 text-sm font-medium leading-relaxed text-[color:var(--j-text-dim)]">
                            {panel.copy}
                          </p>
                        </div>
                      </div>
                    </Glass>
                  </BorderBeam>
                </motion.div>
              ))}
            </div>
          </div>

          <motion.p
            initial={{ opacity: 0, y: 12 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            className="mx-auto mt-10 flex max-w-2xl items-start gap-2 text-center text-xs font-semibold leading-relaxed text-[color:var(--j-text-dim)]"
          >
            <Layers className="mt-0.5 hidden h-3.5 w-3.5 shrink-0 sm:block" aria-hidden />
            The console itself is sign-in gated — it runs your operations, not a public demo.
            Try what a visitor actually can below.
            <Waves className="mt-0.5 hidden h-3.5 w-3.5 shrink-0 sm:block" aria-hidden />
          </motion.p>
        </div>
      </JarvisProofSurface>
    </section>
  )
}
