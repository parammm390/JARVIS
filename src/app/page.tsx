import type { Metadata } from "next";
import { Hero } from "@/components/sections/Hero";
import { PersonalizedDemoBuilder } from "@/components/sections/PersonalizedDemoBuilder";
import { Solution } from "@/components/sections/Solution";
import { RevenueLeak } from "@/components/sections/RevenueLeak";
import { LiveWorkflow } from "@/components/sections/LiveWorkflow";
import { CommandBridgeProof } from "@/components/sections/jarvis-proof/CommandBridgeProof";
import { Outcome } from "@/components/sections/Outcome";
import { Pricing } from "@/components/sections/Pricing";
import { FirstSevenDays } from "@/components/sections/FirstSevenDays";
import { FAQ } from "@/components/sections/FAQ";
import { Cta } from "@/components/sections/Cta";
import { Footer } from "@/components/sections/Footer";

export const metadata: Metadata = {
  title: {
    absolute:
      "FINNOR JARVIS | Voice-Native AI Operations for Water Treatment Companies",
  },
  description:
    "Run calls, CRM, scheduling, proposals, invoices, inventory, technicians and campaigns by talking to JARVIS, the voice-native AI operations platform for water-treatment companies.",
  alternates: {
    canonical: "https://finnorai.com/",
  },
  openGraph: {
    title:
      "FINNOR JARVIS | Voice-Native AI Operations for Water Treatment Companies",
    description:
      "Run calls, CRM, scheduling, proposals, invoices, inventory, technicians and campaigns by talking to JARVIS.",
    url: "https://finnorai.com/",
    images: [
      {
        url: "https://finnorai.com/og-image.svg",
        width: 1200,
        height: 630,
        alt: "JARVIS, the voice-native AI operations platform for water-treatment companies",
      },
    ],
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title:
      "FINNOR JARVIS | Voice-Native AI Operations for Water Treatment Companies",
    description:
      "Run calls, CRM, scheduling, proposals, invoices, inventory, technicians and campaigns by talking to JARVIS.",
    images: [
      {
        url: "https://finnorai.com/og-image.svg",
        alt: "JARVIS, the voice-native AI operations platform for water-treatment companies",
      },
    ],
  },
};

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
  );
}
