import type { Metadata } from "next";
import { IBM_Plex_Mono, Manrope, Outfit } from "next/font/google";
import localFont from "next/font/local";
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";
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

const satoshi = localFont({
  src: [
    { path: "../../public/fonts/Satoshi-Regular.woff2", weight: "400", style: "normal" },
    { path: "../../public/fonts/Satoshi-Medium.woff2", weight: "500", style: "normal" },
    { path: "../../public/fonts/Satoshi-Bold.woff2", weight: "700", style: "normal" },
  ],
  variable: "--font-satoshi",
  display: "swap",
  fallback: ["Arial", "sans-serif"],
});

export const metadata: Metadata = {
  metadataBase: new URL("https://finnorai.com"),
  applicationName: "FINNOR",
  title: {
    default: "FINNOR | AI Operating & Execution System for Water Treatment",
    template: "%s | FINNOR",
  },
  description:
    "FINNOR is a customized AI operating and execution system for water treatment companies. JARVIS is the command surface for coordinated work, approvals, recovery and evidence.",
  keywords: [
    "water treatment operating system",
    "AI execution system",
    "custom water treatment operations system",
    "water treatment company operations",
    "governed AI operations",
    "JARVIS command surface",
    "FINNOR",
  ],
  authors: [{ name: "FINNOR", url: "https://finnorai.com" }],
  creator: "FINNOR",
  publisher: "FINNOR",
  category: "Business software",
  alternates: {
    canonical: "https://finnorai.com/",
  },
  openGraph: {
    title: "FINNOR | Built Around How Your Company Operates",
    description:
      "A customized AI operating and execution system for water treatment companies. Production deployments start around $30,000.",
    url: "https://finnorai.com/",
    siteName: "FINNOR",
    images: [
      {
        url: "/og-image.svg",
        width: 1200,
        height: 630,
        alt: "FINNOR customized AI operating and execution system for water treatment companies",
      },
    ],
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "FINNOR | Built Around How Your Company Operates",
    description:
      "Customized AI operating and execution systems for water treatment companies. Deployments start around $30,000.",
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
      <body className={`${manrope.variable} ${outfit.variable} ${satoshi.variable} ${plexMono.variable} ${GeistSans.variable} ${GeistMono.variable} ${manrope.className} antialiased`}>
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
                    "FINNOR configures and deploys customized AI operating and execution systems for water treatment companies.",
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
                  name: "FINNOR | AI Operating & Execution System for Water Treatment",
                  description:
                    "FINNOR is configured around a water treatment company's workflows, systems, locations, roles, authority policies, channels and operating surfaces.",
                  isPartOf: { "@id": "https://finnorai.com/#website" },
                  about: { "@id": "https://finnorai.com/#organization" },
                  inLanguage: "en-US",
                },
                {
                  "@type": "Product",
                  "@id": "https://finnorai.com/#product",
                  name: "FINNOR",
                  category: "Customized AI operating and execution system for water treatment companies",
                  description:
                    "A company-specific operating and execution layer coordinating customers, work, schedule, inventory, quotes, communication, money, research, agents, approvals, recovery and evidence where configured.",
                  brand: { "@id": "https://finnorai.com/#organization" },
                  audience: {
                    "@type": "BusinessAudience",
                    audienceType: "Water treatment company owners and operators",
                  },
                  offers: {
                    "@type": "Offer",
                    priceCurrency: "USD",
                    price: "30000",
                    description: "Production deployments start around $30,000; final pricing depends on implementation scope and ongoing operating and support requirements.",
                    url: "https://finnorai.com/pricing",
                    availability: "https://schema.org/InStock",
                  },
                },
                {
                  "@type": "SoftwareApplication",
                  "@id": "https://finnorai.com/#jarvis",
                  name: "JARVIS",
                  applicationCategory: "BusinessApplication",
                  operatingSystem: "Cloud",
                  url: "https://finnorai.com",
                  description:
                    "The command and work surface for FINNOR deployments, used to understand, direct, approve and inspect operational work.",
                  isPartOf: { "@id": "https://finnorai.com/#product" },
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
