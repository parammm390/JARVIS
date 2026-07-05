import type { Metadata } from "next"
import { ResourcesHub } from "@/components/resources/ResourcesHub"

export const metadata: Metadata = {
  title: "Water Booking & Lead Recovery Resources",
  description:
    "Practical tools for water treatment, water dealer, and well pump companies turning missed calls, quote requests, form leads, and after-hours inquiries into booked jobs.",
  alternates: {
    canonical: "https://finnorai.com/resources",
  },
  openGraph: {
    title: "Resources | Finnor AI",
    description:
      "Tools for water treatment dealers and well pump service teams evaluating missed-call coverage, faster lead response, recovered jobs, and AI booking workflows.",
    url: "https://finnorai.com/resources",
    images: [
      {
        url: "https://finnorai.com/og-image.svg",
        width: 1200,
        height: 630,
        alt: "Finnor AI resources for water treatment and well pump companies",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "Resources | Finnor AI",
    description:
      "Tools for water treatment dealers and well pump service teams evaluating missed-call coverage, faster response, and booking workflows.",
    images: ["https://finnorai.com/og-image.svg"],
  },
}

export default function ResourcesPage() {
  return <ResourcesHub />
}
