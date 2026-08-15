import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "FINNOR — AI Operating & Execution System for Water Treatment",
    short_name: "FINNOR",
    description:
      "A customized operating and execution system configured around how a water treatment company actually runs.",
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
