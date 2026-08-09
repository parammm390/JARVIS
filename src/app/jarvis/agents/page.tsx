import type { Metadata } from "next"
import AgentFleetSurface from "@/components/jarvis/agents/AgentFleetSurface"
import { JarvisAuthProvider } from "@/components/jarvis/lib/jarvis-auth"

export const metadata: Metadata = {
  title: "JARVIS — Agents",
  description: "Agent Fleet: five bounded operating channels under one JARVIS authority boundary.",
}

export default function AgentsPage() {
  return (
    <JarvisAuthProvider>
      <AgentFleetSurface />
    </JarvisAuthProvider>
  )
}
