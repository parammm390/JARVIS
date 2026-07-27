import type { Metadata } from "next";
import { DemoExperience } from "@/components/demo/DemoExperience";
import { Footer } from "@/components/sections/Footer";

export const metadata: Metadata = {
  title: "JARVIS Operations Demo",
  description: "Enter your company and choose a business outcome. JARVIS builds a demonstration using public website information and the details you provide.",
  alternates: {
    canonical: "https://finnorai.com/demo",
  },
  openGraph: {
    title: "See JARVIS Operate Your Business",
    description:
      "Enter your company and choose a business outcome. JARVIS builds a clearly labelled demonstration using public website information and the details you provide. Unknown information stays marked unknown.",
    url: "https://finnorai.com/demo",
    images: [
      {
        url: "https://finnorai.com/og-image.svg",
        width: 1200,
        height: 630,
        alt: "JARVIS demo: See the voice-native AI operations platform in action",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "See JARVIS Operate Your Business",
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
