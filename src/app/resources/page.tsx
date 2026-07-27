import type { Metadata } from "next";
import { ResourcesHub } from "@/components/resources/ResourcesHub";

export const metadata: Metadata = {
  title: "Water JARVIS Operations Resources",
  description:
    "Practical tools for water treatment, water dealer, and water-treatment companies turning unworked leads, quote requests, form leads, and inbound inquiries into booked jobs.",
  alternates: {
    canonical: "https://finnorai.com/resources",
  },
  openGraph: {
    title: "Resources | Finnor AI",
    description:
      "Tools for water treatment dealers and water-treatment operations teams evaluating lead-follow-up coverage, faster lead response, recovered jobs, and AI operations workflows.",
    url: "https://finnorai.com/resources",
    images: [
      {
        url: "https://finnorai.com/og-image.svg",
        width: 1200,
        height: 630,
        alt: "Finnor AI resources for water treatment and water-treatment companies",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "Resources | Finnor AI",
    description:
      "Tools for water treatment dealers and water-treatment operations teams evaluating lead-follow-up coverage, faster response, and booking workflows.",
    images: ["https://finnorai.com/og-image.svg"],
  },
};

export default function ResourcesPage() {
  return <ResourcesHub />;
}
