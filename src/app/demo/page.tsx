import type { Metadata } from "next";
import { DemoExperience } from "@/components/demo/DemoExperience";
import { ResourceFrame } from "@/components/resources/ResourceFrame";

export const metadata: Metadata = {
  title: "JARVIS Instruction Demo",
  description: "Put one customer interaction through a clearly labelled JARVIS instruction, context and handoff demonstration.",
  alternates: {
    canonical: "https://finnorai.com/demo",
  },
  openGraph: {
    title: "Follow One Instruction Through JARVIS",
    description:
      "A public voice-ingress demonstration of context assembly and governed handoff—not a representation of the full FINNOR product.",
    url: "https://finnorai.com/demo",
    images: [
      {
        url: "https://finnorai.com/og-image.svg",
        width: 1200,
        height: 630,
        alt: "JARVIS instruction and context demonstration",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "Follow One Instruction Through JARVIS",
    description: "See one public instruction channel assemble context and produce a governed handoff.",
    images: ["https://finnorai.com/og-image.svg"],
  },
};

export default function DemoPage() {
  return (
    <ResourceFrame>
      <DemoExperience />
    </ResourceFrame>
  );
}
