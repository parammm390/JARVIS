import type { Metadata } from "next";
import { PilotSetupChecklist } from "@/components/resources/PilotSetupChecklist";

export const metadata: Metadata = {
  title: "Governed Deployment Checklist",
  description:
    "Certify one FINNOR workflow across sources, action contracts, authority, recovery and evidence before expanding production scope.",
  alternates: {
    canonical: "https://finnorai.com/resources/pilot-setup-checklist",
  },
  openGraph: {
    title: "Governed Deployment Checklist | FINNOR",
    description:
      "A production checklist for grounded, governed, recoverable and verifiable execution.",
    url: "https://finnorai.com/resources/pilot-setup-checklist",
    images: [
      {
        url: "https://finnorai.com/og-image.svg",
        width: 1200,
        height: 630,
        alt: "FINNOR governed deployment checklist",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "Governed Deployment Checklist | FINNOR",
    description:
      "Certify the execution chain before expanding it.",
    images: ["https://finnorai.com/og-image.svg"],
  },
};

export default function PilotSetupChecklistPage() {
  return <PilotSetupChecklist />;
}
