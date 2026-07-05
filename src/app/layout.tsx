import type { Metadata } from "next"
import { Inter } from "next/font/google"
import "./globals.css"

import CustomCursor from "@/components/ui/custom-cursor"
import ParticleNetwork from "@/components/ui/particle-network"
import ScrollProgress from "@/components/ui/scroll-progress"
import GrainOverlay from "@/components/ui/grain-overlay"
import SmoothScroll from "@/components/ui/smooth-scroll"
import { FinnorAIConcierge } from "@/components/ai-concierge/FinnorAIConcierge"

const inter = Inter({ subsets: ["latin"] })

export const metadata: Metadata = {
  metadataBase: new URL("https://finnorai.com"),
  applicationName: "Finnor AI",
  title: {
    default: "Finnor | AI Quoting Agent for Water Treatment & Well Pump Companies",
    template: "%s | Finnor AI",
  },
  description:
    "FINNOR answers every missed call, pulls live public water data by ZIP, sizes the system with real math, quotes from your pricing tier, books by text, and remembers every household for years: reviews, check-ins, referrals, upsells, LTV.",
  keywords: [
    "water lead recovery",
    "water appointment booking",
    "water test booking",
    "water treatment lead follow-up",
    "well pump repair answering service",
    "water well service dispatch",
    "no-water emergency route",
    "after-hours well pump dispatch",
    "missed call booking for well service companies",
    "Finnor AI",
    "Finnor water lead recovery",
  ],
  authors: [{ name: "Finnor AI", url: "https://finnorai.com" }],
  creator: "Finnor AI",
  publisher: "Finnor AI",
  category: "Business software",
  alternates: {
    canonical: "https://finnorai.com/",
  },
  openGraph: {
    title: "Finnor | AI Booking and Lead Recovery for Water Companies",
    description:
      "Book more jobs from the leads you already get: missed calls, after-hours inquiries, overflow calls, and slow web forms.",
    url: "https://finnorai.com/",
    siteName: "Finnor AI",
    images: [
      {
        url: "/og-image.svg",
        width: 1200,
        height: 630,
        alt: "Finnor booking and lead recovery system for water treatment and well pump companies",
      },
    ],
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Finnor | AI Booking and Lead Recovery for Water Companies",
    description:
      "Book more jobs from the leads you already get: missed calls, after-hours inquiries, overflow calls, and slow web forms.",
    images: ["/og-image.svg"],
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      "max-image-preview": "large",
      "max-snippet": -1,
      "max-video-preview": -1,
    },
  },
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="en">
      <body className={`${inter.className} antialiased`}>
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: JSON.stringify({
              "@context": "https://schema.org",
              "@graph": [
                {
                  "@type": "Organization",
                  "@id": "https://finnorai.com/#organization",
                  name: "Finnor AI",
                  alternateName: ["FINNOR", "Finnor"],
                  url: "https://finnorai.com",
                  email: "param@finnorai.com",
                  description:
                    "AI booking and lead recovery system for water treatment leads, well pump emergencies, web inquiries, and speed-to-lead follow-up.",
                  sameAs: ["https://www.linkedin.com/in/param-dave16"],
                },
                {
                  "@type": "WebSite",
                  "@id": "https://finnorai.com/#website",
                  url: "https://finnorai.com",
                  name: "Finnor AI",
                  alternateName: "FINNOR",
                  publisher: { "@id": "https://finnorai.com/#organization" },
                  inLanguage: "en-US",
                },
                {
                  "@type": "WebPage",
                  "@id": "https://finnorai.com/#webpage",
                  url: "https://finnorai.com",
                  name: "Finnor | AI Booking and Lead Recovery for Water Companies",
                  description:
                    "Finnor turns missed calls, after-hours inquiries, overflow calls, and slow web leads into booked water tests, service appointments, or urgent owner/on-call routes.",
                  isPartOf: { "@id": "https://finnorai.com/#website" },
                  about: { "@id": "https://finnorai.com/#organization" },
                  inLanguage: "en-US",
                },
                {
                  "@type": "SoftwareApplication",
                  name: "Finnor Booking and Lead Recovery System",
                  applicationCategory: "BusinessApplication",
                  operatingSystem: "Cloud",
                  url: "https://finnorai.com",
                  description:
                    "Productized booking and lead recovery workflows for water treatment leads, well pump emergencies, web inquiries, and speed-to-lead follow-up.",
                  offers: {
                    "@type": "AggregateOffer",
                    lowPrice: "799",
                    highPrice: "1500",
                    priceCurrency: "USD",
                  },
                },
              ],
            }),
          }}
        />
        <SmoothScroll>
          <ParticleNetwork />
          <CustomCursor />
          <ScrollProgress />
          <GrainOverlay />
          {children}
          <FinnorAIConcierge />
        </SmoothScroll>
      </body>
    </html>
  )
}
