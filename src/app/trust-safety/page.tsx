import type { Metadata } from "next";
import { TrustSafetyPage } from "@/components/resources/TrustSafetyPage";

export const metadata: Metadata = {
  title: "Trust & Safety",
  description:
    "JARVIS is designed to execute real business work without giving an AI unlimited authority. Every deployment defines what it may do automatically, what requires approval and what it must never do.",
  alternates: {
    canonical: "https://finnorai.com/trust-safety",
  },
  openGraph: {
    title: "Trust & Safety | FINNOR JARVIS",
    description: "Autonomy with permissions, verification and control.",
    url: "https://finnorai.com/trust-safety",
    images: [
      {
        url: "https://finnorai.com/og-image.svg",
        width: 1200,
        height: 630,
        alt: "FINNOR JARVIS trust and safety",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "Trust & Safety | FINNOR JARVIS",
    description: "Bounded autonomy for connected water-treatment operations.",
    images: ["https://finnorai.com/og-image.svg"],
  },
};

export default function TrustSafetyRoute() {
  return <TrustSafetyPage />;
}
