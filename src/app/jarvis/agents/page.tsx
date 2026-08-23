import type { Metadata } from "next"
import AgentFleetSurface from "@/components/jarvis/agents/AgentFleetSurface"
import { BusinessWorldScene } from "@/components/jarvis/BusinessWorldScene"

export const metadata: Metadata = {
  title: "JARVIS — Agents",
  description: "Agent Fleet: five bounded operating channels under one JARVIS authority boundary.",
}

export default function AgentsPage() {
  return <><BusinessWorldScene scene="inventory" /><BusinessWorldScene scene="computer" /><AgentFleetSurface /></>
}
