import type { Metadata } from "next"
import WorkSurface from "@/components/jarvis/panels/WorkSurface"
import { BusinessWorldScene } from "@/components/jarvis/BusinessWorldScene"

export const metadata: Metadata = {
  title: "JARVIS — Work",
  description: "The Work Causal Spine: from instruction and approval to execution, evidence, and next action.",
}

export default function JarvisWorkPage() {
  return <><BusinessWorldScene scene="work" /><WorkSurface /></>
}
