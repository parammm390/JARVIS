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
    absolute: "Finnor AI | Never Lose Another After-Hours Water Call",
  },
  description:
    "The call you miss after 5pm books with your competitor tonight. FINNOR answers every one, pulls real water data, pre-qualifies the lead with a range from your pricing, books the free water test, and remembers every household for years of reviews, check-ins, referrals, and upsells.",
  alternates: {
    canonical: "https://finnorai.com/",
  },
  openGraph: {
    title: "Finnor AI | Never Lose Another After-Hours Water Call",
    description:
      "The call you miss at 6pm is a job your competitor books tonight. FINNOR answers it, pulls real water data, and pre-qualifies the lead with a range from your pricing before your team ever drives out.",
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
    title: "Finnor AI | Never Lose Another After-Hours Water Call",
    description:
      "The call you miss at 6pm is a job your competitor books tonight. FINNOR answers it, pulls real water data, and pre-qualifies the lead with a range from your pricing before your team ever drives out.",
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
