import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Vig",
    short_name: "Vig",
    description: "History-backed vFootball selections. Personal tool, 18+.",
    start_url: "/",
    display: "standalone",
    background_color: "#0c2a20",
    theme_color: "#133629",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
      { src: "/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
