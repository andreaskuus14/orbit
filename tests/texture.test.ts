import { test } from "node:test";
import assert from "node:assert/strict";
import { textureUrls } from "../src/lib/texture-pure.ts";

test("textureUrls tries the WebP variant, then the PNG, then the CDN", () => {
  assert.deepEqual(textureUrls("/textures/ocean.png", "https://cdn/x.png"), ["/textures/ocean.webp", "/textures/ocean.png", "https://cdn/x.png"]);
  assert.deepEqual(textureUrls("/textures/ocean.png"), ["/textures/ocean.webp", "/textures/ocean.png"]);
});

test("textureUrls leaves files that are already WebP alone", () => {
  assert.deepEqual(textureUrls("/textures/studio-sky.webp", "https://cdn/y.png"), ["/textures/studio-sky.webp", "https://cdn/y.png"]);
});
