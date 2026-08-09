import type { Metadata } from "next"
import { buildSampleScenario } from "@/lib/lifecycle/build-scenario"
import { LifecycleExperience } from "@/components/lifecycle/LifecycleExperience"
import { ResourceFrame } from "@/components/resources/ResourceFrame"

export const metadata: Metadata = {
  title: "JARVIS Work-Root Lifecycle Demo",
  description:
    "A simulated walkthrough of one household work root across context, customer history, service and follow-up.",
  alternates: {
    canonical: "https://finnorai.com/demo/lifecycle",
  },
  openGraph: {
    title: "Work-Root Lifecycle Demo | JARVIS",
    description:
      "Watch one simulated household remain connected across a long-running operational history.",
    url: "https://finnorai.com/demo/lifecycle",
    images: [
      {
        url: "https://finnorai.com/og-image.svg",
        width: 1200,
        height: 630,
        alt: "JARVIS household work-root lifecycle demonstration",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "Work-Root Lifecycle Demo | JARVIS",
    description:
      "A simulated long-running context and customer-history walkthrough.",
    images: ["https://finnorai.com/og-image.svg"],
  },
}

export default function LifecycleDemoPage() {
  const sample = buildSampleScenario()

  return (
    <ResourceFrame>
      <LifecycleExperience sample={sample} />
    </ResourceFrame>
  )
}
