import type { Metadata } from "next";

import FinnorHome from "@/components/rebuild/FinnorHome";

export const metadata: Metadata = {
  title: {
    absolute: "FINNOR | Governed Execution for Water Treatment Companies",
  },
  description:
    "FINNOR turns an instruction into grounded context, an executable plan, governed action and permanent evidence for water treatment companies. JARVIS is the command surface.",
  alternates: {
    canonical: "https://finnorai.com/",
  },
  openGraph: {
    title: "One instruction. The whole operation moves. | FINNOR",
    description:
      "See how FINNOR moves Customers, Work, Schedule and Money from one governed instruction—and proves what happened.",
    url: "https://finnorai.com/",
    images: [
      {
        url: "https://finnorai.com/og-image.svg",
        width: 1200,
        height: 630,
        alt: "FINNOR governed execution system for water treatment companies",
      },
    ],
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "One instruction. The whole operation moves. | FINNOR",
    description:
      "Grounded context, executable plans, governed action and permanent evidence for water treatment companies.",
    images: ["https://finnorai.com/og-image.svg"],
  },
};

export default function Home() {
  return <FinnorHome />;
}
