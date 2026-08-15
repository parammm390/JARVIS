import type { Metadata } from "next";

import FinnorMarketingPage from "@/components/marketing/FinnorMarketingPage";

export const metadata: Metadata = {
  title: "Capabilities",
  description:
    "See how FINNOR coordinates customers, work, schedule, inventory, quotes, communication, money, research and agents across a configured company deployment.",
  alternates: { canonical: "https://finnorai.com/capabilities" },
  openGraph: {
    title: "Capabilities | FINNOR",
    description: "Operating coordination, bounded agents, approvals, execution, recovery and evidence—configured for the company.",
    url: "https://finnorai.com/capabilities",
    images: [{ url: "https://finnorai.com/og-image.svg", width: 1200, height: 630, alt: "FINNOR operating capabilities" }],
  },
};

export default function CapabilitiesRoute() {
  return <FinnorMarketingPage route="capabilities" />;
}
