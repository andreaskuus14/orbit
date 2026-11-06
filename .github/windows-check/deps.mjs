// Windows install check: each native dependency is actually used, not just required. Exit 1 if any fails.
import { createRequire } from "node:module"; import { execFileSync } from "node:child_process"; import { existsSync } from "node:fs";
const require = createRequire(import.meta.url + "/../../../"); const out = {}; let bad = 0;
const t = async (k, f) => { try { out[k] = await f(); } catch (e) { bad++; out[k] = "FAIL " + String(e?.message ?? e).split("\n")[0].slice(0, 160); } };
await t("sharp", async () => { const sharp = require("sharp"); const png = await sharp({ create: { width: 64, height: 64, channels: 3, background: "#336699" } }).png().toBuffer(); const m = await sharp(png).resize(16).metadata(); return `ok ${m.width}px (libvips ${sharp.versions.vips})`; });
await t("onnxruntime-node", async () => { const ort = require("onnxruntime-node"); const b = ort.listSupportedBackends?.() ?? []; return `ok backends ${JSON.stringify(b.map((x) => x.name ?? x))}`; });
await t("ffmpeg-static", async () => { const p = require("ffmpeg-static"); if (!existsSync(p)) throw new Error(`binary missing at ${p}`); return "ok " + execFileSync(p, ["-version"], { encoding: "utf8" }).split("\n")[0]; });
await t("esbuild", async () => require("esbuild").transformSync("let a: number = 1", { loader: "ts" }).code.trim());
await t("protobufjs", async () => { require("protobufjs"); return "ok"; });
console.log(JSON.stringify(out, null, 1)); process.exit(bad ? 1 : 0);
