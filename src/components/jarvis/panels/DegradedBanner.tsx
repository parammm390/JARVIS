"use client"

// Phase 7 (§7.7) — a global banner naming the impaired provider, sourced from real
// GET /api/integrations/status self-tests (already polled by the shared provider).
// "Degraded" here means a CONFIGURED provider's own live health check just failed
// (healthy === false) — a verified, real signal, not a fabricated status. A provider
// that was never configured (healthy === null) is a known gap, not a live incident,
// so it never triggers this banner (HeaderBand's "Partial config" chip covers that).

import { AlertTriangle } from "lucide-react"
import { useJarvis } from "../lib/data-core"

const LABELS: Record<string, string> = {
  meta_ads: "Meta Ads",
  google_ads: "Google Ads",
  quickbooks: "QuickBooks",
  vapi: "Vapi (voice)",
  ghl: "GoHighLevel",
  stripe: "Stripe",
  docusign: "DocuSign",
}

export function DegradedBanner() {
  const data = useJarvis()
  const integrations = data.integrationsStatus
  if (!integrations) return null

  const impaired = (Object.keys(LABELS) as Array<keyof typeof LABELS>).filter((key) => {
    const health = integrations[key as keyof typeof integrations]
    return health && typeof health === "object" && "healthy" in health && health.configured && health.healthy === false
  })

  if (impaired.length === 0) return null

  return (
    <div className="flex items-center gap-2 rounded-xl border border-amber-300/25 bg-amber-300/8 px-3.5 py-2 text-[11.5px] text-amber-200">
      <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
      <span>
        {impaired.map((k) => LABELS[k]).join(", ")} {impaired.length === 1 ? "isn't" : "aren't"} responding right now — affected actions queue instead of failing silently.
      </span>
    </div>
  )
}
