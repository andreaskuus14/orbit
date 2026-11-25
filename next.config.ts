import type { NextConfig } from "next";
import { PHASE_DEVELOPMENT_SERVER } from "next/constants";
import { execSync } from "node:child_process";

// Stamp the commit and build time into the build so the doctor can show what is actually running (no git → "unknown").
const gitHead = (() => { try { return execSync("git rev-parse HEAD", { stdio: ["ignore", "pipe", "ignore"] }).toString().trim(); } catch { return "unknown"; } })();

const nextConfig: NextConfig = {
  // Another package-lock.json in the home folder confuses Next; pin the project root.
  outputFileTracingRoot: __dirname,
  env: { ORBIT_BUILD_COMMIT: gitHead, ORBIT_BUILD_TIME: new Date().toISOString() },
  poweredByHeader: false, // don't advertise the framework (X-Powered-By)
  devIndicators: false, // the dev "N" badge covered the System panel
  // Document parsers, ffmpeg binary and Whisper (native onnxruntime) run server-side only; keep them out of the bundler.
  serverExternalPackages: ["unpdf", "mammoth", "playwright-core", "ffmpeg-static", "@huggingface/transformers", "sherpa-onnx-node", "kokoro-js", "@anthropic-ai/claude-agent-sdk"], // kokoro-js: AI Story narration on the server; the SDK spawns its bundled native CLI
  // The middleware buffers request bodies (10 MB by default); CORE attachments are up to 3 files as base64 JSON (~40 MB).
  experimental: {
    middlewareClientMaxBodySize: "45mb",
    // drei is one big barrel file (~150 re-exports); this makes webpack read only the parts ORBIT imports.
    optimizePackageImports: ["@react-three/drei"],
  },
  // scripts/launch.ps1 sets ORBIT_FAST_PROD_BUILD=1 when pulling CI-verified main commits: no duplicate tsc/eslint, and no
  // file tracing. Tracing (~30 s, a third of a warm build) only writes .nft.json lists for standalone/serverless deploys;
  // `next start` on the laptop never reads them. Excluding everything makes the tracer skip every file.
  ...(process.env.ORBIT_FAST_PROD_BUILD === "1"
    ? { typescript: { ignoreBuildErrors: true }, eslint: { ignoreDuringBuilds: true }, outputFileTracingExcludes: { "*": ["**/*"] } }
    : {}),
  // Browser bundles get lib/i18n-browser.ts instead of lib/i18n-pure.ts: same API, but only the active language's strings
  // ship on first load (the server and node tests keep both). See components/i18n.tsx.
  webpack(config, { isServer, webpack }) {
    if (!isServer) config.plugins.push(new webpack.NormalModuleReplacementPlugin(/(^|\/)i18n-pure(\.ts)?$/, (r: { request: string }) => { r.request = r.request.replace(/i18n-pure(\.ts)?$/, "i18n-browser"); }));
    return config;
  },
  async headers() {
    return [
      {
        // Every page except the shop-in-a-box preview, which the BUSINESS drawer frames itself (its route sends frame-ancestors 'self').
        source: "/:path((?!api/business/shop/).*)",
        headers: [
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), geolocation=()" },
        ],
      },
      { source: "/api/business/shop/:id", headers: [{ key: "X-Frame-Options", value: "SAMEORIGIN" }, { key: "Permissions-Policy", value: "camera=(), geolocation=()" }] },
    ];
  },
};

// scripts/launch.ps1 builds into .next-build (ORBIT_DIST_DIR) and swaps it into .next only when the build succeeds.
// The dev server gets its own folder so "npm run dev" never overwrites the production release.
export default function config(phase: string): NextConfig {
  // npm run demo:build runs this in a staging copy holding only the /demo route (scripts/demo-build.mjs): a static export.
  if (process.env.ORBIT_DEMO_EXPORT === "1") {
    const { headers: _, experimental: __, ...rest } = nextConfig;
    return { ...rest, output: "export", images: { unoptimized: true } };
  }
  return { ...nextConfig, distDir: process.env.ORBIT_DIST_DIR || (phase === PHASE_DEVELOPMENT_SERVER ? ".next-dev" : ".next") };
}
