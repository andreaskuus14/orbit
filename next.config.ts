import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Another package-lock.json in the home folder confuses Next; pin the project root.
  outputFileTracingRoot: __dirname,
  devIndicators: false, // the dev "N" badge covered the System panel
  // Document parsers, ffmpeg binary and Whisper (native onnxruntime) run server-side only; keep them out of the bundler.
  serverExternalPackages: ["unpdf", "mammoth", "playwright-core", "ffmpeg-static", "@huggingface/transformers"],
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

export default nextConfig;
