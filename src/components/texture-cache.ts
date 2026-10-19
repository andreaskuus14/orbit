"use client";
import { textureUrls } from "@/lib/texture-pure";

// One decoded image per texture for the whole page: every world (and a remounted galaxy) reuses it instead of
// downloading and decoding the file again. decode() runs off the main thread, so creating the texture later is cheap.
const images = new Map<string, Promise<HTMLImageElement>>();

function load(src: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => img.decode().catch(() => {}).then(() => resolve(img)); // decode failing still leaves a usable image
    img.onerror = () => reject(new Error(src));
    img.src = src;
  });
}

/** The first of textureUrls(local, cdn) that loads; rejects (and forgets, so a later call retries) when none does. */
export function loadImage(local: string, cdn?: string): Promise<HTMLImageElement> {
  const hit = images.get(local);
  if (hit) return hit;
  const p = textureUrls(local, cdn).reduce<Promise<HTMLImageElement>>((prev, url) => prev.catch(() => load(url)), Promise.reject(new Error("start")));
  p.catch(() => images.delete(local));
  images.set(local, p);
  return p;
}
