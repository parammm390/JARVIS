import type { Metadata } from "next"
import { Hero } from "@/components/sections/Hero"
import { PersonalizedDemoBuilder } from "@/components/sections/PersonalizedDemoBuilder"
import { Solution } from "@/components/sections/Solution"
import { RevenueLeak } from "@/components/sections/RevenueLeak"
import { LiveWorkflow } from "@/components/sections/LiveWorkflow"
import { Outcome } from "@/components/sections/Outcome"
import { Pricing } from "@/components/sections/Pricing"
import { FirstSevenDays } from "@/components/sections/FirstSevenDays"
import { FAQ } from "@/components/sections/FAQ"
import { Cta } from "@/components/sections/Cta"
import { Footer } from "@/components/sections/Footer"

export const metadata: Metadata = {
  title: {
    absolute: "Finnor AI | The AI Quoting Agent That Remembers Every Customer",
  },
  description:
    "FINNOR answers the call, pulls live water data, quotes from your pricing, books by text, and remembers every household for years of reviews, check-ins, referrals, and upsells.",
  alternates: {
    canonical: "https://finnorai.com/",
  },
  openGraph: {
    title: "Finnor AI | The AI Quoting Agent That Remembers Every Customer",
    description:
      "Live water data, real sizing math, quotes from your pricing tier, and one household memory that compounds revenue for two years.",
    url: "https://finnorai.com/",
    images: [
      {
        url: "https://finnorai.com/og-image.svg",
        width: 1200,
        height: 630,
        alt: "Finnor AI booking and lead recovery for water treatment and well pump companies",
      },
    ],
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Finnor AI | The AI Quoting Agent That Remembers Every Customer",
    description:
      "Live water data, real sizing math, quotes from your pricing tier, and one household memory that compounds revenue for two years.",
    images: [
      {
        url: "https://finnorai.com/og-image.svg",
        alt: "Finnor AI booking and lead recovery for water treatment and well pump companies",
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
      <PersonalizedDemoBuilder />
      <Solution />
      <Outcome />
      <Pricing />
      <FirstSevenDays />
      <FAQ />
      <Cta />
      <Footer />
    </main>
  )
}
