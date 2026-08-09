import type { Metadata } from "next";
import { IBM_Plex_Mono, Manrope, Outfit } from "next/font/google";
import "./globals.css";

import GlobalChrome from "@/components/layout/GlobalChrome";

const outfit = Outfit({
  subsets: ["latin"],
  variable: "--font-outfit",
  display: "swap",
});

const manrope = Manrope({
  subsets: ["latin"],
  variable: "--font-manrope",
  display: "swap",
});

const plexMono = IBM_Plex_Mono({
  subsets: ["latin"],
  variable: "--font-mono",
  weight: "500",
  display: "swap",
});

export const metadata: Metadata = {
  metadataBase: new URL("https://finnorai.com"),
  applicationName: "FINNOR",
  title: {
    default: "FINNOR | Governed Execution for Water Treatment Companies",
    template: "%s | FINNOR",
  },
  description:
    "FINNOR turns intent into grounded context, an executable plan, governed action and permanent evidence for water treatment companies. JARVIS is the command surface.",
  keywords: [
    "water treatment operations software",
    "governed AI execution",
    "water treatment workflow automation",
    "field service operations",
    "AI command surface",
    "water treatment business software",
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
    title: "FINNOR | Governed Execution for Water Treatment Companies",
    description:
      "One instruction becomes grounded context, an executable plan, governed action and permanent evidence.",
    url: "https://finnorai.com/",
    siteName: "FINNOR",
    images: [
      {
        url: "/og-image.svg",
        width: 1200,
        height: 630,
        alt: "FINNOR governed execution system for water treatment companies",
      },
    ],
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "FINNOR | Governed Execution for Water Treatment Companies",
    description:
      "One instruction becomes grounded context, an executable plan, governed action and permanent evidence.",
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
      <body className={`${manrope.variable} ${outfit.variable} ${plexMono.variable} ${manrope.className} antialiased`}>
        <script
          id="finnor-structured-data"
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
                    "FINNOR is a governed execution system for water treatment companies. It turns an instruction into grounded context, an executable plan, governed action and permanent evidence through JARVIS.",
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
                  name: "FINNOR | Governed Execution for Water Treatment Companies",
                  description:
                    "FINNOR plans and executes work across connected business systems, with authority boundaries defined by each operation.",
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
                    "The JARVIS command surface for FINNOR, a governed execution system for water treatment companies.",
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
