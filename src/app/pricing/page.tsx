import type { Metadata } from "next";

import FinnorMarketingPage from "@/components/marketing/FinnorMarketingPage";

export const metadata: Metadata = {
  title: "Pricing | Scoped FINNOR Deployment",
  description:
    "Configure a FINNOR deployment by interaction, intelligence policy, operating coverage, workflows, systems, locations, authority, workspaces and support. Production starts around $30,000.",
  alternates: { canonical: "https://finnorai.com/pricing" },
  openGraph: {
    title: "Pricing | FINNOR",
    description: "Shape a buyer-friendly FINNOR deployment boundary and see a credible indicative range. Production starts around $30,000.",
    url: "https://finnorai.com/pricing",
    images: [{ url: "https://finnorai.com/og-image.svg", width: 1200, height: 630, alt: "FINNOR scoped deployment pricing" }],
  },
};

export default function PricingRoute() {
  return <FinnorMarketingPage route="pricing" />;
}
