import type { Metadata } from "next"
import PersonalizedHome from "@/components/jarvis/PersonalizedHome"

export const metadata: Metadata = {
  title: "JARVIS — Governed Command Surface",
  description:
    "Give FINNOR an instruction. JARVIS assembles operating context, forms a plan, requests the right approvals, executes through connected systems, and records the evidence.",
}

export default function JarvisPage() {
  return <PersonalizedHome />
}
