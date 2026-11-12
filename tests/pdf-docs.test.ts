import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DOC_TEMPLATES, archReportInputs, footerText, money, proposalInputs, tableHeads, templateMismatch, type ArchReportData, type ProposalData } from "../src/lib/pdf-docs-pure.ts";

const tpl = (d: keyof typeof DOC_TEMPLATES) => JSON.parse(readFileSync(new URL(`../${DOC_TEMPLATES[d]}`, import.meta.url), "utf8"));
const p: ProposalData = { lang: "et", brand: { name: "Kuus Studio", tagline: "x", regCode: "123", email: "a@b.ee", phone: "+372 5", address: "T" }, number: "P-1", date: "12.11.2026", validUntil: "26.11.2026",
  client: { name: "Rullimeister OÜ" }, intro: "Täname!", items: [{ text: "Disain", qty: 1, cents: 45000 }, { text: "Arendus", qty: 24, cents: 4500 }], vat: { on: true, rate: 24 }, start: "1.12", end: "31.1", terms: "14 päeva" };
const r: ArchReportData = { lang: "et", author: "Andreas", title: "Õueala maja", site: "Nõmme", version: "v3", at: "12.11.2026", brief: "b", numbers: [["Krunt", "720 m²"]], rooms: [{ name: "Köök", area: 13.1, glazing: 1.2 }], crits: ["a", "b"], notes: "n" };

test("money: Estonian and English grouping, always 2 decimals", () => {
  assert.equal(money(108000, "et"), "1 080,00");
  assert.equal(money(1518600, "en"), "15,186.00");
  assert.equal(money(5, "en"), "0.05");
});

test("proposal inputs: line totals, VAT and the grand total come from the invoice maths", () => {
  const i = proposalInputs(p);
  assert.deepEqual(JSON.parse(i.items), [["Disain", "1", "450,00", "450,00"], ["Arendus", "24", "45,00", "1 080,00"]]);
  assert.match(i.totals, /Summa km-ta: 1 530,00 €\nKäibemaks 24%: 367,20 €\nKokku: 1 897,20 €/);
  assert.match(proposalInputs({ ...p, vat: { on: false, rate: 24 } }).totals, /Käibemaksu ei lisandu/);
  assert.match(proposalInputs({ ...p, lang: "en" }).totals, /Subtotal: 1,530\.00 €/);
});

test("arch report inputs: rooms table uses decimal comma in et, crits are bulleted", () => {
  const i = archReportInputs(r);
  assert.deepEqual(JSON.parse(i.rooms), [["Köök", "13,1", "1,2"]]);
  assert.equal(i.crits, "• a\n• b");
  assert.equal(archReportInputs({ ...r, crits: [] }).crits, "—");
});

test("the JSON templates and the inputs agree field for field (a template edit that drops or renames one fails here)", () => {
  assert.deepEqual(templateMismatch(tpl("proposal"), proposalInputs(p)), []);
  assert.deepEqual(templateMismatch(tpl("arch-report"), archReportInputs(r)), []);
  assert.equal(templateMismatch(tpl("proposal"), { ...proposalInputs(p), extra: "x" })[0], 'input "extra" has no template field');
});

test("templates only use what the generator registers: text/table/rectangle, the two embedded fonts, long text expands, tables repeat their head", () => {
  for (const d of ["proposal", "arch-report"] as const) {
    const t = tpl(d);
    assert.equal(t.basePdf.width, 210); assert.equal(t.basePdf.height, 297);
    for (const s of t.schemas.flat()) {
      assert.ok(["text", "table", "rectangle"].includes(s.type), `${d}.${s.name}: ${s.type}`);
      if (s.type === "text") { assert.ok(["Poppins", "PoppinsBold"].includes(s.fontName), s.name); assert.equal(s.overflow, "expand", s.name); }
      if (s.type === "table") { assert.equal(s.repeatHead, true, s.name); assert.equal(s.headWidthPercentages.length, tableHeads(d, "et")[s.name].length); }
      assert.ok(s.position.y >= t.basePdf.padding[0] || s.type === "rectangle", `${d}.${s.name} sits inside the top padding, where pdfme would move it`);
    }
  }
});

test("footer line", () => {
  assert.equal(footerText("proposal", p), "Kuus Studio · reg. 123 · a@b.ee · +372 5");
  assert.equal(footerText("arch-report", r), "Andreas · Õueala maja");
});
