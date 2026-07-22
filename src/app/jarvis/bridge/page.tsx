import type { Metadata } from "next"
import { Bridge } from "@/components/jarvis/bridge/Bridge"

export const metadata: Metadata = {
  title: "FINNOR JARVIS — Command Bridge",
  description: "D1: the Command Bridge — real vitals, real activity, one continuous space.",
}

export default function JarvisBridgePage() {
  return <Bridge />
}
