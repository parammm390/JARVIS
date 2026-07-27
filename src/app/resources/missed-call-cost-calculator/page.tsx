import type { Metadata } from "next";
import { MissedCallCostCalculator } from "@/components/resources/MissedCallCostCalculator";

export const metadata: Metadata = {
  title: "Operations Impact Estimator",
  description:
    "Estimate the business value at risk from unexecuted workflows, delayed approvals, and stalled customer actions.",
  alternates: {
    canonical: "https://finnorai.com/resources/missed-call-cost-calculator",
  },
  openGraph: {
    title: "Operations Impact Estimator | JARVIS",
    description:
      "Estimate the business value at risk from unexecuted workflows, delayed approvals, and stalled customer actions at your water-treatment company.",
    url: "https://finnorai.com/resources/missed-call-cost-calculator",
    images: [
      {
        url: "https://finnorai.com/og-image.svg",
        width: 1200,
        height: 630,
        alt: "JARVIS operations impact estimator",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "Operations Impact Estimator | JARVIS",
    description:
      "Estimate the business value at risk from unexecuted workflows and delayed actions.",
    images: ["https://finnorai.com/og-image.svg"],
  },
};

export default function MissedCallCostCalculatorPage() {
  return <MissedCallCostCalculator />;
}
