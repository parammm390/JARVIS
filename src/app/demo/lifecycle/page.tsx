import type { Metadata } from "next"
import { buildSampleScenario } from "@/lib/lifecycle/build-scenario"
import { LifecycleExperience } from "@/components/lifecycle/LifecycleExperience"
import { Footer } from "@/components/sections/Footer"

export const metadata: Metadata = {
  title: "Customer Lifecycle Demo — One Continuous Memory",
  description:
    "Build a two-year customer lifecycle on live public water data: the after-hours call, the real water record, the sizing math, the quote at your prices, the booked visit, the documented job, the review, the check-ins, the referral, and the upsell — one continuous memory.",
  alternates: {
    canonical: "https://finnorai.com/demo/lifecycle",
  },
  openGraph: {
    title: "Lifecycle Demo | Finnor AI",
    description:
      "The call was minute one. Watch one customer record evolve across two years — real water data, real sizing math, one continuous memory.",
    url: "https://finnorai.com/demo/lifecycle",
    images: [
      {
        url: "https://finnorai.com/og-image.svg",
        width: 1200,
        height: 630,
        alt: "Finnor AI customer lifecycle demo — one continuous memory across two years",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "Lifecycle Demo | Finnor AI",
    description:
      "One customer, one continuous memory, two years — computed on real public water data.",
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
