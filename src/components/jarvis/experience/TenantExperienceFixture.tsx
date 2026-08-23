"use client"

import { useState } from "react"
import { OperationalSurfaceNav } from "../surfaces/OperationalSurfaceNav"
import { WorkspaceConfigFixtureProvider, useWorkspaceConfig } from "../WorkspaceConfigProvider"
import { TenantReadyExperience } from "./TenantReadyExperience"
import type { ExperienceRole } from "../lib/workspace-config"

function FixtureBody({ client, role, onClient, onRole }: { client: string; role: ExperienceRole; onClient: (client: string) => void; onRole: (role: ExperienceRole) => void }) {
  const { config } = useWorkspaceConfig()
  const [continuityProbe, setContinuityProbe] = useState("")
  return (
    <main className="jarvis-root min-h-screen bg-[var(--j-bg)] p-4 text-[color:var(--j-text)]" data-tenant-experience-fixture={client} data-jarvis-tenant-accent={config.brand.accent} data-jarvis-workspace-radius={config.brand.radius} data-jarvis-surface-tone={config.brand.surfaceTone} data-jarvis-experience-density={config.brand.density} data-jarvis-experience-typography={config.brand.typography} data-jarvis-experience-motion={config.brand.motion}>
      <OperationalSurfaceNav active="home" roleOverride={role} />
      <div className="mx-auto mt-8 max-w-6xl">
        <div className="j-label">REFERENCE TENANT · CONFIGURATION FIXTURE</div>
        <h1 className="mt-2 text-2xl font-black">{config.terminology.home} · {config.vocabulary.customer}</h1>
        <p className="mt-1 text-xs text-white/50">Production components and source-backed Truth states; no reference business results are supplied.</p>
        <div className="mt-4 flex flex-wrap gap-2" aria-label="Fixture controls">
          {(["owner", "dispatcher", "technician"] as const).map((item) => <button key={item} type="button" onClick={() => onRole(item)} aria-pressed={role === item}>Show {item}</button>)}
          <button type="button" onClick={() => onClient(client === "northstar" ? "summit" : "northstar")}>Apply {client === "northstar" ? "Summit" : "Northstar"} config</button>
          <label>Continuity probe <input aria-label="Continuity probe" value={continuityProbe} onChange={(event) => setContinuityProbe(event.target.value)} /></label>
        </div>
        <div className="mt-5"><TenantReadyExperience role={role} /></div>
      </div>
    </main>
  )
}

export function TenantExperienceFixture({ client: initialClient, configs }: { client: string; configs: Record<string, unknown> }) {
  const [client, setClient] = useState(initialClient)
  const [role, setRole] = useState<ExperienceRole>("owner")
  return <WorkspaceConfigFixtureProvider config={configs[client]}><FixtureBody client={client} role={role} onClient={setClient} onRole={setRole} /></WorkspaceConfigFixtureProvider>
}
