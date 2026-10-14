// Saves the Higgsfield-generated planet textures into public/textures so ORBIT doesn't depend on the CDN link.
import { mkdir, writeFile } from "node:fs/promises";

const CDN = "https://d8j0ntlcm91z4.cloudfront.net/user_3K4zaF8Ip5JyEmwNLHr5iAw89pD/hf_20261014_";
const FILES = {
  sun: "132007_89489601-ef9a-4a64-9a5e-3955d8016cc1",
  earth: "132007_5069b2ba-e1d5-4358-847b-eadc908f6cdb",
  mars: "132007_10628adb-15c9-4186-bd1a-99febee610bc",
  jupiter: "132007_4da0094a-caa6-4cea-8462-fade03c8a9b4",
  saturn: "132007_8f5fc6c9-1651-462d-a321-0b8d85dd539e",
  violet: "132037_343842e2-f778-4495-8159-41fc45fe3bf3",
  teal: "132036_10c1157e-cf14-4c33-90cd-d9a7c9b08993",
  ice: "132100_675fcf9c-0c65-463e-b812-60469ef6e392",
  neptune: "132100_aa064c0f-5651-4b4d-bc6a-651939d7f66a",
};

await mkdir("public/textures", { recursive: true });
let failed = 0;
for (const [name, id] of Object.entries(FILES)) {
  try {
    const res = await fetch(`${CDN}${id}.png`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.subarray(1, 4).toString() !== "PNG") throw new Error("not a PNG");
    await writeFile(`public/textures/${name}.png`, buf);
    console.log(`saved ${name}.png (${(buf.length / 1e6).toFixed(1)} MB)`);
  } catch (e) {
    failed++;
    console.error(`failed ${name}: ${e.message}`);
  }
}

// Brand: the ORBIT emblem (Higgsfield Z Image), cropped to the mark and resized for every icon slot.
try {
  const { default: sharp } = await import("sharp"); // ships with Next.js
  const res = await fetch(`${CDN}220607_96189f58-67c6-40bb-a667-7f323ab3d5c9.png`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const mark = sharp(Buffer.from(await res.arrayBuffer())).extract({ left: 420, top: 330, width: 1140, height: 1140 });
  const png = (size) => mark.clone().resize(size, size).png().toBuffer();
  await mkdir("public/brand", { recursive: true });
  await writeFile("public/brand/orbit-mark.png", await png(512));
  await writeFile("public/icon-512.png", await png(512));
  await writeFile("public/icon-192.png", await png(192));
  await writeFile("src/app/icon.png", await png(256));
  await writeFile("src/app/apple-icon.png", await png(180));
  // Windows shortcut icon: an .ico holding PNG images (supported since Vista).
  const sizes = [256, 48, 32, 16], imgs = await Promise.all(sizes.map(png));
  const head = Buffer.alloc(6 + 16 * sizes.length);
  head.writeUInt16LE(1, 2); head.writeUInt16LE(sizes.length, 4);
  let offset = head.length;
  sizes.forEach((s, i) => {
    const e = 6 + 16 * i;
    head[e] = s >= 256 ? 0 : s; head[e + 1] = s >= 256 ? 0 : s;
    head.writeUInt16LE(1, e + 4); head.writeUInt16LE(32, e + 6);
    head.writeUInt32LE(imgs[i].length, e + 8); head.writeUInt32LE(offset, e + 12);
    offset += imgs[i].length;
  });
  await writeFile("public/orbit.ico", Buffer.concat([head, ...imgs]));
  console.log("saved ORBIT logo + app icons");
} catch (e) {
  failed++;
  console.error(`failed logo: ${e.message}`);
}
process.exit(failed ? 1 : 0);
