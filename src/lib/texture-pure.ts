// Which files to try for a texture, best first. scripts/fetch-textures.mjs writes a small WebP next to each saved PNG
// (the PNG stays as fallback); the CDN copy is the last resort when nothing was saved locally.
export function textureUrls(local: string, cdn?: string): string[] {
  const urls = local.endsWith(".png") ? [local.slice(0, -4) + ".webp", local] : [local];
  return cdn ? [...urls, cdn] : urls;
}
