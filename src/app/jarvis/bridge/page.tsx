import type { Metadata } from "next"
import { Bridge } from "@/components/jarvis/bridge/Bridge"

export const metadata: Metadata = {
  title: "JARVIS — Command Bridge",
  description: "The JARVIS command bridge: live vitals, activity, approvals, and evidence in one continuous space.",
}

export default function JarvisBridgePage() {
  return <Bridge />
}
