import type { Metadata } from "next";
import { RemoteApp } from "@/components/RemoteApp";

export const metadata: Metadata = {
  title: "Orbital Remote",
  manifest: "/remote/manifest.webmanifest",
  appleWebApp: { capable: true, title: "Remote", statusBarStyle: "black-translucent" },
};

export default function RemotePage() {
  return <RemoteApp />;
}
