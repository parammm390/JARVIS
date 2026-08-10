import type { Metadata } from "next";

import FinnorMarketingPage from "@/components/marketing/FinnorMarketingPage";

export const metadata: Metadata = {
  title: "FAQ",
  description:
    "Direct answers about FINNOR, JARVIS, governed execution, authority, recovery, evidence, configured systems and scoped deployment pricing.",
  alternates: { canonical: "https://finnorai.com/faq" },
  openGraph: {
    title: "FAQ | FINNOR",
    description: "The product, authority and deployment answers behind FINNOR governed execution.",
    url: "https://finnorai.com/faq",
    images: [{ url: "https://finnorai.com/og-image.svg", width: 1200, height: 630, alt: "FINNOR FAQ" }],
  },
};

export default function FaqRoute() {
  return <FinnorMarketingPage route="faq" />;
}
