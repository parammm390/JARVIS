import type { Metadata } from "next";

import FinnorMarketingPage from "@/components/marketing/FinnorMarketingPage";

export const metadata: Metadata = {
  title: "Capabilities",
  description:
    "Explore how FINNOR grounds context, plans work, checks authority, activates systems, recovers safely and leaves evidence for water-treatment operations.",
  alternates: { canonical: "https://finnorai.com/capabilities" },
  openGraph: {
    title: "Capabilities | FINNOR",
    description: "Six capabilities that keep a water-treatment operating chain grounded and accountable.",
    url: "https://finnorai.com/capabilities",
    images: [{ url: "https://finnorai.com/og-image.svg", width: 1200, height: 630, alt: "FINNOR operating capabilities" }],
  },
};

export default function CapabilitiesRoute() {
  return <FinnorMarketingPage route="capabilities" />;
}
