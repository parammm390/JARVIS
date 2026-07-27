import type { Metadata } from "next";
import { PilotSetupChecklist } from "@/components/resources/PilotSetupChecklist";

export const metadata: Metadata = {
  title: "JARVIS Deployment Checklist",
  description:
    "Checklist for approval rules, integration scope, user permissions, operational boundaries, and success criteria before JARVIS launch.",
  alternates: {
    canonical: "https://finnorai.com/resources/pilot-setup-checklist",
  },
  openGraph: {
    title: "Deployment Checklist | JARVIS",
    description:
      "Pre-launch checklist covering approval rules, integrations, permissions, boundaries, and success criteria before JARVIS deployment.",
    url: "https://finnorai.com/resources/pilot-setup-checklist",
    images: [
      {
        url: "https://finnorai.com/og-image.svg",
        width: 1200,
        height: 630,
        alt: "JARVIS deployment checklist",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "Deployment Checklist | JARVIS",
    description:
      "Pre-launch checklist for approval rules, integrations, and boundaries before JARVIS deployment.",
    images: ["https://finnorai.com/og-image.svg"],
  },
};

export default function PilotSetupChecklistPage() {
  return <PilotSetupChecklist />;
}
