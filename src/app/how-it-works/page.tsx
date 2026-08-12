import type { Metadata } from "next";

import FinnorMarketingPage from "@/components/marketing/FinnorMarketingPage";

export const metadata: Metadata = {
  title: "How It Works | Instruction to Evidence",
  description:
    "See FINNOR's seven-stage governed execution flow: Instruction, Context, Plan, Authority, Execution, Recovery and Evidence.",
  alternates: { canonical: "https://finnorai.com/how-it-works" },
  openGraph: {
    title: "How It Works | FINNOR",
    description: "Instruction → Context → Plan → Authority → Execution → Recovery → Evidence.",
    url: "https://finnorai.com/how-it-works",
    images: [{ url: "https://finnorai.com/og-image.svg", width: 1200, height: 630, alt: "FINNOR governed execution flow" }],
  },
};

export default function HowItWorksRoute() {
  return <FinnorMarketingPage route="how-it-works" />;
}
