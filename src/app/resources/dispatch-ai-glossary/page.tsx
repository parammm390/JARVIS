import type { Metadata } from "next";
import { DispatchAiGlossary } from "@/components/resources/DispatchAiGlossary";

export const metadata: Metadata = {
  title: "FINNOR Operating Glossary",
  description:
    "Plain-language definitions for FINNOR work roots, action contracts, authority boundaries, durable workflows and decision receipts.",
  alternates: {
    canonical: "https://finnorai.com/resources/dispatch-ai-glossary",
  },
  openGraph: {
    title: "FINNOR Operating Glossary",
    description:
      "The language behind accountable execution for water treatment companies.",
    url: "https://finnorai.com/resources/dispatch-ai-glossary",
    images: [
      {
        url: "https://finnorai.com/og-image.svg",
        width: 1200,
        height: 630,
        alt: "FINNOR governed execution glossary",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "FINNOR Operating Glossary",
    description:
      "Definitions for context, action contracts, authority, recovery and evidence.",
    images: ["https://finnorai.com/og-image.svg"],
  },
};

export default function DispatchAiGlossaryPage() {
  return <DispatchAiGlossary />;
}
