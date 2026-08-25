"use client"

import { useMemo } from "react"
import { Database, Link2, RefreshCw } from "lucide-react"
import { useOperatingInteraction, type OperatingEntityRef, type OperatingEntityType } from "./kernel/operating-interaction"
import { useBusinessProjection } from "./lib/business-projections"
import { businessProjections, type BusinessScene } from "./lib/projection-definitions"
import { useJarvisAuth } from "./lib/jarvis-auth"
import { useWorkspaceConfig } from "./WorkspaceConfigProvider"
import { vocabularyLabel } from "./lib/workspace-config"

/** Compact provenance/operability seam shared by all six scene families. It exposes
 * canonical objects from the one Business World contract; it is not another panel
 * data loader or a copied graph. */
export function BusinessWorldScene({ scene }: { scene: BusinessScene }) {
  const definition = useMemo(() => businessProjections.businessWorld(scene), [scene])
  const { session } = useJarvisAuth()
  const { config } = useWorkspaceConfig()
  const projection = useBusinessProjection(definition, { enabled: Boolean(session) })
  const interaction = useOperatingInteraction()
  const objects = projection.data?.objects.slice(0, 6) ?? []
  return (
    <aside className="mx-auto mb-3 w-full max-w-7xl rounded-2xl border border-white/10 bg-black/20 px-4 py-3" aria-label={`${scene} business world`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-xs text-white/60">
          <Database className="h-3.5 w-3.5" />
          <span className="font-semibold uppercase tracking-[0.16em]">{scene} world</span>
          {projection.data
            ? <span>{projection.data.objects.length} canonical objects · {projection.data.relationships.length} exact links{projection.data.truncated ? " · bounded" : ""}</span>
            : <span>{projection.status === "error" ? "source unavailable" : "loading canonical source"}</span>}
        </div>
        <button type="button" onClick={() => void projection.refresh()} className="inline-flex items-center gap-1 rounded-lg border border-white/10 px-2 py-1 text-[11px] text-white/60 hover:text-white">
          <RefreshCw className={`h-3 w-3 ${projection.refreshing ? "animate-spin" : ""}`} /> Refresh
        </button>
      </div>
      {objects.length > 0 && <div className="mt-2 flex gap-2 overflow-x-auto pb-1">
        {objects.map((object) => {
          const ref: OperatingEntityRef = { entityType: object.entityType as OperatingEntityType, entityId: object.entityId }
          const selected = interaction.selectedEntities.some((item) => item.entityType === ref.entityType && item.entityId === ref.entityId)
          return <button key={`${object.entityType}:${object.entityId}`} type="button" onClick={() => interaction.toggleEntity(ref, object.label ?? vocabularyLabel(object.entityType, config))} className={`flex shrink-0 items-center gap-1.5 rounded-xl border px-2.5 py-1.5 text-left text-xs ${selected ? "border-cyan-300/60 bg-cyan-300/10 text-cyan-100" : "border-white/10 text-white/65 hover:border-white/25 hover:text-white"}`} title={`Source: ${object.provenance.table}`}>
            <Link2 className="h-3 w-3" /><span>{object.label ?? vocabularyLabel(object.entityType, config)}</span>{object.status && <span className="text-white/35">· {object.status}</span>}<span className="text-white/30">· {object.provenance.table}{object.relatedWork.length > 0 ? ` · ${object.relatedWork.length} ${config.vocabulary.work}` : ""}</span>
          </button>
        })}
      </div>}
    </aside>
  )
}
