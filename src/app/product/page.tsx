import type { Metadata } from "next";

import FinnorMarketingPage from "@/components/marketing/FinnorMarketingPage";

export const metadata: Metadata = {
  title: "Product | Customized Operating & Execution System",
  description:
    "FINNOR is the configured operating and execution layer for a water-treatment company. JARVIS is the command and work surface for directing it.",
  alternates: { canonical: "https://finnorai.com/product" },
  openGraph: {
    title: "Product | FINNOR",
    description: "The customized operating and execution layer behind JARVIS for water-treatment companies.",
    url: "https://finnorai.com/product",
    images: [{ url: "https://finnorai.com/og-image.svg", width: 1200, height: 630, alt: "FINNOR governed execution layer" }],
  },
};

export default function ProductRoute() {
  return <FinnorMarketingPage route="product" />;
}
