import type { Metadata } from "next";

import FinnorMarketingPage from "@/components/marketing/FinnorMarketingPage";

export const metadata: Metadata = {
  title: "Product | Governed Execution for Water Treatment",
  description:
    "FINNOR is the governed execution layer for water-treatment companies. JARVIS assembles context, plans change, checks authority, executes and leaves evidence.",
  alternates: { canonical: "https://finnorai.com/product" },
  openGraph: {
    title: "Product | FINNOR",
    description: "The governed execution layer behind JARVIS for water-treatment companies.",
    url: "https://finnorai.com/product",
    images: [{ url: "https://finnorai.com/og-image.svg", width: 1200, height: 630, alt: "FINNOR governed execution layer" }],
  },
};

export default function ProductRoute() {
  return <FinnorMarketingPage route="product" />;
}
