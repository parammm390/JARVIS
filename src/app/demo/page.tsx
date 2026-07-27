import type { Metadata } from "next";
import { DemoExperience } from "@/components/demo/DemoExperience";
import { Footer } from "@/components/sections/Footer";

export const metadata: Metadata = {
  title: "JARVIS Operations Demo",
  description: "See JARVIS operate your business.",
  alternates: {
    canonical: "https://finnorai.com/demo",
  },
  openGraph: {
    title: "Demo Builder | Finnor AI",
    description:
      "Build a personalized Finnor voice-native AI operations demo using your company name and website. See how unworked leads, web leads, and urgent water-treatment calls become executed business workflows.",
    url: "https://finnorai.com/demo",
    images: [
      {
        url: "https://finnorai.com/og-image.svg",
        width: 1200,
        height: 630,
        alt: "Finnor AI demo builder for water company voice-native AI operations workflows",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "Demo Builder | Finnor AI",
    description: "Choose what you want JARVIS to accomplish.",
    images: ["https://finnorai.com/og-image.svg"],
  },
};

export default function DemoPage() {
  return (
    <>
      <DemoExperience />
      <Footer />
    </>
  );
}
