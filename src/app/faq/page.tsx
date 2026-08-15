import type { Metadata } from "next";

import FinnorMarketingPage from "@/components/marketing/FinnorMarketingPage";
import { faqItems } from "@/content/commercial-truth";

export const metadata: Metadata = {
  title: "FAQ",
  description:
    "Direct answers about FINNOR, JARVIS, company-specific configuration, intelligence policies, text and voice scope, deployment work and pricing from $30,000.",
  alternates: { canonical: "https://finnorai.com/faq" },
  openGraph: {
    title: "FAQ | FINNOR",
    description: "The product, configuration, authority, deployment and pricing answers behind FINNOR.",
    url: "https://finnorai.com/faq",
    images: [{ url: "https://finnorai.com/og-image.svg", width: 1200, height: 630, alt: "FINNOR FAQ" }],
  },
};

export default function FaqRoute() {
  return (
    <>
      <script
        id="finnor-faq-structured-data"
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify({
            "@context": "https://schema.org",
            "@type": "FAQPage",
            mainEntity: faqItems.map((item) => ({
              "@type": "Question",
              name: item.question,
              acceptedAnswer: { "@type": "Answer", text: item.answer },
            })),
          }),
        }}
      />
      <FinnorMarketingPage route="faq" />
    </>
  );
}
