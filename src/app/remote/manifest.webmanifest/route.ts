// The phone remote's own install manifest: opens straight on /remote, full-screen.
export const dynamic = "force-static";

export function GET() {
  return Response.json({
    id: "/remote", name: "ORBIT", short_name: "Remote", description: "Approvals, Stop-all, Studio queue and CORE from your phone.",
    start_url: "/remote", scope: "/remote", display: "standalone", background_color: "#02040b", theme_color: "#02040b",
    icons: [{ src: "/icon-192.png", sizes: "192x192", type: "image/png" }, { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" }],
  }, { headers: { "Content-Type": "application/manifest+json" } });
}
