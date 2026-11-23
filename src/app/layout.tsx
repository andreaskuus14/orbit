import type { Metadata, Viewport } from "next";
import { Inter, JetBrains_Mono, Rajdhani, Source_Serif_4 } from "next/font/google";
import "./globals.css";
import "./observatory.css";
import "./motion.css";
import { motionOn } from "@/lib/ui-motion-pure";

// Self-hosted at build time by Next.js: no request to Google from the browser.
const inter = Inter({ subsets: ["latin"], variable: "--font-inter", display: "swap" });
const rajdhani = Rajdhani({ subsets: ["latin"], weight: ["500", "600", "700"], variable: "--font-rajdhani", display: "swap" });
const jetbrains = JetBrains_Mono({ subsets: ["latin"], variable: "--font-jetbrains", display: "swap" });
// News weather headlines (OFL 1.1). latin-ext for Estonian š/ž.
const serif = Source_Serif_4({ subsets: ["latin", "latin-ext"], weight: ["400", "600", "700"], variable: "--font-serif", display: "swap" });

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
    <html lang="en" className={`${inter.variable} ${rajdhani.variable} ${jetbrains.variable} ${serif.variable}`} data-motion={motionOn(process.env.ORBIT_UI_MOTION) ? "on" : "off"}>
      <body>{children}</body>
    </html>
  );
}
