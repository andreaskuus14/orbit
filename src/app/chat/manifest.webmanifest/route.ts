// The phone chat's install manifest: opens straight on /chat, full-screen. Public (middleware PUBLIC_PATHS) because browsers fetch
// manifests without cookies; it holds no data.
export const dynamic = "force-static";

export function GET() {
  return Response.json({
    id: "/chat", name: "ORBIT chat", short_name: "ORBIT", description: "Talk to CORE from your phone.",
    start_url: "/chat", scope: "/chat", display: "standalone", background_color: "#02040b", theme_color: "#02040b",
    icons: [{ src: "/icon-192.png", sizes: "192x192", type: "image/png" }, { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" }],
  }, { headers: { "Content-Type": "application/manifest+json" } });
}
