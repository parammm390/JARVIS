import type { Metadata } from "next"
import { notFound } from "next/navigation"
import { Bridge as InstructionThreadBridge } from "@/components/jarvis/bridge/ThreadBridge"

export const metadata: Metadata = {
  title: "FINNOR JARVIS",
  description: "The Instruction Thread — tell JARVIS what you want, watch it work, see exactly what changed.",
}

// P2.T5 (plan v3 §8 PHASE 2, L8): the Bridge becomes the product here, behind
// this flag, at this new route. `/jarvis` is untouched (hard rule 9) until P6's
// own one-line cutover commit. The flag is read server-side so that when it is
// off, the route genuinely does not exist (404) rather than existing-but-empty —
// the same "no dead affordance" posture §8/PHASE 6 uses for role-hidden surfaces.
export default function JarvisNextPage() {
  if (process.env.NEXT_PUBLIC_JARVIS_NEXT !== "1") notFound()
  return <InstructionThreadBridge />
}
