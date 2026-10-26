// A tiny PDF writer (pure, tested in tests/contracts.test.ts): text in the 14 standard fonts (WinAnsi, so Estonian õäöüšž
// work) and simple vector paths. Enough for ORBIT's signed contracts without a PDF library or a browser.
// shortcut: no font embedding, so Cyrillic and other non-Latin letters print as "?"; embed a TrueType font if contracts need them.

export type PdfPage = { ops: string[] }; // raw content-stream operators
const FONTS = { F1: "Helvetica", F2: "Helvetica-Bold", F3: "Times-Italic" } as const;
export type PdfFont = keyof typeof FONTS;

// WinAnsiEncoding bytes 0x80-0x9F that differ from Latin-1.
const WIN: Record<string, number> = { "€": 0x80, "‚": 0x82, "„": 0x84, "…": 0x85, "‘": 0x91, "’": 0x92, "“": 0x93, "”": 0x94, "•": 0x95, "–": 0x96, "—": 0x97, "™": 0x99, "Š": 0x8a, "š": 0x9a, "Ž": 0x8e, "ž": 0x9e, "Œ": 0x8c, "œ": 0x9c };

/** text → a PDF literal string's bytes (as a latin1 string): WinAnsi, escaped, unknown letters as "?". */
export function pdfString(s: string): string {
  let out = "";
  for (const ch of s.normalize("NFC")) {
    const c = ch.codePointAt(0)!;
    const b = WIN[ch] ?? ((c >= 0x20 && c < 0x7f) || (c >= 0xa0 && c <= 0xff) ? c : c === 0x09 ? 0x20 : 0x3f);
    out += b === 0x28 || b === 0x29 || b === 0x5c ? `\\${String.fromCharCode(b)}` : String.fromCharCode(b);
  }
  return `(${out})`;
}

export const pdfText = (x: number, y: number, font: PdfFont, size: number, s: string) => `BT /${font} ${size} Tf ${x.toFixed(1)} ${y.toFixed(1)} Td ${pdfString(s)} Tj ET`;

/** A baseline JPEG drawn as /Im<i> (DCTDecode: the file's bytes go in as they are). bytes = one char per byte (latin1). */
export type PdfJpeg = { w: number; h: number; bytes: string };
/** Draw image i into the box (x, y = bottom-left, points). */
export const pdfImage = (i: number, x: number, y: number, w: number, h: number) => `q ${w.toFixed(1)} 0 0 ${h.toFixed(1)} ${x.toFixed(1)} ${y.toFixed(1)} cm /Im${i} Do Q`;

/** The whole file. Object 1 catalog, 2 page tree, 3-5 fonts, 6 info, then a page + its content per page, then the images. */
export function pdfDoc(pages: PdfPage[], size: { w: number; h: number }, title = "", images: PdfJpeg[] = []): Uint8Array {
  const objs: string[] = [];
  const kids = pages.map((_, i) => `${7 + 2 * i} 0 R`).join(" ");
  objs.push("<< /Type /Catalog /Pages 2 0 R >>", `<< /Type /Pages /Kids [${kids}] /Count ${pages.length} >>`);
  for (const f of Object.values(FONTS)) objs.push(`<< /Type /Font /Subtype /Type1 /BaseFont /${f} /Encoding /WinAnsiEncoding >>`);
  objs.push(`<< /Title ${pdfString(title)} /Producer (ORBIT) >>`);
  const fonts = Object.keys(FONTS).map((k, i) => `/${k} ${3 + i} 0 R`).join(" ");
  const firstImg = 7 + 2 * pages.length, xobj = images.length ? ` /XObject << ${images.map((_, i) => `/Im${i} ${firstImg + i} 0 R`).join(" ")} >>` : "";
  for (const [i, p] of pages.entries()) {
    const stream = p.ops.join("\n");
    objs.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${size.w} ${size.h}] /Resources << /Font << ${fonts} >>${xobj} >> /Contents ${8 + 2 * i} 0 R >>`,
      `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
  }
  for (const im of images)
    objs.push(`<< /Type /XObject /Subtype /Image /Width ${im.w} /Height ${im.h} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${im.bytes.length} >>\nstream\n${im.bytes}\nendstream`);
  let out = "%PDF-1.4\n%\xe2\xe3\xcf\xd3\n";
  const offsets: number[] = [];
  objs.forEach((o, i) => { offsets.push(out.length); out += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const xref = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("")}`;
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R /Info 6 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Uint8Array.from(out, (ch) => ch.charCodeAt(0) & 0xff); // every char is one byte (pdfString keeps them < 256)
}
