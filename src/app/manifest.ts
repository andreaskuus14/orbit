import type { MetadataRoute } from "next";

// Lets Chrome/Edge treat ORBIT as an installable app with its own window and icon.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "ORBIT",
    short_name: "ORBIT",
    description: "Your mind has a universe.",
    start_url: "/",
    display: "standalone",
    background_color: "#03040d",
    theme_color: "#03040d",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
    ],
  };
}
