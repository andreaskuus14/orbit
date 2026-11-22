import { test } from "node:test";
import assert from "node:assert/strict";
import * as f from "../src/lib/factcheck-pure.ts";
import { checkClaims } from "../src/lib/news-intel-pure.ts";

const id = (n: number) => `00000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
const ART = "Poland says a Russian cruise missile crashed on Friday. Nobody was hurt and no damage has been reported.\nThe missile hit a rural area about 50km from the Ukrainian border. Nato Secretary General Mark Rutte condemned the violation.";

test("windows: two-sentence windows, entities decoded, short lines dropped", () => {
  const w = f.windows("Caption.\nAnthropic&#x27;s shares fell on Friday. It closed down 8.5% on the day. Analysts expected swings.");
  assert.deepEqual(w, ["Anthropic's shares fell on Friday. It closed down 8.5% on the day.", "It closed down 8.5% on the day. Analysts expected swings."]);
  assert.deepEqual(f.windows("One sentence only here, long enough."), ["One sentence only here, long enough."]);
});

test("bestWindows: the windows sharing most words with the claim come first; numbers count double", () => {
  const [top] = f.bestWindows("The missile landed 50km from the border", ART, 1);
  assert.match(top, /50km/);
  assert.equal(f.bestWindows("x", ART, 2).length, 2);
});

test("briefingClaims: cited sentences only, headings skipped, citations and bullets stripped", () => {
  const c = f.briefingClaims(`### Missile [a:${id(1)}]\n- A **Russian** missile crashed in Poland [a:${id(1)}][a:${id(2)}]. Why it matters: Nato is alert.\nNo cite here.`);
  assert.equal(c.length, 1);
  assert.equal(c[0].sentence, "A Russian missile crashed in Poland.");
  assert.deepEqual(c[0].sources, [id(1), id(2)]);
});

test("verdictOf: clear entailment backs; strong contradiction with no backing removes; nothing scored = unchecked", () => {
  assert.equal(f.verdictOf([[0.2, 0.7, 0.1], [0.95, 0.04, 0.01]]), "backed");
  assert.equal(f.verdictOf([[0.05, 0.0, 0.95], [0.1, 0.9, 0]]), "contradicted");
  assert.equal(f.verdictOf([[0.5, 0.0, 0.98]]), "not_backed"); // half-backed: flagged, never removed
  assert.equal(f.verdictOf([[0.3, 0.6, 0.1]]), "not_backed");
  assert.equal(f.verdictOf([null, null]), "unchecked");
  assert.equal(f.verdictOf([[0.3, 0.6, 0.1], null]), "unchecked"); // out of time before every window was read: no flag
  assert.equal(f.verdictOf([[0.05, 0, 0.95], null]), "unchecked");
  assert.equal(f.verdictOf([[0.95, 0.04, 0.01], null]), "backed");
  assert.equal(f.verdictOf([]), "unchecked");
});

const brief = `## World\n- Russian missile hits Poland [a:${id(1)}]. Nobody was hurt [a:${id(1)}].\n- Russia apologised [a:${id(2)}].\nShares fell sharply [a:${id(3)}].`;
const sources = new Map<string, f.Source>([
  [id(1), { id: id(1), text: ART, outlet: "BBC News", topic: "world" }],
  [id(2), { id: id(2), text: ART, outlet: "BBC", topic: "world" }],
  [id(3), { id: id(3), text: "Shares fell.", outlet: "NPR", topic: "economy" }],
]);

test("applyBriefing: flag before the citation, contradicted removed (empty bullet dropped), one outlet on an important topic marked", () => {
  const claims = f.briefingClaims(brief);
  assert.equal(claims.length, 4);
  const v = new Map<number, f.Verdict>([[claims[0].key, "backed"], [claims[1].key, "not_backed"], [claims[2].key, "contradicted"], [claims[3].key, "unchecked"]]);
  const r = f.applyBriefing(brief, claims, v, sources);
  assert.equal(r.content, `## World\n- Russian missile hits Poland (only one source) [a:${id(1)}]. Nobody was hurt (not backed by the source) [a:${id(1)}].\nShares fell sharply [a:${id(3)}].`);
  assert.deepEqual({ ...r, content: undefined }, { content: undefined, backed: 1, notBacked: 1, removed: 1, oneSource: 1, unchecked: 1 });
  // the existing claim check still parses every remaining cited sentence
  assert.equal(checkClaims(r.content, [...sources.values()].map((s) => ({ id: s.id, url: "https://x", published_at: null }))).length, 3);
  assert.equal(f.briefingNote(r), `_Fact check: removed 1 claim the source says otherwise about; 1 claim marked "not backed by the source"._`);
  assert.equal(f.briefingNote({ backed: 3, notBacked: 0, removed: 0, oneSource: 1, unchecked: 0 }), "");
});

test("one-source mark: two outlets, or an unimportant topic, get no mark", () => {
  const two = `Missile hits Poland [a:${id(1)}][a:${id(3)}].`, cl = f.briefingClaims(two);
  const r = f.applyBriefing(two, cl, new Map([[cl[0].key, "backed" as const]]), sources);
  assert.equal(r.oneSource, 0);
  assert.equal(f.importantTopic("A new indie game came out", [{ id: "x", text: "", topic: "games" }]), false);
  assert.equal(f.importantTopic("A missile hit a farm", [{ id: "x", text: "", topic: "games" }]), true);
  assert.equal(f.outlets([{ id: "a", text: "", outlet: "The Guardian" }, { id: "b", text: "", outlet: "guardian" }]), 1);
});

test("pairsFor: sources without text give no pairs; k windows per cited source", () => {
  const claims: f.Claim[] = [{ key: 0, sentence: "Nobody was hurt", sources: [id(1), id(9)] }];
  const p = f.pairsFor(claims, sources, 2);
  assert.equal(p.length, 2);
  assert.ok(p.every((x) => x.claim === 0 && x.hypothesis === "Nobody was hurt"));
  const v = f.verdicts(claims, p, [[0.97, 0.02, 0.01], null]);
  assert.equal(v.get(0), "backed");
});

test("CORE: claims with links, sources from opened pages and web_search lines, note names unbacked claims", () => {
  const answer = "Here is what I found.\n- The Palisades fire killed 12 people ([DW](https://www.dw.com/en/fire/a-1)).\n- The man faces 40 years in prison [AP](https://apnews.com/x).\n```\nhttps://code.example/ignored is code\n```";
  const c = f.answerClaims(answer);
  assert.deepEqual(c.map((x) => [x.sentence, x.sources]), [["The Palisades fire killed 12 people.", ["dw.com/en/fire/a-1"]], ["The man faces 40 years in prison.", ["apnews.com/x"]]]);
  const s = f.answerSources([
    { tool: "fetch_url", input: { url: "https://dw.com/en/fire/a-1/" }, output: "The fire killed 12 people." },
    { tool: "web_search", input: { query: "q" }, output: "- He could face up to 40 years [AP News](https://apnews.com/x)\n- other [y](https://y.org)" },
    { tool: "fetch_url", input: { url: "https://bad.example" }, output: "Error: blocked" },
  ]);
  assert.equal(s.get("dw.com/en/fire/a-1")?.text, "The fire killed 12 people.");
  assert.equal(s.get("apnews.com/x")?.text, "- He could face up to 40 years AP News");
  assert.equal(s.has("bad.example"), false);
  const v = new Map<number, f.Verdict>([[c[0].key, "backed"], [c[1].key, "not_backed"]]);
  assert.equal(f.answerNote(c, v), "\n\n_Fact check: this claim is not backed by the source it links: “The man faces 40 years in prison.”._");
  assert.match(f.answerNote(c, v, "et"), /allikas seda ei kinnita/);
  assert.equal(f.answerNote(c, new Map([[c[0].key, "backed"], [c[1].key, "unchecked"]])), "");
});

test("ORBIT_FACTCHECK=0 turns it off; on by default", () => {
  assert.equal(f.factcheckOn({}), true);
  assert.equal(f.factcheckOn({ ORBIT_FACTCHECK: "0" }), false);
  assert.equal(f.factcheckOn({ ORBIT_FACTCHECK: "1" }), true);
});

test("atoms: a joined sentence splits into its facts; a single fact stays whole", () => {
  assert.deepEqual(f.atoms("Rescuers said 15 survivors had been located, and four others were taken to hospital."),
    ["Rescuers said 15 survivors had been located", "four others were taken to hospital"]);
  assert.deepEqual(f.atoms("The raid left 11 dead; he was flown to Mexico City."), ["The raid left 11 dead", "he was flown to Mexico City"]);
  assert.deepEqual(f.atoms("A fire in Banten province, west of Jakarta, killed three."), ["A fire in Banten province, west of Jakarta, killed three."]);
});

test("checkPairs (22 Nov midday): a claim backed fact by fact across two outlets is backed, not flagged", () => {
  const src = new Map<string, f.Source>([
    ["a", { id: "a", text: `${"Filler sentence about the region and its weather today. ".repeat(12)}The raid left four soldiers and seven gunmen dead.` }],
    ["b", { id: "b", text: `${"Other filler about the city and the local economy here. ".repeat(12)}He was then flown to Mexico City on an air force plane.` }],
  ]);
  const claims = [{ key: 0, sentence: "The raid left four soldiers and seven gunmen dead, and he was flown to Mexico City.", sources: ["a", "b"] }];
  const { pairs, decide } = f.checkPairs(claims, src);
  assert.ok(pairs.some((p) => p.atom === -1) && pairs.some((p) => p.atom === 1), "whole claim and each fact are scored");
  assert.ok(pairs.findIndex((p) => p.atom >= 0) > pairs.findLastIndex((p) => p.atom === -1), "whole-claim pairs come first");
  const s = pairs.map((p) => (p.atom === -1 ? [0.3, 0.6, 0.1] : p.premise.includes(p.atom === 0 ? "gunmen" : "flown") ? [0.97, 0.02, 0.01] : [0.1, 0.8, 0.1]) as f.Nli);
  assert.equal(decide(s).get(0), "backed");
});

test("checkPairs: snippet-only sources are never flagged; a read source is; removal needs no part near backed", () => {
  const short = new Map<string, f.Source>([["s", { id: "s", text: "Factory fire kills three. Dozens missing after the blaze." }]]);
  const c = [{ key: 0, sentence: "A company representative said 300 workers were inside.", sources: ["s"] }];
  const a = f.checkPairs(c, short);
  assert.equal(a.decide(a.pairs.map(() => [0.05, 0.9, 0.05] as f.Nli)).get(0), "unchecked", "we only had the headline: no mark");
  const long = new Map<string, f.Source>([["l", { id: "l", text: "Officials said 60 people were inside the factory when it caught fire. ".repeat(12) }]]);
  const b = f.checkPairs([{ ...c[0], sources: ["l"] }], long);
  assert.equal(b.decide(b.pairs.map(() => [0.05, 0.9, 0.05] as f.Nli)).get(0), "not_backed");
  assert.equal(b.decide(b.pairs.map(() => [0.01, 0.01, 0.98] as f.Nli)).get(0), "contradicted");
  const two = [{ key: 0, sentence: "He was on the FBI list, and he evaded capture for a decade.", sources: ["l"] }];
  const t = f.checkPairs(two, long);
  const sc = t.pairs.map((p) => (p.atom === 0 ? [0.6, 0.3, 0.1] : [0.01, 0.01, 0.98]) as f.Nli);
  assert.notEqual(t.decide(sc).get(0), "contradicted", "a part close to backed keeps a true claim from being deleted");
  assert.equal(t.decide(t.pairs.map(() => null)).get(0), "unchecked", "out of time: no mark");
});
