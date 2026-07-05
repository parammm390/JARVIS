import type { Metadata } from "next"
import { Footer } from "@/components/sections/Footer"

export const metadata: Metadata = {
  title: "Privacy",
  description: "Privacy overview for FINNOR AI voice dispatch demo and website inquiries.",
  alternates: { canonical: "https://finnorai.com/privacy" },
  openGraph: {
    title: "Privacy | Finnor AI",
    description:
      "Privacy policy for Finnor AI: what information we collect, how it is used, and how to contact us.",
    url: "https://finnorai.com/privacy",
    images: [
      {
        url: "https://finnorai.com/og-image.svg",
        width: 1200,
        height: 630,
        alt: "Finnor AI privacy policy",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "Privacy | Finnor AI",
    description: "Privacy policy for Finnor AI.",
    images: ["https://finnorai.com/og-image.svg"],
  },
}

export default function PrivacyPage() {
  return (
    <>
      <main className="min-h-screen bg-black px-4 py-24 text-white md:px-6">
        <section className="container max-w-4xl">
          <p className="mb-5 text-[10px] font-black uppercase tracking-[0.24em] text-cyan-100/65">
            FINNOR
          </p>
          <h1 className="text-4xl font-black tracking-tight md:text-6xl">Privacy</h1>
          <div className="mt-10 space-y-6 text-base font-medium leading-relaxed text-white/58">
            <p>
              FINNOR collects basic website inquiry information such as name, work email, company,
              phone number, demo company name, website URL, and generated demo metadata when you use
              the site or demo builder.
            </p>
            <p>
              Demo generation uses public website information supplied by the user. The demo flow is
              designed not to store sensitive customer repair data in v1. Live production
              deployments require a separately scoped implementation, vendor review, routing
              rules, data handling terms, and agreement structure.
            </p>
            <p>
              Contact FINNOR at{" "}
              <a className="text-white underline underline-offset-4" href="mailto:param@finnorai.com">
                param@finnorai.com
              </a>{" "}
              for privacy questions or data requests.
            </p>
          </div>
        </section>
      </main>
      <Footer />
    </>
  )
}
