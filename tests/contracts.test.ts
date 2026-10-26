import { test } from "node:test";
import assert from "node:assert/strict";
import {
  BLANK, TEMPLATES, TEMPLATE_IDS, briefContracts, buildClauses, changed, cleanFields, contractPdf, contractText, diffWords, fillText, makeVersion, mergeFields,
  missing, overridesOf, parseFill, parseSignature, pdfWrap, sha256Hex, transition, waitingIds, type Fields, type Status,
} from "../src/lib/contracts-pure.ts";
import { pdfString } from "../src/lib/pdf-pure.ts";

const svc = TEMPLATES.service;
const full: Fields = { ...cleanFields(svc, {}), ownerName: "Andreas K", partyName: "Rullimeister OÜ", scope: "a booking page", startDate: "1 Nov 2026", endDate: "30 Nov 2026", price: "900" };

test("every template has unique clause ids, a law clause, and only placeholders it can fill", () => {
  for (const id of TEMPLATE_IDS) {
    const t = TEMPLATES[id], ids = t.clauses.map((c) => c.id);
    assert.equal(new Set(ids).size, ids.length, id);
    assert.ok(ids.includes("law"), id);
    const keys = new Set<string>([...t.fields.map((f) => f.key), ...t.roles]);
    for (const c of t.clauses) for (const [, k] of c.text.matchAll(/\{\{([A-Za-z ]+)\}\}/g)) assert.ok(keys.has(k), `${id}.${c.id}: {{${k}}}`);
  }
});

test("fields: defaults (Estonia), only known keys, options enforced; his values beat the model's", () => {
  const f = cleanFields(svc, { price: " 500 ", evil: "x", ownerRole: "Boss" });
  assert.equal(f.jurisdiction, "the Republic of Estonia");
  assert.equal(f.ownerRole, "Provider"); // unknown option → default
  assert.equal(f.price, "500");
  assert.equal((f as Record<string, string>).evil, undefined);
  assert.deepEqual(mergeFields({ price: "500", scope: "" }, { price: "50", scope: "logo" }), { price: "500", scope: "logo" });
  assert.deepEqual(missing(svc, f).map((x) => x.key), ["ownerName", "partyName", "scope", "startDate", "endDate"]);
});

test("filling: roles follow ownerRole, blanks stay visible, empty Other terms is dropped", () => {
  assert.match(fillText(svc, "{{Provider}} pays {{Client}}", { ownerName: "A", partyName: "B", ownerRole: "Client" }), /^B pays A$/);
  assert.equal(fillText(svc, "{{price}}", {}), BLANK);
  const cl = buildClauses(svc, full);
  assert.ok(!cl.some((c) => c.id === "extra"));
  assert.ok(cl.every((c) => !changed(c)));
  assert.ok(buildClauses(svc, { ...full, extra: "Two revisions." }).some((c) => c.id === "extra"));
});

test("overrides are marked as changes with who made them; versions hash the exact text", async () => {
  const v1 = await makeVersion(svc, svc.title, full, {}, 1, "owner", "2026-10-26T10:00:00Z");
  const v2 = await makeVersion(svc, svc.title, full, { end: { text: "Either party may end this Agreement with 30 days' written notice.", by: "orbit", why: "longer project" } }, 2, "orbit", "2026-10-26T10:01:00Z");
  assert.match(v1.hash, /^[0-9a-f]{64}$/);
  assert.notEqual(v1.hash, v2.hash);
  assert.equal(v1.hash, await sha256Hex(contractText(svc, svc.title, full, v1.clauses)));
  const end = v2.clauses.find((c) => c.id === "end")!;
  assert.equal(changed(end), true); assert.equal(end.by, "orbit"); assert.equal(end.why, "longer project");
  assert.deepEqual(Object.keys(overridesOf(v2)), ["end"]);
  assert.equal(await sha256Hex("abc"), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
});

test("diffWords marks added and removed words and round-trips both texts", () => {
  const a = "with 14 days' written notice.", b = "with 30 days' written notice by email.";
  const d = diffWords(a, b);
  assert.equal(d.filter((p) => p.op !== "add").map((p) => p.text).join(""), a);
  assert.equal(d.filter((p) => p.op !== "del").map((p) => p.text).join(""), b);
  assert.ok(d.some((p) => p.op === "del" && p.text.includes("14")));
  assert.ok(d.some((p) => p.op === "add" && p.text.includes("30")));
  assert.deepEqual(diffWords("same", "same"), [{ op: "same", text: "same" }]);
});

test("status machine: ORBIT can only draft; signing, sending and countersigned are his alone", () => {
  for (const s of ["draft", "review", "signed", "sent"] as Status[]) for (const ev of ["sign", "send", "countersign", "cancel", "unsign"] as const)
    assert.equal(typeof transition(s, ev, "orbit"), "string", `${s} ${ev}`);
  assert.equal(transition("draft", "edit", "orbit", true), "review");
  assert.equal(transition("review", "edit", "orbit", false), "draft");
  assert.equal(transition("review", "sign", "owner"), "signed");
  assert.equal(typeof transition("draft", "sign", "owner"), "string");
  assert.equal(typeof transition("signed", "edit", "owner"), "string");
  assert.equal(transition("signed", "unsign", "owner"), "review");
  assert.equal(transition("signed", "send", "owner"), "sent");
  assert.equal(transition("sent", "unsend", "owner"), "signed");
  assert.equal(transition("sent", "countersign", "owner"), "countersigned");
  assert.equal(typeof transition("countersigned", "cancel", "owner"), "string");
});

test("parseFill keeps blank-only known fields and at most 3 suggestions on real clauses, never the law clause", () => {
  const ans = "Sure: " + JSON.stringify({ fields: { price: "700", hack: "x", ownerRole: "Pirate" }, suggestions: [
    { clause: "law", text: "Disputes go to the courts of Delaware, USA, exclusively.", why: "x" },
    { clause: "nope", text: "Some long enough clause text here.", why: "x" },
    { clause: "end", text: "Either party may end this with 30 days' notice in writing.", why: "longer" },
    { clause: "time", text: "short" },
  ] });
  const r = parseFill(svc, ans);
  assert.deepEqual(r.fields, { price: "700" });
  assert.deepEqual(Object.keys(r.overrides), ["end"]);
  assert.equal(r.overrides.end.by, "orbit");
  assert.deepEqual(parseFill(svc, "no json"), { fields: {}, overrides: {} });
});

test("signatures: typed needs a name, drawn needs real strokes in 0..1", () => {
  assert.deepEqual(parseSignature({ kind: "typed", name: " Andreas K " }), { kind: "typed", name: "Andreas K" });
  assert.equal(typeof parseSignature({ kind: "typed", name: "" }), "string");
  assert.equal(typeof parseSignature({ kind: "drawn", strokes: [[0, 0, 2, 2]] }), "string");
  assert.equal(typeof parseSignature({ kind: "drawn", strokes: [] }), "string");
  const ok = parseSignature({ kind: "drawn", strokes: [[0.1, 0.5, 0.2, 0.4, 0.3, 0.6, 0.4, 0.5], [0.5, 0.5, 0.6, 0.4, 0.7, 0.6, 0.8, 0.5]] });
  assert.equal(typeof ok, "object");
});

test("signed PDF: valid structure, signature page with the full hash and timestamp, Estonian letters kept", async () => {
  const v = await makeVersion(svc, svc.title, { ...full, partyName: "Õunapuu OÜ (Tallinn)" }, {}, 3, "owner", "2026-10-26T10:00:00Z");
  const bytes = contractPdf(svc, { title: svc.title }, v, { kind: "drawn", strokes: [[0.1, 0.5, 0.2, 0.4, 0.3, 0.6, 0.4, 0.5]] }, "2026-10-26T12:00:00.000Z");
  const s = Buffer.from(bytes).toString("latin1");
  assert.ok(s.startsWith("%PDF-1.4") && s.trimEnd().endsWith("%%EOF"));
  assert.ok(s.includes(v.hash), "full hash on the signature page");
  assert.ok(s.includes("2026-10-26 12:00:00 UTC"));
  assert.ok(s.includes("\xd5unapuu O\xdc \\(Tallinn\\)"), "WinAnsi Õ/Ü and escaped parens");
  assert.match(s, /\d+\.\d \d+\.\d m .* l/); // the drawn signature path
  // xref offsets point at their objects
  const xref = Number(s.match(/startxref\n(\d+)/)![1]);
  const offs = [...s.slice(xref).matchAll(/^(\d{10}) 00000 n $/gm)].map((m) => Number(m[1]));
  offs.forEach((o, i) => assert.ok(s.startsWith(`${i + 1} 0 obj`, o), `obj ${i + 1}`));
  assert.equal(pdfString("Привет"), "(??????)");
});

test("pdfWrap breaks long words and never returns an over-long line", () => {
  const lines = pdfWrap("x".repeat(250) + " short words here", 10, 200);
  assert.ok(lines.every((l) => l.length <= 40));
  assert.deepEqual(pdfWrap("", 10, 200), [""]);
});

test("waiting contracts: review only, after the wait; brief items open BUSINESS", () => {
  const now = Date.parse("2026-10-26T12:00:00Z");
  const list = [
    { id: "a", status: "review" as const, reviewAt: "2026-10-26T09:00:00Z", title: "Service Agreement", source: { kind: "prospect" as const, id: "p", label: "Rullimeister" } },
    { id: "b", status: "review" as const, reviewAt: "2026-10-26T11:30:00Z", title: "NDA" },
    { id: "c", status: "signed" as const, reviewAt: "2026-10-25T09:00:00Z", title: "X" },
  ];
  assert.deepEqual(waitingIds(list, now), ["a"]);
  const b = briefContracts(list);
  assert.equal(b.length, 2);
  assert.equal(b[0].id, "contract:a");
  assert.match(b[0].what, /Rullimeister, waiting for your signature/);
});
