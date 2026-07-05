import type { MetadataRoute } from "next"

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Finnor Booking and Lead Recovery",
    short_name: "Finnor AI",
    description:
      "AI booking and lead recovery for water treatment leads, well pump emergencies, web inquiries, and speed-to-lead follow-up.",
    start_url: "/",
    display: "standalone",
    background_color: "#f8faf9",
    theme_color: "#0f172a",
    icons: [
      {
        src: "/icon.svg",
        sizes: "any",
        type: "image/svg+xml",
      },
    ],
  }
}
