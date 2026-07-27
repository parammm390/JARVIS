import type { Metadata } from "next"
import { buildSampleScenario } from "@/lib/lifecycle/build-scenario"
import { LifecycleExperience } from "@/components/lifecycle/LifecycleExperience"
import { Footer } from "@/components/sections/Footer"

export const metadata: Metadata = {
  title: "Customer Operations Workflow Demo",
  description:
    "See how JARVIS executes business workflows from customer acquisition through completion and ongoing operations, with full verification and audit records.",
  alternates: {
    canonical: "https://finnorai.com/demo/lifecycle",
  },
  openGraph: {
    title: "Customer Operations Workflow Demo | JARVIS",
    description:
      "Watch JARVIS execute a complete business workflow: the inbound request, the work plan, the approval, the execution, verification and audit record.",
    url: "https://finnorai.com/demo/lifecycle",
    images: [
      {
        url: "https://finnorai.com/og-image.svg",
        width: 1200,
        height: 630,
        alt: "JARVIS customer operations workflow demo with verification and audit records",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "Customer Operations Workflow Demo | JARVIS",
    description:
      "See JARVIS execute a complete business workflow with verification and audit records.",
    images: ["https://finnorai.com/og-image.svg"],
  },
}

export default function LifecycleDemoPage() {
  const sample = buildSampleScenario()

  return (
    <>
      <LifecycleExperience sample={sample} />
      <Footer />
    </>
  )
}
