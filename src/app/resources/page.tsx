import type { Metadata } from "next";
import { ResourcesHub } from "@/components/resources/ResourcesHub";

export const metadata: Metadata = {
  title: "FINNOR Field Notes",
  description:
    "Practical guidance for evaluating, configuring and deploying a FINNOR operating and execution system inside a water treatment company.",
  alternates: {
    canonical: "https://finnorai.com/resources",
  },
  openGraph: {
    title: "FINNOR Field Notes",
    description:
      "Understand the company deployment, operating scope and control model behind FINNOR and JARVIS.",
    url: "https://finnorai.com/resources",
    images: [
      {
        url: "https://finnorai.com/og-image.svg",
        width: 1200,
        height: 630,
        alt: "FINNOR field notes for water treatment operators",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "FINNOR Field Notes",
    description:
      "Company deployment, operating scope, authority, recovery and evidence for water treatment operators.",
    images: ["https://finnorai.com/og-image.svg"],
  },
};

export default function ResourcesPage() {
  return <ResourcesHub />;
}
