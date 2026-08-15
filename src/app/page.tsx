import type { Metadata } from "next";

import FinnorHome from "@/components/rebuild/FinnorHome";

export const metadata: Metadata = {
  title: {
    absolute: "FINNOR | Built Around How Your Company Operates",
  },
  description:
    "FINNOR is a customized AI operating and execution system for water treatment companies. Production deployments start around $30,000; JARVIS is the command surface.",
  alternates: {
    canonical: "https://finnorai.com/",
  },
  openGraph: {
    title: "Built Around How Your Company Operates | FINNOR",
    description:
      "FINNOR coordinates customers, work, schedule, inventory, quotes, communication, money, research and agents where configured.",
    url: "https://finnorai.com/",
    images: [
      {
        url: "https://finnorai.com/og-image.svg",
        width: 1200,
        height: 630,
        alt: "FINNOR customized AI operating and execution system",
      },
    ],
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Built Around How Your Company Operates | FINNOR",
    description:
      "Customized AI operating and execution systems for water treatment companies. Deployments start around $30,000.",
    images: ["https://finnorai.com/og-image.svg"],
  },
};

export default function Home() {
  return <FinnorHome />;
}
