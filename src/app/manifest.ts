import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "FINNOR — Governed Execution for Water Treatment",
    short_name: "Finnor AI",
    description:
      "A governed execution system that turns one instruction into coordinated, approved, and evidenced operational change.",
    start_url: "/",
    display: "standalone",
    background_color: "#f8faf9",
    theme_color: "#f3f0e8",
    icons: [
      {
        src: "/icon.svg",
        sizes: "any",
        type: "image/svg+xml",
      },
    ],
  };
}
