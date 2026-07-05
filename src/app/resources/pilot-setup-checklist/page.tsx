import type { Metadata } from "next"
import { PilotSetupChecklist } from "@/components/resources/PilotSetupChecklist"

export const metadata: Metadata = {
  title: "Booking & Lead Recovery Pilot Setup Checklist",
  description:
    "Checklist for coverage windows, lead sources, booking questions, urgent routes, alert paths, and success metrics before a Finnor pilot.",
  alternates: {
    canonical: "https://finnorai.com/resources/pilot-setup-checklist",
  },
  openGraph: {
    title: "Pilot Setup Checklist | Finnor AI",
    description:
      "Pre-launch checklist covering call routing, booking questions, alert paths, and human ownership review before a Finnor booking and lead recovery pilot goes live.",
    url: "https://finnorai.com/resources/pilot-setup-checklist",
    images: [
      {
        url: "https://finnorai.com/og-image.svg",
        width: 1200,
        height: 630,
        alt: "Finnor AI pilot setup checklist",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "Pilot Setup Checklist | Finnor AI",
    description:
      "Pre-launch checklist for routing, booking questions, and alert paths before a Finnor pilot goes live.",
    images: ["https://finnorai.com/og-image.svg"],
  },
}

export default function PilotSetupChecklistPage() {
  return <PilotSetupChecklist />
}
