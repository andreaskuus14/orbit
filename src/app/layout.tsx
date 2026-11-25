import type { Metadata, Viewport } from "next";
import { Inter, JetBrains_Mono, Rajdhani, Source_Serif_4 } from "next/font/google";
import "./globals.css";
import "./observatory.css";
import "./motion.css";
import { cookies, headers } from "next/headers";
import { motionOn } from "@/lib/ui-motion-pure";
import { LANG_KEY, parseLang } from "@/lib/i18n-core-pure";
import { LangBoot } from "@/components/i18n-boot";

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

// Devices that chose a language before the cookie existed have it only in localStorage: copy it into the cookie and
// reload before anything paints, so even that one load never shows the wrong language. Runs once per device.
const LANG_SYNC = `try{var l=localStorage.getItem("${LANG_KEY}");if((l==="et"||l==="en")&&document.documentElement.lang!==l&&document.cookie.indexOf("${LANG_KEY}=")<0&&!sessionStorage.getItem("orbit.langSync")){sessionStorage.setItem("orbit.langSync","1");document.cookie="${LANG_KEY}="+l+"; Path=/; Max-Age=31536000; SameSite=Lax";location.reload()}}catch(e){}`;

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const lang = parseLang((await cookies()).get(LANG_KEY)?.value);
  const nonce = /'nonce-([^']+)'/.exec((await headers()).get("content-security-policy") ?? "")?.[1];
  return (
    <html lang={lang} className={`${inter.variable} ${rajdhani.variable} ${jetbrains.variable} ${serif.variable}`} data-motion={motionOn(process.env.ORBIT_UI_MOTION) ? "on" : "off"}>
      <head><script nonce={nonce} dangerouslySetInnerHTML={{ __html: LANG_SYNC }} /></head>
      <body><LangBoot lang={lang}>{children}</LangBoot></body>
    </html>
  );
}
