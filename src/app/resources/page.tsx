import type { Metadata } from "next";
import { ResourcesHub } from "@/components/resources/ResourcesHub";

export const metadata: Metadata = {
  title: "JARVIS Operations Resources",
  description:
    "Practical tools and guidance for water-treatment companies implementing voice-native AI operations and connected business workflows.",
  alternates: {
    canonical: "https://finnorai.com/resources",
  },
  openGraph: {
    title: "Resources | JARVIS",
    description:
      "Practical tools and resources for water-treatment companies implementing JARVIS voice-native AI operations.",
    url: "https://finnorai.com/resources",
    images: [
      {
        url: "https://finnorai.com/og-image.svg",
        width: 1200,
        height: 630,
        alt: "JARVIS resources for water-treatment companies",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "Resources | JARVIS",
    description:
      "Tools and resources for water-treatment companies implementing JARVIS.",
    images: ["https://finnorai.com/og-image.svg"],
  },
};

export default function ResourcesPage() {
  return <ResourcesHub />;
}
