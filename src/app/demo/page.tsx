import type { Metadata } from "next";
import { DemoExperience } from "@/components/demo/DemoExperience";
import { ResourceFrame } from "@/components/resources/ResourceFrame";

export const metadata: Metadata = {
  title: "Optional Voice-Enabled Workflow Preview",
  description: "Preview one optional voice-enabled instruction channel and governed handoff inside JARVIS. This is not the full FINNOR company deployment.",
  alternates: {
    canonical: "https://finnorai.com/demo",
  },
  openGraph: {
    title: "Optional Voice-Enabled Workflow Preview | FINNOR",
    description:
      "A public preview of one optional channel—not a representation of the full FINNOR operating and execution system.",
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
    title: "Optional Voice-Enabled Workflow Preview | FINNOR",
    description: "See one optional channel assemble context and produce a governed handoff inside JARVIS.",
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
