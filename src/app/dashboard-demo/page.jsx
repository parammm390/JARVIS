import PersonalizedDashboardPage from "@/app/demo/[slug]/page"

export const metadata = {
  title: "Build Your FINNOR Operations Dashboard Demo",
  description:
    "Create a company-specific FINNOR operations dashboard with live call controls, missed-call recovery, speed-to-lead tools, transcripts, handoffs, and service workflow data.",
  alternates: {
    canonical: "https://finnorai.com/dashboard-demo",
  },
  openGraph: {
    title: "Build Your FINNOR Operations Dashboard Demo",
    description:
      "Configure your company, services, market, team, and lead sources to generate a working FINNOR operations dashboard.",
    url: "https://finnorai.com/dashboard-demo",
    type: "website",
  },
}

export default function DashboardDemoPage() {
  return <PersonalizedDashboardPage />
}
