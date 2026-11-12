// Branded BUSINESS proposal + ARCH report as pdfme inputs (pure, tests/pdf-docs.test.ts). Trial: pdfme (MIT) lays the pages out from the
// JSON templates in tools/pdfme/ (the owner edits those: pdfme.com/template-design); this file only turns ORBIT data into the
// template's fields. IO + the pdfme call: scripts/pdfme-docs.mjs. Nothing here sends anything; sending stays behind the existing approval.
import { totals, type Line } from "./invoices-pure.ts";

export type Lang = "en" | "et";
export type Doc = "proposal" | "arch-report";
export const DOC_TEMPLATES: Record<Doc, string> = { proposal: "tools/pdfme/proposal.template.json", "arch-report": "tools/pdfme/arch-report.template.json" };

const L = {
  en: { proposal: "Proposal", no: "No.", date: "Date", valid: "Valid until", for: "Prepared for", item: "Item", qty: "Qty", unit: "Unit price", total: "Total", net: "Subtotal", vat: "VAT", vatOff: "VAT not charged", gross: "Total", timeline: "Timeline", start: "Start", end: "Delivery", out: "Not included", terms: "Terms",
    report: "ARCH report", site: "Site", version: "Version", numbers: "Key numbers", rooms: "Rooms", room: "Room", area: "Area m²", glaz: "Glazing m²", crit: "Crit highlights", notes: "Notes", page: "Page" },
  et: { proposal: "Pakkumine", no: "Nr", date: "Kuupäev", valid: "Kehtib kuni", for: "Pakkumine adressaadile", item: "Kirjeldus", qty: "Kogus", unit: "Ühikuhind", total: "Summa", net: "Summa km-ta", vat: "Käibemaks", vatOff: "Käibemaksu ei lisandu", gross: "Kokku", timeline: "Ajakava", start: "Algus", end: "Valmimine", out: "Ei sisaldu", terms: "Tingimused",
    report: "ARCH aruanne", site: "Krunt", version: "Versioon", numbers: "Põhinäitajad", rooms: "Ruumid", room: "Ruum", area: "Pind m²", glaz: "Klaaspind m²", crit: "Kriitika põhipunktid", notes: "Märkmed", page: "Lk" },
} as const;

/** 1234.5 → "1 234,50" (et) / "1,234.50" (en). */
export const money = (cents: number, lang: Lang) => {
  const [i, d] = (cents / 100).toFixed(2).split(".");
  const g = i.replace(/\B(?=(\d{3})+(?!\d))/g, lang === "et" ? " " : ",");
  return `${g}${lang === "et" ? "," : "."}${d}`;
};

export type Brand = { name: string; tagline: string; regCode: string; email: string; phone: string; address: string };
export type ProposalData = {
  lang: Lang; brand: Brand; number: string; date: string; validUntil: string;
  client: { name: string; regCode?: string; address?: string; email?: string };
  intro: string; items: Line[]; vat: { on: boolean; rate: number };
  start: string; end: string; notIncluded?: string; terms: string;
};

const lines = (a: (string | undefined | false)[]) => a.filter(Boolean).join("\n");
const rows = (r: string[][]) => JSON.stringify(r);

export function proposalInputs(p: ProposalData): Record<string, string> {
  const T = L[p.lang], t = totals({ lines: p.items, vat: p.vat }), m = (c: number) => money(c, p.lang);
  return {
    brandName: p.brand.name, brandLine: p.brand.tagline,
    title: `${T.proposal} ${p.number}`,
    meta: lines([`${T.date}: ${p.date}`, `${T.valid}: ${p.validUntil}`]),
    forLabel: T.for,
    client: lines([p.client.name, p.client.regCode, p.client.address, p.client.email]),
    intro: p.intro,
    items: rows(p.items.map((l, i) => [l.text, String(l.qty), m(l.cents), m(t.lines[i])])),
    totals: lines([`${T.net}: ${m(t.net)} €`, p.vat.on ? `${T.vat} ${p.vat.rate}%: ${m(t.vat)} €` : T.vatOff, `${T.gross}: ${m(t.gross)} €`]),
    timelineHead: T.timeline, timeline: `${T.start}: ${p.start}\n${T.end}: ${p.end}`,
    outHead: T.out, notIncluded: p.notIncluded || "—",
    termsHead: T.terms, terms: p.terms,
  };
}

export type ArchReportData = {
  lang: Lang; author: string; title: string; site: string; version: string; at: string; brief: string;
  numbers: [string, string][]; // arch-portfolio-pure keyNumbers() output
  rooms: { name: string; area: number; glazing: number }[]; crits: string[]; notes: string;
};

export function archReportInputs(r: ArchReportData): Record<string, string> {
  const T = L[r.lang], f = (n: number) => (r.lang === "et" ? n.toFixed(1).replace(".", ",") : n.toFixed(1));
  return {
    brandName: r.author, brandLine: T.report,
    title: r.title,
    meta: lines([`${T.site}: ${r.site}`, `${T.version}: ${r.version} · ${r.at}`]),
    brief: r.brief,
    numbersHead: T.numbers, numbers: rows(r.numbers.map(([k, v]) => [k, v])),
    roomsHead: T.rooms, rooms: rows(r.rooms.map((x) => [x.name, f(x.area), f(x.glazing)])),
    critHead: T.crit, crits: r.crits.map((c) => `• ${c}`).join("\n") || "—",
    notesHead: T.notes, notes: r.notes,
  };
}

/** Table column heads are part of the template (edit them there); this is the language-specific set the generator patches in. */
export const tableHeads = (doc: Doc, lang: Lang): Record<string, string[]> => {
  const T = L[lang];
  return doc === "proposal" ? { items: [T.item, T.qty, T.unit, T.total] } : { numbers: [T.numbers, ""], rooms: [T.room, T.area, T.glaz] };
};

/** Template/input contract: every field the template draws must be filled and every input must have a field (catches a template edit that drops or renames one). */
export function templateMismatch(template: { schemas: { name: string; readOnly?: boolean }[][] }, inputs: Record<string, string>): string[] {
  const names = new Set(template.schemas.flat().filter((s) => !s.readOnly).map((s) => s.name));
  return [...[...names].filter((n) => !(n in inputs)).map((n) => `template field "${n}" has no input`), ...Object.keys(inputs).filter((k) => !names.has(k)).map((k) => `input "${k}" has no template field`)];
}

/** The line stamped at the foot of every page with "page n / N" (pdfme flows static fields down with the content, so the generator stamps this instead). */
export const footerText = (doc: Doc, d: ProposalData | ArchReportData): string =>
  doc === "proposal" ? [(d as ProposalData).brand.name, (d as ProposalData).brand.regCode && `reg. ${(d as ProposalData).brand.regCode}`, (d as ProposalData).brand.email, (d as ProposalData).brand.phone].filter(Boolean).join(" · ")
    : `${(d as ArchReportData).author} · ${(d as ArchReportData).title}`;
