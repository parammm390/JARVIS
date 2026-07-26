import type { Metadata } from "next"
import { Hero } from "@/components/sections/Hero"
import { PersonalizedDemoBuilder } from "@/components/sections/PersonalizedDemoBuilder"
import { Solution } from "@/components/sections/Solution"
import { RevenueLeak } from "@/components/sections/RevenueLeak"
import { LiveWorkflow } from "@/components/sections/LiveWorkflow"
import { CommandBridgeProof } from "@/components/sections/jarvis-proof/CommandBridgeProof"
import { Outcome } from "@/components/sections/Outcome"
import { Pricing } from "@/components/sections/Pricing"
import { FirstSevenDays } from "@/components/sections/FirstSevenDays"
import { FAQ } from "@/components/sections/FAQ"
import { Cta } from "@/components/sections/Cta"
import { Footer } from "@/components/sections/Footer"

export const metadata: Metadata = {
  title: {
    absolute: "Finnor AI | Give It an Instruction. Watch It Ask Before It Acts.",
  },
  description:
    "JARVIS drafts the quote, the invoice, the reschedule, all against your real price book, in seconds. Then it waits for your yes. Approve it and there's a receipt. For water treatment and well pump companies.",
  alternates: {
    canonical: "https://finnorai.com/",
  },
  openGraph: {
    title: "Finnor AI | Give It an Instruction. Watch It Ask Before It Acts.",
    description:
      "JARVIS drafts the quote, the invoice, the reschedule, all against your real price book, in seconds. Then it waits for your yes. Approve it and there's a receipt.",
    url: "https://finnorai.com/",
    images: [
      {
        url: "https://finnorai.com/og-image.svg",
        width: 1200,
        height: 630,
        alt: "JARVIS, an operations console for water treatment and well pump companies",
      },
    ],
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Finnor AI | Give It an Instruction. Watch It Ask Before It Acts.",
    description:
      "JARVIS drafts the quote, the invoice, the reschedule, all against your real price book, in seconds. Then it waits for your yes. Approve it and there's a receipt.",
    images: [
      {
        url: "https://finnorai.com/og-image.svg",
        alt: "JARVIS, an operations console for water treatment and well pump companies",
      },
    ],
  },
}

export default function Home() {
  return (
    <main className="healthcare-page flex min-h-screen w-full flex-col selection:bg-teal-200/40">
      <Hero />
      <RevenueLeak />
      <LiveWorkflow />
      <CommandBridgeProof />
      <Solution />
      <Outcome />
      <PersonalizedDemoBuilder />
      <Pricing />
      <FirstSevenDays />
      <FAQ />
      <Cta />
      <Footer />
    </main>
  )
}
