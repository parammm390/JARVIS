import { redirect } from "next/navigation"
import { InstructionThreadBridge } from "@/components/jarvis/bridge/ThreadBridge"

export default function JarvisNextPage() {
  // Keep the retired route closed in every real build. Playwright's local
  // server opts into this labelled fixture surface explicitly so the historic
  // Thread regression matrix can exercise the same production components
  // without restoring a second customer-facing JARVIS workspace.
  if (process.env.NODE_ENV === "production" || process.env.NEXT_PUBLIC_JARVIS_NEXT !== "1") redirect("/jarvis")
  return <InstructionThreadBridge />
}
