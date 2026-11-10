import type { Metadata, Viewport } from "next";
import { Inter, JetBrains_Mono, Rajdhani } from "next/font/google";
import "./globals.css";
import "./observatory.css";

// Self-hosted at build time by Next.js: no request to Google from the browser.
const inter = Inter({ subsets: ["latin"], variable: "--font-inter", display: "swap" });
const rajdhani = Rajdhani({ subsets: ["latin"], weight: ["500", "600", "700"], variable: "--font-rajdhani", display: "swap" });
const jetbrains = JetBrains_Mono({ subsets: ["latin"], variable: "--font-jetbrains", display: "swap" });

// Every page renders per request so Next can stamp its inline scripts with the CSP nonce from middleware.ts (static pages can't).
export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Orbital", description: "Your mind has a universe." };
export const viewport: Viewport = {
  themeColor: "#02040b",
  colorScheme: "dark",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover", // lets env(safe-area-inset-*) in globals.css report the notch / home bar
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${inter.variable} ${rajdhani.variable} ${jetbrains.variable}`}>
      <body>{children}</body>
    </html>
  );
}
