import type { Metadata } from "next"
import { MissedCallCostCalculator } from "@/components/resources/MissedCallCostCalculator"

export const metadata: Metadata = {
  title: "Missed-Call Booking Value Estimator",
  description:
    "Conservatively estimate booked job value exposed by unanswered calls and slow-followed form leads for water businesses.",
  alternates: {
    canonical: "https://finnorai.com/resources/missed-call-cost-calculator",
  },
  openGraph: {
    title: "Missed-Call Booking Estimator | Finnor AI",
    description:
      "Estimate the booked job value at risk when inbound calls go unanswered at your water treatment or well pump service company.",
    url: "https://finnorai.com/resources/missed-call-cost-calculator",
    images: [
      {
        url: "https://finnorai.com/og-image.svg",
        width: 1200,
        height: 630,
        alt: "Finnor AI missed-call revenue estimator",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "Missed-Call Booking Estimator | Finnor AI",
    description:
      "Estimate the booked job value at risk when inbound calls go unanswered at your water treatment or well pump service company.",
    images: ["https://finnorai.com/og-image.svg"],
  },
}

export default function MissedCallCostCalculatorPage() {
  return <MissedCallCostCalculator />
}
