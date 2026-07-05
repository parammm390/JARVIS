import type { Metadata } from "next"
import { TrustSafetyPage } from "@/components/resources/TrustSafetyPage"

export const metadata: Metadata = {
  title: "Trust & Safety",
  description:
    "How Finnor AI helps book water jobs and route urgent well pump calls while keeping humans in control of quotes, dispatch, repairs, ETAs, and final promises.",
  alternates: {
    canonical: "https://finnorai.com/trust-safety",
  },
  openGraph: {
    title: "Trust & Safety | Finnor AI",
    description:
      "How Finnor helps recover water leads and book next steps while keeping repair decisions, quotes, dispatch, ETAs, and customer promises with humans.",
    url: "https://finnorai.com/trust-safety",
    images: [
      {
        url: "https://finnorai.com/og-image.svg",
        width: 1200,
        height: 630,
        alt: "Finnor AI trust and safety",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "Trust & Safety | Finnor AI",
    description:
      "How Finnor keeps humans in control while helping recover water leads and book next steps.",
    images: ["https://finnorai.com/og-image.svg"],
  },
}

export default function TrustSafetyRoute() {
  return <TrustSafetyPage />
}
