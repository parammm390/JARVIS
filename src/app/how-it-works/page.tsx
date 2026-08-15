import type { Metadata } from "next";

import FinnorMarketingPage from "@/components/marketing/FinnorMarketingPage";

export const metadata: Metadata = {
  title: "How It Works | From Operating Review to Production",
  description:
    "See how FINNOR maps a company, configures systems and authority, certifies the first operating chain, activates production and supports expansion.",
  alternates: { canonical: "https://finnorai.com/how-it-works" },
  openGraph: {
    title: "How It Works | FINNOR",
    description: "Operating review, configuration, certification, production activation and governed execution inside JARVIS.",
    url: "https://finnorai.com/how-it-works",
    images: [{ url: "https://finnorai.com/og-image.svg", width: 1200, height: 630, alt: "FINNOR governed execution flow" }],
  },
};

export default function HowItWorksRoute() {
  return <FinnorMarketingPage route="how-it-works" />;
}
