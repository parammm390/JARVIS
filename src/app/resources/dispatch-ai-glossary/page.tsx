import type { Metadata } from "next";
import { DispatchAiGlossary } from "@/components/resources/DispatchAiGlossary";

export const metadata: Metadata = {
  title: "JARVIS Operations Glossary",
  description:
    "Plain-English definitions for voice commands, execution workflows, approval rules, and operational boundaries.",
  alternates: {
    canonical: "https://finnorai.com/resources/dispatch-ai-glossary",
  },
  openGraph: {
    title: "JARVIS Operations Glossary",
    description:
      "Plain-English definitions for JARVIS voice commands, execution workflows, approval rules, and operational boundaries.",
    url: "https://finnorai.com/resources/dispatch-ai-glossary",
    images: [
      {
        url: "https://finnorai.com/og-image.svg",
        width: 1200,
        height: 630,
        alt: "JARVIS operations glossary",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "JARVIS Operations Glossary",
    description:
      "Definitions for JARVIS voice commands, execution workflows, and approval rules.",
    images: ["https://finnorai.com/og-image.svg"],
  },
};

export default function DispatchAiGlossaryPage() {
  return <DispatchAiGlossary />;
}
