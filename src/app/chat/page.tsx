import type { Metadata, Viewport } from "next";
import { ChatApp } from "@/components/ChatApp";

// The CORE chat on its own: installable on the phone home screen (its own manifest + service worker, scope /chat). Same sign-in and
// same Tailscale Serve address as the rest of ORBIT (docs/PHONE.md); nothing new is exposed. Loads only the chat, not the galaxy.
export const metadata: Metadata = {
  title: "ORBIT chat",
  manifest: "/chat/manifest.webmanifest",
  appleWebApp: { capable: true, title: "ORBIT", statusBarStyle: "black-translucent" },
};
export const viewport: Viewport = { themeColor: "#02040b", width: "device-width", initialScale: 1, viewportFit: "cover", interactiveWidget: "resizes-content" };

export default function ChatPage() {
  return <ChatApp />;
}
