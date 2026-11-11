// The art director's pixel pass: downsize each image for the vision model and measure it (contrast, palette spread, where the detail
// sits) in one headless-Chromium page. No network: images go in as data URLs. Used by art-director.ts; tested in art-director.test.ts.
import { sniff, MAX_IMAGE_BYTES } from "./attach-pure.ts";
import { launch } from "./workspace-check.ts";
import type { Measure } from "./art-director-pure.ts";

export type PreparedImage = { type: string; data: Uint8Array };
/** Downsize + measure in the page. Pure pixel math, no network: the image is handed in as a data URL. */
export async function prepare(files: Uint8Array[]): Promise<{ images: PreparedImage[]; measures: Measure[] } | { error: string }> {
  const browser = await launch();
  if (!browser) return { error: "no headless browser for the art review" };
  try {
    const page = await browser.newPage();
    const images: PreparedImage[] = [], measures: Measure[] = [];
    for (const f of files) {
      const t = sniff(f, "img");
      if (t?.kind !== "image") return { error: "not an image (png, jpeg, webp or gif)" };
      const r = await page.evaluate(async ({ src }) => {
        const img = new Image(); img.src = src; await img.decode();
        const k = Math.min(1, 1568 / Math.max(img.width, img.height)), w = Math.round(img.width * k), h = Math.round(img.height * k);
        const c = document.createElement("canvas"); c.width = w; c.height = h;
        const g = c.getContext("2d")!; g.drawImage(img, 0, 0, w, h);
        const d = g.getImageData(0, 0, w, h).data, n = w * h, lum = new Float32Array(n), buckets = new Map<number, number>();
        let sum = 0, clip = 0;
        for (let i = 0; i < n; i++) {
          const R = d[i * 4], G = d[i * 4 + 1], B = d[i * 4 + 2], L = (0.2126 * R + 0.7152 * G + 0.0722 * B) / 255;
          lum[i] = L; sum += L; if (L < 0.02 || L > 0.98) clip++;
          const key = ((R >> 4) << 8) | ((G >> 4) << 4) | (B >> 4); buckets.set(key, (buckets.get(key) ?? 0) + 1);
        }
        const mean = sum / n; let v = 0; for (let i = 0; i < n; i++) v += (lum[i] - mean) ** 2;
        let edges = 0, mid = 0; // horizontal+vertical luminance steps; "mid" = those in the centre third
        for (let y = 1; y < h; y++) for (let x = 1; x < w; x++) {
          const i = y * w + x, e = Math.abs(lum[i] - lum[i - 1]) + Math.abs(lum[i] - lum[i - w]);
          if (e > 0.1) { edges++; if (x > w / 3 && x < (2 * w) / 3 && y > h / 3 && y < (2 * h) / 3) mid++; }
        }
        const colours = [...buckets.values()].filter((c) => c >= n * 0.01).length;
        const jpg = c.toDataURL("image/jpeg", 0.85);
        return { w: img.width, h: img.height, lum: mean, spread: Math.sqrt(v / n), colours, centre: edges ? mid / edges : 0, clipped: clip / n, jpg };
      }, { src: `data:${t.type};base64,${Buffer.from(f).toString("base64")}` });
      const data = new Uint8Array(Buffer.from(r.jpg.split(",")[1], "base64"));
      if (data.length > MAX_IMAGE_BYTES) return { error: "image still too large after downsizing" };
      images.push({ type: "image/jpeg", data });
      measures.push({ w: r.w, h: r.h, lum: r.lum, spread: r.spread, colours: r.colours, centre: r.centre, clipped: r.clipped });
    }
    return { images, measures };
  } finally { await browser.close().catch(() => {}); }
}

