import { Boxes, GitPullRequestArrow, Waypoints } from "lucide-react"
import type { TenantOverlayProps } from "../../experience/contracts"

type Config = { title: string; emphasis: "pipeline" | "materials" | "handoff" }

const EMPHASIS = {
  pipeline: { icon: GitPullRequestArrow, label: "Pipeline lens", detail: "Proposal-to-installation flow is emphasized using the shared operating environment." },
  materials: { icon: Boxes, label: "Materials lens", detail: "Stock and readiness context is emphasized; no inventory quantity is invented here." },
  handoff: { icon: Waypoints, label: "Handoff lens", detail: "Installer handoffs are emphasized while execution and evidence remain canonical." },
} as const

export default function SummitInstallationReadiness({ context, config }: TenantOverlayProps<Config>) {
  const item = EMPHASIS[config.emphasis]
  const Icon = item.icon
  return (
    <section className="jarvis-client-overlay jarvis-client-overlay--summit" data-client-overlay="summit-installation-readiness">
      <span>Configured installation lens</span>
      <div><Icon size={18} aria-hidden /><h3>{config.title}</h3></div>
      <strong>{item.label}</strong>
      <p>{item.detail}</p>
      <small>{context.vocabulary.job} presentation · shared FINNOR Work truth</small>
    </section>
  )
}
