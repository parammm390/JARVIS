import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";

import GlobalChrome from "@/components/layout/GlobalChrome";

const inter = Inter({ subsets: ["latin"] });

export const metadata: Metadata = {
  metadataBase: new URL("https://finnorai.com"),
  applicationName: "FINNOR",
  title: {
    default:
      "FINNOR JARVIS | Voice-Native AI Operations for Water Treatment Companies",
    template: "%s | FINNOR",
  },
  description:
    "Run calls, CRM, scheduling, proposals, invoices, inventory, technicians and campaigns by talking to JARVIS, the voice-native AI operations platform for water-treatment companies.",
  keywords: [
    "water-treatment operations",
    "voice-native operations",
    "customer operations",
    "workflow automation",
    "water-treatment operations operations platform",
    "connected field operations",
    "field-service workflow",
    "inbound operations",
    "voice-native AI operations platform",
    "FINNOR",
    "JARVIS water treatment",
  ],
  authors: [{ name: "FINNOR", url: "https://finnorai.com" }],
  creator: "FINNOR",
  publisher: "FINNOR",
  category: "Business software",
  alternates: {
    canonical: "https://finnorai.com/",
  },
  openGraph: {
    title:
      "FINNOR JARVIS | Voice-Native AI Operations for Water Treatment Companies",
    description:
      "Run calls, CRM, scheduling, proposals, invoices, inventory, technicians and campaigns by talking to JARVIS—the voice-native AI operations platform for water-treatment companies.",
    url: "https://finnorai.com/",
    siteName: "FINNOR",
    images: [
      {
        url: "/og-image.svg",
        width: 1200,
        height: 630,
        alt: "JARVIS, the voice-native AI operations platform for water-treatment companies",
      },
    ],
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title:
      "FINNOR JARVIS | Voice-Native AI Operations for Water Treatment Companies",
    description:
      "Run calls, CRM, scheduling, proposals, invoices, inventory, technicians and campaigns by talking to JARVIS.",
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
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
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
                  name: "FINNOR",
                  alternateName: ["FINNOR", "Finnor"],
                  url: "https://finnorai.com",
                  email: "param@finnorai.com",
                  description:
                    "FINNOR runs on JARVIS, an operations platform that drafts plans from an instruction, holds them for approval, executes, and files a receipt for water treatment leads, water-treatment emergencies, web inquiries, and speed-to-lead follow-up.",
                  sameAs: ["https://www.linkedin.com/in/param-dave16"],
                },
                {
                  "@type": "WebSite",
                  "@id": "https://finnorai.com/#website",
                  url: "https://finnorai.com",
                  name: "FINNOR",
                  alternateName: "FINNOR",
                  publisher: { "@id": "https://finnorai.com/#organization" },
                  inLanguage: "en-US",
                },
                {
                  "@type": "WebPage",
                  "@id": "https://finnorai.com/#webpage",
                  url: "https://finnorai.com",
                  name: "FINNOR JARVIS | Voice-Native AI Operations for Water Treatment Companies",
                  description:
                    "JARVIS plans and executes work across connected business systems, with approval boundaries defined by your operation.",
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
                    "A voice-native AI operations platform for water-treatment companies. Pricing depends on locations, usage, integrations and workflow complexity.",
                },
              ],
            }),
          }}
        />
        <GlobalChrome>{children}</GlobalChrome>
      </body>
    </html>
  );
}
