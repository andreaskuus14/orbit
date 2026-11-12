// Trial (pdfme): render a branded proposal or ARCH report PDF from a JSON data file and a JSON template. Writes a file only; sends nothing.
//   node --experimental-strip-types scripts/pdfme-docs.mjs <proposal|arch-report> data.json out.pdf
// Needs @pdfme/generator, @pdfme/schemas and @pdfme/common (devDependencies; `npm i`). Fonts: tools/pdfme/fonts (Poppins, OFL, Latin + Latin Extended-A, so õäöüšž work).
import { readFileSync, writeFileSync } from "node:fs";
import { generate } from "@pdfme/generator";
import { PDFDocument, rgb } from "@pdfme/pdf-lib";
import * as fontkit from "fontkit";
import { text, table, rectangle, line } from "@pdfme/schemas";
import { DOC_TEMPLATES, archReportInputs, footerText, proposalInputs, tableHeads, templateMismatch } from "../src/lib/pdf-docs-pure.ts";

const root = new URL("../", import.meta.url);
const [doc, dataFile, out] = process.argv.slice(2);
if (!DOC_TEMPLATES[doc] || !dataFile || !out) { console.error("usage: pdfme-docs.mjs <proposal|arch-report> data.json out.pdf"); process.exit(2); }
const data = JSON.parse(readFileSync(dataFile, "utf8"));
const template = JSON.parse(readFileSync(new URL(DOC_TEMPLATES[doc], root), "utf8"));
const inputs = doc === "proposal" ? proposalInputs(data) : archReportInputs(data);
const bad = templateMismatch(template, inputs);
if (bad.length) { console.error(bad.join("\n")); process.exit(1); }
for (const s of template.schemas.flat()) if (s.type === "table" && tableHeads(doc, data.lang)[s.name]) s.head = tableHeads(doc, data.lang)[s.name];
const ttf = (f) => new Uint8Array(readFileSync(new URL(`tools/pdfme/fonts/${f}`, root)));
const font = { Poppins: { data: ttf("Poppins-Regular.subset.ttf"), fallback: true }, PoppinsBold: { data: ttf("Poppins-Bold.subset.ttf") } };
const body = await generate({ template, inputs: [inputs], plugins: { text, table, rectangle, line }, options: { font } });
// pdfme flows every field down with the content, so a footer cannot sit on each page from the template: stamp it (and "n / N") here.
const pdf = await PDFDocument.load(body);
pdf.registerFontkit(fontkit);
const f = await pdf.embedFont(font.Poppins.data, { subset: true }), foot = footerText(doc, data), pages = pdf.getPages();
pages.forEach((pg, i) => {
  const { width } = pg.getSize(), n = `${i + 1} / ${pages.length}`;
  pg.drawLine({ start: { x: 45.4, y: 38 }, end: { x: width - 45.4, y: 38 }, thickness: 0.4, color: rgb(0.81, 0.85, 0.87) });
  pg.drawText(foot, { x: 45.4, y: 26, size: 7.5, font: f, color: rgb(0.48, 0.53, 0.58) });
  pg.drawText(n, { x: width - 45.4 - f.widthOfTextAtSize(n, 7.5), y: 26, size: 7.5, font: f, color: rgb(0.48, 0.53, 0.58) });
});
pdf.setTitle(inputs.title); pdf.setProducer("ORBIT");
const bytes = await pdf.save();
writeFileSync(out, bytes);
console.log(`${out}: ${bytes.length} bytes, ${pages.length} pages`);
