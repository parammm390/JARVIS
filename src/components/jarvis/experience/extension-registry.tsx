"use client"

import dynamic from "next/dynamic"
import type { ComponentType } from "react"
import { useWorkspaceConfig } from "../WorkspaceConfigProvider"
import type { ExperienceExtensionKey, ExperienceExtensionSlot, TenantExtensionConfig } from "../lib/workspace-config"
import type { TenantExtensionContext, TenantOverlayProps } from "./contracts"

type RegisteredOverlay = {
  slots: ReadonlySet<ExperienceExtensionSlot>
  component: ComponentType<TenantOverlayProps<Record<string, unknown>>>
}

/** The only import seam for bespoke client React code. All imports are static,
 * trusted build-time modules and remain code-split until a validated slot uses one. */
const EXPERIENCE_EXTENSION_REGISTRY: Record<ExperienceExtensionKey, RegisteredOverlay> = {
  "reference.northstar-service-priority": {
    slots: new Set(["ready.primary", "role.owner", "role.dispatcher"]),
    component: dynamic(() => import("../client-overlays/reference/NorthstarServicePriority"), { ssr: false }) as RegisteredOverlay["component"],
  },
  "reference.summit-installation-readiness": {
    slots: new Set(["ready.primary", "ready.secondary", "role.owner", "outcome.summary"]),
    component: dynamic(() => import("../client-overlays/reference/SummitInstallationReadiness"), { ssr: false }) as RegisteredOverlay["component"],
  },
}

export function registeredExtension(key: string, slot: ExperienceExtensionSlot): boolean {
  const entry = EXPERIENCE_EXTENSION_REGISTRY[key as ExperienceExtensionKey]
  return Boolean(entry?.slots.has(slot))
}

export function ExperienceSlot({ slot, context, className }: { slot: ExperienceExtensionSlot; context: TenantExtensionContext; className?: string }) {
  const { config } = useWorkspaceConfig()
  const extension = config.extensions[slot] as TenantExtensionConfig | undefined
  if (!extension) return null
  const entry = EXPERIENCE_EXTENSION_REGISTRY[extension.key]
  if (!entry || !entry.slots.has(slot)) return null
  const Component = entry.component
  return <div className={className} data-experience-slot={slot} data-extension-key={extension.key}><Component context={context} config={extension.config} /></div>
}

export const REGISTERED_EXPERIENCE_EXTENSION_KEYS = Object.freeze(Object.keys(EXPERIENCE_EXTENSION_REGISTRY) as ExperienceExtensionKey[])
