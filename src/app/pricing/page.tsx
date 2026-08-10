import type { Metadata } from "next";

import FinnorMarketingPage from "@/components/marketing/FinnorMarketingPage";

export const metadata: Metadata = {
  title: "Pricing | Scoped FINNOR Deployment",
  description:
    "Contact FINNOR for pricing tied to your workflow, source records, authority boundaries, recovery requirements, onboarding, integrations and deployment support.",
  alternates: { canonical: "https://finnorai.com/pricing" },
  openGraph: {
    title: "Pricing | FINNOR",
    description: "Scoped deployment pricing for governed execution in water-treatment operations.",
    url: "https://finnorai.com/pricing",
    images: [{ url: "https://finnorai.com/og-image.svg", width: 1200, height: 630, alt: "FINNOR scoped deployment pricing" }],
  },
};

export default function PricingRoute() {
  return <FinnorMarketingPage route="pricing" />;
}
