import type { Metadata } from "next"
import { DemoExperience } from "@/components/demo/DemoExperience"
import { Footer } from "@/components/sections/Footer"

export const metadata: Metadata = {
  title: "Company Booking Workflow Demo",
  description:
    "Build a FINNOR demo for turning missed calls, after-hours inquiries, and slow web leads into booked water tests, service appointments, or urgent owner/on-call routes.",
  alternates: {
    canonical: "https://finnorai.com/demo",
  },
  openGraph: {
    title: "Demo Builder | Finnor AI",
    description:
      "Build a personalized Finnor booking and lead recovery demo using your company name and website. See how missed calls, web leads, and urgent well pump calls become booked next steps.",
    url: "https://finnorai.com/demo",
    images: [
      {
        url: "https://finnorai.com/og-image.svg",
        width: 1200,
        height: 630,
        alt: "Finnor AI demo builder for water company booking and lead recovery workflows",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "Demo Builder | Finnor AI",
    description:
      "Build a personalized Finnor booking workflow demo for water treatment and well pump leads.",
    images: ["https://finnorai.com/og-image.svg"],
  },
}

export default function DemoPage() {
  return (
    <>
      <DemoExperience />
      <Footer />
    </>
  )
}
