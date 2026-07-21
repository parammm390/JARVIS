import type { Metadata } from "next"
import { Stage } from "@/components/jarvis/Stage"

export const metadata: Metadata = {
  title: "Stage — FINNOR JARVIS",
  description: "Internal dev harness for JARVIS primitives, choreography, and renderers.",
  robots: { index: false, follow: false },
}

export default function JarvisStagePage() {
  return <Stage />
}
