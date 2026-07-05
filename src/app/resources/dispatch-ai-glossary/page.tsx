import type { Metadata } from "next"
import { DispatchAiGlossary } from "@/components/resources/DispatchAiGlossary"

export const metadata: Metadata = {
  title: "Water Booking & Lead Recovery Glossary",
  description:
    "Operator-friendly definitions for missed-call recovery, water test booking, quote follow-up, urgency routing, and human-controlled service promises.",
  alternates: {
    canonical: "https://finnorai.com/resources/dispatch-ai-glossary",
  },
  openGraph: {
    title: "AI Booking Glossary | Finnor AI",
    description:
      "Plain-English definitions for AI booking, speed-to-lead follow-up, urgency routing, and lead recovery for water treatment dealers and well pump service operators.",
    url: "https://finnorai.com/resources/dispatch-ai-glossary",
    images: [
      {
        url: "https://finnorai.com/og-image.svg",
        width: 1200,
        height: 630,
        alt: "Finnor AI response glossary",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "AI Booking Glossary | Finnor AI",
    description:
      "Plain-English definitions for AI booking, urgency routing, and lead recovery for water business operators.",
    images: ["https://finnorai.com/og-image.svg"],
  },
}

export default function DispatchAiGlossaryPage() {
  return <DispatchAiGlossary />
}
