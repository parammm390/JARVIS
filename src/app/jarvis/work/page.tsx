import type { Metadata } from "next"
import WorkSurface from "@/components/jarvis/panels/WorkSurface"
import { JarvisAuthProvider } from "@/components/jarvis/lib/jarvis-auth"
import { JarvisDataProvider } from "@/components/jarvis/lib/data-core"

export const metadata: Metadata = {
  title: "JARVIS — Work",
  description: "The Work Causal Spine: from instruction and approval to execution, evidence, and next action.",
}

export default function JarvisWorkPage() {
  return (
    <JarvisAuthProvider>
      <JarvisDataProvider>
        <WorkSurface />
      </JarvisDataProvider>
    </JarvisAuthProvider>
  )
}
