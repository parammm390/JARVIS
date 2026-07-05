import type { Metadata } from "next"
import { Footer } from "@/components/sections/Footer"

export const metadata: Metadata = {
  title: "Terms",
  description: "Terms overview for FINNOR website, demo previews, and consultation requests.",
  alternates: { canonical: "https://finnorai.com/terms" },
  openGraph: {
    title: "Terms | Finnor AI",
    description: "Terms of use for the Finnor AI website, demo builder, and consultation requests.",
    url: "https://finnorai.com/terms",
    images: [
      {
        url: "https://finnorai.com/og-image.svg",
        width: 1200,
        height: 630,
        alt: "Finnor AI terms of use",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "Terms | Finnor AI",
    description: "Terms of use for the Finnor AI website, demo builder, and consultation requests.",
    images: ["https://finnorai.com/og-image.svg"],
  },
}

export default function TermsPage() {
  return (
    <>
      <main className="min-h-screen bg-black px-4 py-24 text-white md:px-6">
        <section className="container max-w-4xl">
          <p className="mb-5 text-[10px] font-black uppercase tracking-[0.24em] text-cyan-100/65">
            FINNOR
          </p>
          <h1 className="text-4xl font-black tracking-tight md:text-6xl">Terms</h1>
          <div className="mt-10 space-y-6 text-base font-medium leading-relaxed text-white/58">
            <p>
              FINNOR website content and demo previews are provided for evaluation and discussion.
              Demo artifacts are illustrative and should not be treated as repair, legal,
              emergency, or operational advice.
            </p>
            <p>
              Production use requires a separately agreed scope covering phone routing,
              integrations, data handling, escalation procedures, vendor responsibilities, and any
              operating boundaries.
            </p>
            <p>
              To discuss deployment terms, contact{" "}
              <a className="text-white underline underline-offset-4" href="mailto:param@finnorai.com">
                param@finnorai.com
              </a>
              .
            </p>
          </div>
        </section>
      </main>
      <Footer />
    </>
  )
}
