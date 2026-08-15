import type { MetadataRoute } from "next"

export default function sitemap(): MetadataRoute.Sitemap {
  const routes = [
    "",
    "/product",
    "/capabilities",
    "/how-it-works",
    "/pricing",
    "/faq",
    "/resources",
    "/resources/operational-drag-estimator",
    "/resources/deployment-readiness-checklist",
    "/resources/operating-glossary",
    "/trust-safety",
    "/privacy",
    "/terms",
  ]

  const lastModified = new Date("2026-08-15T00:00:00.000Z")

  return routes.map((route, index) => ({
    url: `https://finnorai.com${route}`,
    lastModified,
    changeFrequency: index < 2 ? "weekly" : "monthly",
    priority: index === 0 ? 1 : index === 1 ? 0.9 : 0.7,
  }))
}
