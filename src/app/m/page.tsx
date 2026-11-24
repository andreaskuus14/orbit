import type { Metadata, Viewport } from "next";
import { PhoneHome } from "@/components/PhoneHome";

// ORBIT's phone home: installable (its own manifest + service worker, scope /m). Same sign-in and same Tailscale Serve address as
// the rest of ORBIT (docs/PHONE.md); nothing new is public. The laptop runs everything; the phone is a screen for it.
export const metadata: Metadata = {
  title: "ORBIT",
  manifest: "/m/manifest.webmanifest",
  appleWebApp: { capable: true, title: "ORBIT", statusBarStyle: "black-translucent" },
};
export const viewport: Viewport = { themeColor: "#05070c", width: "device-width", initialScale: 1, viewportFit: "cover", interactiveWidget: "resizes-content" };

export default function PhonePage() {
  return <PhoneHome />;
}
