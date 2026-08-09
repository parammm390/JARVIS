import type { Metadata } from "next";
import { ResourcesHub } from "@/components/resources/ResourcesHub";

export const metadata: Metadata = {
  title: "FINNOR Field Notes",
  description:
    "Practical explanations of FINNOR context, planning, authority, recovery and evidence for water treatment operators.",
  alternates: {
    canonical: "https://finnorai.com/resources",
  },
  openGraph: {
    title: "FINNOR Field Notes",
    description:
      "Understand the governed execution chain behind the FINNOR and JARVIS product.",
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
      "Context, planning, authority, recovery and evidence for water treatment operators.",
    images: ["https://finnorai.com/og-image.svg"],
  },
};

export default function ResourcesPage() {
  return <ResourcesHub />;
}
