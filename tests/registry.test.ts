import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  arraySplitter, basicParser, boardOf, closedProblem, decide, decodeRow, draftFacts, emtakParser, encodeRow, fieldOf, figuresParser, isLinked, leadPlace, nameScore,
  peopleIn, pickFiles, refreshDue, refreshMatch, reportsParser, rowJoiner, splitRow, staffBand, toInfo, toMatch, turnoverBand, yearsActive, IDLE, type IndexRow, type Person,
} from "../src/lib/registry-pure.ts";
import { outreachPrompt } from "../src/lib/business-pure.ts";
import { pitchPrompt } from "../src/lib/lead-loop-pure.ts";
import { prospectLine, type Crm } from "../src/lib/prospect-crm-pure.ts";

// Fixtures are made up (codes 9000000x, invented names): no real personal data.
const fx = (n: string) => readFileSync(new URL(`./fixtures/registry/${n}`, import.meta.url), "utf8");
const rowsOf = (text: string) => { const join = rowJoiner(), out: string[][] = []; for (const l of text.split(/\r?\n/)) { const r = join(l); if (r !== null && r.trim()) out.push(splitRow(r)); } return out; };
const TODAY = "2026-11-21";

function index(): IndexRow[] {
  const [h, ...rows] = rowsOf(fx("basic.csv"));
  const parse = basicParser(h)!;
  return rows.map(parse).filter((r): r is NonNullable<typeof r> => !!r).map((r) => decodeRow(encodeRow(r))!);
}

test("pickFiles: RIK's own links only, latest two key-figure years", () => {
  const f = pickFiles(fx("page.html"))!;
  assert.equal(f.basic, "https://avaandmed.ariregister.rik.ee/sites/default/files/avaandmed/ettevotja_rekvisiidid__lihtandmed.csv.zip");
  assert.match(f.persons!, /kaardile_kantud_isikud\.json\.zip$/);
  assert.match(f.reports!, /1\.aruannete_yldandmed/);
  assert.match(f.emtak!, /2\.EMTAK_myygitulu/);
  assert.deepEqual(f.figures.map((x) => x.year), [2025, 2024]);
  assert.equal(pickFiles('<a href="https://evil.example/sites/default/files/avaandmed/ettevotja_rekvisiidid__lihtandmed.csv.zip">x</a>'), null);
});

test("basic CSV: quotes, BOM, statuses, non-lead forms dropped, index round trip", () => {
  const rows = index();
  assert.deepEqual(rows.map((r) => r.code), ["90000001", "90000002", "90000003", "90000005", "90000006"]); // the apartment association is not a lead
  assert.equal(rows[2].name, 'Kask "Ilusalong" OÜ');
  assert.equal(rows[2].status, "liquidation");
  assert.equal(rows[0].founded, "2012-03-12");
  assert.equal(rows[0].place, "Tartu linn, Tartu linn, Tartu maakond");
  assert.equal(basicParser(["foo", "bar"]), null);
  assert.equal(decodeRow("not\ta\trow"), null);
  const j = rowJoiner();
  assert.equal(j('"two'), null);
  assert.equal(j('lines";x'), '"two\nlines";x');
});

test("annual-report files → figures for the right report", () => {
  const [rh, ...rr] = rowsOf(fx("reports.csv")), rp = reportsParser(rh, new Set([2025, 2024]))!;
  assert.deepEqual(rr.map(rp).filter(Boolean).map((x) => x!.id), ["100", "101"]); // 2019 is not kept
  const [eh, ...er] = rowsOf(fx("emtak.csv")), ep = emtakParser(eh)!;
  assert.deepEqual(er.map(ep).filter(Boolean), [{ id: "101", emtak: "10711", v: "2008" }]); // main activity only
  const [fh, ...fr] = rowsOf(fx("figures.csv")), fp = figuresParser(fh)!;
  assert.deepEqual(fr.map(fp).filter(Boolean), [{ id: "101", what: "revenue", value: 125000 }, { id: "101", what: "staff", value: 3.4 }]); // an empty value is not 0
});

test("enrichment mapping: field, bands, legal form, years", () => {
  const info = toInfo({ ...index()[0], emtak: "10711", emtakV: "2008", revenue: 125000, staff: 3.4, year: 2025 });
  assert.equal(info.formShort, "OÜ");
  assert.equal(info.field?.en, "Manufacturing");
  assert.equal(info.turnover?.en, "€50k–200k");
  assert.equal(info.staff?.en, "2–9 people");
  assert.equal(info.link, "https://ariregister.rik.ee/est/company/90000001");
  assert.equal(toInfo(index()[1]).turnover, null); // no report: unknown, never invented
  assert.equal(fieldOf("96021", "2008")?.en, "Personal services (hair, beauty and more)");
  assert.equal(fieldOf("62010", "2025")?.en, "Software and IT");
  assert.equal(fieldOf("61100", "2025")?.en, "Telecom and IT");
  assert.equal(fieldOf("61100", "2008")?.en, "Information and communication");
  assert.equal(fieldOf("", "2008"), null);
  assert.equal(turnoverBand(0)?.en, "no sales");
  assert.equal(turnoverBand(9_999)?.en, "under €10k");
  assert.equal(turnoverBand(20_000_000)?.en, "over €10M");
  assert.equal(staffBand(0)?.en, "no staff (owner only)");
  assert.equal(staffBand(0.7)?.en, "1 person");
  assert.equal(staffBand(300)?.en, "250+ people");
  assert.equal(staffBand(null), null);
  assert.equal(yearsActive("2012-03-12", TODAY), "over ten years");
  assert.equal(yearsActive("2026-05-01", TODAY), "less than a year");
  assert.equal(yearsActive("", TODAY), "");
});

test("matching: clear match, place parsing, never a guess when close or unknown", () => {
  const rows = index();
  const osm = leadPlace("Source: © OpenStreetMap contributors (ODbL), https://www.openstreetmap.org/node/1\nAddress: Proovi tn 5, 51004, Tartu");
  assert.deepEqual(osm, { city: "Tartu", street: "Proovi tn 5", postcode: "51004" });
  const hit = decide({ name: "Näidis Pagariäri", place: osm }, rows);
  assert.equal(hit.state, "matched");
  assert.equal(hit.state === "matched" && hit.best.row.code, "90000001");
  assert.ok(hit.state === "matched" && hit.best.score >= 95);
  // Same name, wrong town: not a match.
  assert.notEqual(decide({ name: "Näidis Pagariäri", place: { city: "Pärnu", street: "", postcode: "" } }, rows).state, "matched");
  // Two near-identical names in the same district: he picks, ORBIT doesn't.
  const two = decide({ name: "Lilleke Stuudio", place: { city: "Tallinn", street: "", postcode: "" } }, rows);
  assert.equal(two.state, "ambiguous");
  assert.deepEqual(two.options.map((o) => o.code).sort(), ["90000005", "90000006"]);
  // No city on the lead: no match at all, only options.
  assert.equal(decide({ name: "Näidis Pagariäri", place: { city: "", street: "", postcode: "" } }, rows).state, "no-place");
  assert.equal(decide({ name: "Täiesti Teine Firma", place: { city: "Tartu", street: "", postcode: "" } }, rows).state, "none");
  assert.equal(nameScore("OÜ Kati Ilusalong", "Kati Ilusalong AS"), 1); // legal form words don't count
  assert.ok(nameScore("Kati Ilusalong", "Ilusalong Kati") > 0.85);
});

test("match record: status refresh, a code gone from the open data reads as deleted, closed businesses get no pitch", () => {
  const rows = index(), at = "2026-11-21T10:00:00Z";
  const m = toMatch(decide({ name: "Näidis Pagariäri", place: leadPlace("City: Tartu") }, rows), at);
  assert.ok(isLinked(m));
  const gone = refreshMatch(m, null, at);
  assert.equal(gone.state, "gone");
  assert.equal(gone.info?.status, "deleted");
  assert.match(closedProblem(gone.info), /deleted/);
  assert.equal(closedProblem(m.info), "");
  assert.match(closedProblem(toInfo(rows[2])), /wound up/);
  assert.equal(draftFacts(toInfo(rows[2]), TODAY), ""); // nothing from a closing business goes into a draft
});

test("weekly refresh timing", () => {
  const now = Date.parse("2026-11-21T10:00:00Z");
  assert.equal(refreshDue(IDLE, now), false); // never before his first click
  assert.equal(refreshDue({ ...IDLE, on: true }, now), true);
  assert.equal(refreshDue({ ...IDLE, on: true, finishedAt: "2026-11-18T10:00:00Z" }, now), false);
  assert.equal(refreshDue({ ...IDLE, on: true, finishedAt: "2026-11-14T09:00:00Z" }, now), true);
  assert.equal(refreshDue({ ...IDLE, on: true, stage: 2 }, now), false);
});

test("persons file: streamed split, only current board members, no ID codes kept", () => {
  const text = fx("persons.json"), split = arraySplitter(), objs: string[] = [];
  for (let i = 0; i < text.length; i += 37) objs.push(...split(text.slice(i, i + 37))); // odd chunk size: splits inside strings and braces
  assert.equal(objs.length, 2);
  const b = boardOf(JSON.parse(objs[0]))!;
  assert.equal(b.code, "90000001");
  assert.deepEqual(b.board, [{ name: "Testi Näidisnimi", role: "Juhatuse liige", since: "2012-03-12" }]);
  assert.ok(!JSON.stringify(b).includes("hash") && !JSON.stringify(b).includes("00000000-aaaa"));
  assert.deepEqual(boardOf(JSON.parse(objs[1]))!.board, []);
});

test("GDPR: board names never reach a draft prompt or the model-facing prospect list", () => {
  const people: Person[] = boardOf(JSON.parse(arraySplitter()(fx("persons.json"))[0]))!.board;
  const row = { ...index()[0], emtak: "10711", emtakV: "2008" as const, revenue: 125000, staff: 3.4, year: 2025 };
  const m = toMatch({ state: "matched", best: { row, score: 97, name: 1, city: 1, street: 1 }, options: [] }, "2026-11-21T10:00:00Z");
  // The record kept on the lead has no people in it at all.
  assert.ok(!/Näidisnimi|Testi/.test(JSON.stringify(m)));
  const facts = draftFacts(m.info, TODAY);
  assert.match(facts, /field of activity: manufacturing; in business for over ten years/);
  assert.doesNotMatch(facts, /\d/); // no numbers (no turnover, no years as digits)
  const crm: Crm = { source: "lead-loop", verified: false, key: "x", events: [], registry: m };
  const p = { id: "p1", name: "Näidis Pagariäri", kind: "bakery", contact: "", stage: "lead", notes: "City: Tartu", draft: "", updated_at: "2026-11-21T10:00:00Z" };
  const texts = [outreachPrompt(p, "Estonian", "auto", facts), pitchPrompt({ name: p.name, city: "Tartu", category: "bakery" }, "Estonian", facts), prospectLine(p, crm, TODAY)];
  for (const t of texts) {
    assert.deepEqual(peopleIn(t, people, p.name), [], t);
    assert.doesNotMatch(t, /Näidisnimi/);
    assert.match(t, /over ten years/);
  }
  // The guard catches a name that slipped into notes, either word order, any case and accents.
  assert.deepEqual(peopleIn(outreachPrompt({ ...p, notes: "talk to testi naidisnimi" }, "English", "auto", facts), people, p.name), ["Testi Näidisnimi"]);
  assert.deepEqual(peopleIn("Näidisnimi, Testi said hi", people), ["Testi Näidisnimi"]);
  // An FIE trades under the owner's own name: that public business name is not a leak, the name elsewhere is.
  const fie: Person[] = [{ name: "Mari Maasikas", role: "Juhatuse liige", since: "" }];
  assert.deepEqual(peopleIn("Business: Mari Maasikas FIE\nType: florist", fie, "Mari Maasikas FIE"), []);
  assert.deepEqual(peopleIn("Business: Mari Maasikas FIE\nAsk Mari Maasikas about it", fie, "Mari Maasikas FIE"), ["Mari Maasikas"]);
});

test("GDPR: every draft path runs the people guard before the model call", () => {
  const src = (f: string) => readFileSync(new URL(`../src/${f}`, import.meta.url), "utf8");
  for (const [file, marker] of [["app/api/business/route.ts", "OUTREACH_SYSTEM, {"], ["app/api/business/leads/route.ts", "PITCH_SYSTEM, {"], ["lib/night.ts", "FOLLOWUP_SYSTEM, {"]] as const) {
    const s = src(file), call = s.indexOf(marker), guard = s.lastIndexOf("peopleBlock(", call);
    assert.ok(call > 0 && guard > 0 && call - guard < 800, `${file}: peopleBlock must come right before the model call`);
  }
  // Only the lead-card route returns board members, and the people store is never read by a prompt builder.
  const route = src("app/api/business/registry/route.ts");
  assert.match(route, /peopleOf\(/);
  assert.doesNotMatch(route, /askClaude|claude"/);
  for (const f of ["lib/business-pure.ts", "lib/lead-loop-pure.ts", "lib/prospect-crm-pure.ts", "lib/agents.ts"]) assert.doesNotMatch(src(f), /peopleOf\(|lookUpBoards|from "\.\/registry(\.ts)?"/);
});
