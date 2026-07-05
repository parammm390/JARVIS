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
    absolute: "Finnor AI | Book More Water Jobs From the Leads You Already Get",
  },
  description:
    "Finnor turns missed calls, after-hours inquiries, overflow calls, and slow web leads into booked water tests, service appointments, or urgent owner/on-call routes.",
  alternates: {
    canonical: "https://finnorai.com/",
  },
  openGraph: {
    title: "Finnor AI | Book More Water Jobs From the Leads You Already Get",
    description:
      "Recover more water treatment and well pump jobs with faster response, booked appointments, and clear human-owned next steps.",
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
    title: "Finnor AI | Book More Water Jobs From the Leads You Already Get",
    description:
      "Recover more water treatment and well pump jobs with faster response, booked appointments, and clear human-owned next steps.",
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
