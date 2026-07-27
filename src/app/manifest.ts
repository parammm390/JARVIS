import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Finnor Voice-Native AI Operations",
    short_name: "Finnor AI",
    description:
      "AI voice-native AI operations for water treatment leads, water-treatment emergencies, web inquiries, and speed-to-lead follow-up.",
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
  };
}
