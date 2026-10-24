import type { NextConfig } from "next";
import { PHASE_DEVELOPMENT_SERVER } from "next/constants";

const nextConfig: NextConfig = {
  // Another package-lock.json in the home folder confuses Next; pin the project root.
  outputFileTracingRoot: __dirname,
  devIndicators: false, // the dev "N" badge covered the System panel
  // Document parsers, ffmpeg binary and Whisper (native onnxruntime) run server-side only; keep them out of the bundler.
  serverExternalPackages: ["unpdf", "mammoth", "playwright-core", "ffmpeg-static", "@huggingface/transformers", "kokoro-js"], // kokoro-js: AI Story narration on the server
  // The middleware buffers request bodies (10 MB by default); CORE attachments are up to 3 files as base64 JSON (~40 MB).
  experimental: { middlewareClientMaxBodySize: "45mb" },
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), geolocation=()" },
        ],
      },
    ];
  },
};

// scripts/launch.ps1 builds into .next-build (ORBIT_DIST_DIR) and swaps it into .next only when the build succeeds.
// The dev server gets its own folder so "npm run dev" never overwrites the production release.
export default function config(phase: string): NextConfig {
  return { ...nextConfig, distDir: process.env.ORBIT_DIST_DIR || (phase === PHASE_DEVELOPMENT_SERVER ? ".next-dev" : ".next") };
}
