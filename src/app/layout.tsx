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
    default: "Finnor | JARVIS for Water Treatment & Well Pump Companies",
    template: "%s | Finnor AI",
  },
  description:
    "JARVIS turns an instruction into an approved, executed, evidenced action for water treatment and well pump companies: a quote drafted from your price book, held for your yes, executed, and receipted. Live water data, real ranges, and a household memory that runs for years.",
  keywords: [
    "water lead recovery",
    "water appointment booking",
    "water test booking",
    "water treatment lead follow-up",
    "well pump service operations platform",
    "water well service dispatch",
    "no-water emergency route",
    "after-hours well pump dispatch",
    "AI operations console for water dealers",
    "Finnor AI",
    "JARVIS water treatment",
  ],
  authors: [{ name: "Finnor AI", url: "https://finnorai.com" }],
  creator: "Finnor AI",
  publisher: "Finnor AI",
  category: "Business software",
  alternates: {
    canonical: "https://finnorai.com/",
  },
  openGraph: {
    title: "Finnor | JARVIS for Water Treatment & Well Pump Companies",
    description:
      "Give it an instruction. Watch it ask before it acts. JARVIS drafts the quote, the booking, the urgent route, all against your real price book, then waits for your yes.",
    url: "https://finnorai.com/",
    siteName: "Finnor AI",
    images: [
      {
        url: "/og-image.svg",
        width: 1200,
        height: 630,
        alt: "JARVIS, an operations console for water treatment and well pump companies",
      },
    ],
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Finnor | JARVIS for Water Treatment & Well Pump Companies",
    description:
      "Give it an instruction. Watch it ask before it acts. JARVIS drafts the quote, the booking, the urgent route, all against your real price book, then waits for your yes.",
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
                    "FINNOR runs on JARVIS, an operations platform that drafts plans from an instruction, holds them for approval, executes, and files a receipt for water treatment leads, well pump emergencies, web inquiries, and speed-to-lead follow-up.",
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
                  name: "Finnor | JARVIS for Water Treatment & Well Pump Companies",
                  description:
                    "JARVIS turns missed calls, after-hours inquiries, overflow calls, and slow web leads into drafted water tests, service appointments, or urgent routes, held for your approval before anything executes.",
                  isPartOf: { "@id": "https://finnorai.com/#website" },
                  about: { "@id": "https://finnorai.com/#organization" },
                  inLanguage: "en-US",
                },
                {
                  "@type": "SoftwareApplication",
                  name: "JARVIS",
                  applicationCategory: "BusinessApplication",
                  operatingSystem: "Cloud",
                  url: "https://finnorai.com",
                  description:
                    "An operations platform for water treatment and well pump companies: instruction, drafted plan, human approval, execution, receipt. No public pricing is listed. Pricing is scoped per pilot; see /pricing on the site for tier structure.",
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
