import type { Metadata } from "next";
import { MissedCallCostCalculator } from "@/components/resources/MissedCallCostCalculator";

export const metadata: Metadata = {
  title: "Lead Follow-up Value Estimator",
  description:
    "Conservatively estimate booked job value exposed by unanswered calls and slow-followed form leads for water businesses.",
  alternates: {
    canonical: "https://finnorai.com/resources/lead-follow-up-cost-calculator",
  },
  openGraph: {
    title: "Lead Follow-up Estimator | FINNOR JARVIS",
    description:
      "Estimate the booked job value at risk when inbound calls go unanswered at your water treatment or water-treatment operations company.",
    url: "https://finnorai.com/resources/lead-follow-up-cost-calculator",
    images: [
      {
        url: "https://finnorai.com/og-image.svg",
        width: 1200,
        height: 630,
        alt: "Finnor AI lead-follow-up revenue estimator",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "Lead Follow-up Estimator | FINNOR JARVIS",
    description:
      "Estimate the booked job value at risk when inbound calls go unanswered at your water treatment or water-treatment operations company.",
    images: ["https://finnorai.com/og-image.svg"],
  },
};

export default function MissedCallCostCalculatorPage() {
  return <MissedCallCostCalculator />;
}
