import type { MetadataRoute } from "next";

// Lets Chrome/Edge treat Orbital as an installable app with its own window and icon.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Orbital",
    short_name: "Orbital",
    description: "Your mind has a universe.",
    start_url: "/",
    display: "standalone",
    background_color: "#02040b", // matches --bg in globals.css
    theme_color: "#02040b",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
