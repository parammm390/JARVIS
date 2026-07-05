import type { MetadataRoute } from "next"

export default function sitemap(): MetadataRoute.Sitemap {
  const routes = [
    "",
    "/demo",
    "/demo/lifecycle",
    "/dashboard-demo",
    "/resources",
    "/resources/missed-call-cost-calculator",
    "/resources/pilot-setup-checklist",
    "/resources/dispatch-ai-glossary",
    "/trust-safety",
    "/privacy",
    "/terms",
  ]

  return routes.map((route, index) => ({
    url: `https://finnorai.com${route}`,
    lastModified: new Date(),
    changeFrequency: index < 2 ? "weekly" : "monthly",
    priority: index === 0 ? 1 : index === 1 ? 0.9 : 0.7,
  }))
}
