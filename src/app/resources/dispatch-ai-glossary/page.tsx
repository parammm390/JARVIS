import type { Metadata } from "next";
import { DispatchAiGlossary } from "@/components/resources/DispatchAiGlossary";

export const metadata: Metadata = {
  title: "Water JARVIS Operations Glossary",
  description:
    "Operator-friendly definitions for lead follow-up, water test booking, quote follow-up, urgency routing, and human-controlled service promises.",
  alternates: {
    canonical: "https://finnorai.com/resources/dispatch-ai-glossary",
  },
  openGraph: {
    title: "AI Booking Glossary | Finnor AI",
    description:
      "Plain-English definitions for AI operations, speed-to-lead follow-up, urgency routing, and lead recovery for water treatment dealers and water-treatment operations operators.",
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
      "Plain-English definitions for AI operations, urgency routing, and lead recovery for water business operators.",
    images: ["https://finnorai.com/og-image.svg"],
  },
};

export default function DispatchAiGlossaryPage() {
  return <DispatchAiGlossary />;
}
