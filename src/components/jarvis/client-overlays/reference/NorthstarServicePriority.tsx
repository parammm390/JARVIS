import { Clock3, HeartHandshake, ReceiptText } from "lucide-react"
import type { TenantOverlayProps } from "../../experience/contracts"

type Config = { title: string; emphasis: "response" | "retention" | "cash" }

const EMPHASIS = {
  response: { icon: Clock3, label: "Response posture", detail: "Service urgency is emphasized before starting governed Work." },
  retention: { icon: HeartHandshake, label: "Relationship posture", detail: "Customer continuity is emphasized alongside the current operating queue." },
  cash: { icon: ReceiptText, label: "Cash posture", detail: "Invoice pressure is emphasized without changing collection authority or policy." },
} as const

export default function NorthstarServicePriority({ context, config }: TenantOverlayProps<Config>) {
  const item = EMPHASIS[config.emphasis]
  const Icon = item.icon
  return (
    <section className="jarvis-client-overlay jarvis-client-overlay--northstar" data-client-overlay="northstar-service-priority">
      <span>Configured service lens</span>
      <div><Icon size={18} aria-hidden /><h3>{config.title}</h3></div>
      <strong>{item.label}</strong>
      <p>{item.detail}</p>
      <small>{context.vocabulary.serviceVisit} presentation · shared FINNOR Work truth</small>
    </section>
  )
}
