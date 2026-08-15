import type { Metadata } from "next";
import { DispatchAiGlossary } from "@/components/resources/DispatchAiGlossary";

export const metadata: Metadata = {
  title: "FINNOR Operating Glossary",
  description: "Plain-language definitions for FINNOR deployments, operating surfaces, JARVIS, authority, model routing, recovery and evidence.",
  alternates: { canonical: "https://finnorai.com/resources/operating-glossary" },
  openGraph: {
    title: "FINNOR Operating Glossary",
    description: "The language behind a customized AI operating and execution system for water treatment companies.",
    url: "https://finnorai.com/resources/operating-glossary",
    images: [{ url: "https://finnorai.com/og-image.svg", width: 1200, height: 630, alt: "FINNOR operating and execution glossary" }],
  },
};

export default function OperatingGlossaryPage() {
  return <DispatchAiGlossary />;
}
