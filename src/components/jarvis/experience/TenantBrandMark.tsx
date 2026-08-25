"use client"

import Image from "next/image"
import { useState } from "react"
import { useWorkspaceConfig } from "../WorkspaceConfigProvider"

const BRAND_ASSETS = {
  finnor: null,
  "reference-northstar": "/jarvis/brands/reference-northstar.svg",
  "reference-summit": "/jarvis/brands/reference-summit.svg",
} as const

/** Asset keys are schema-enumerated and resolved locally; manifests cannot
 * inject arbitrary URLs, SVG, HTML, or executable content. */
export function TenantBrandMark({ size = 24 }: { size?: number }) {
  const { config } = useWorkspaceConfig()
  const [failedKey, setFailedKey] = useState<string | null>(null)
  const source = BRAND_ASSETS[config.brand.logoAssetKey]
  if (!source || failedKey === config.brand.logoAssetKey) return <span className="jarvis-tenant-brand-fallback" aria-hidden>{config.brand.mark}</span>
  return <Image src={source} width={size} height={size} alt="" aria-hidden onError={() => setFailedKey(config.brand.logoAssetKey)} className="jarvis-tenant-brand-image" />
}
