// Manual check of the local fact check (factcheck-worker.mjs + factcheck-pure.ts) on real news articles. Not part of the gate:
// it needs the ~240 MB NLI model and a CPU pass. Run: node --experimental-strip-types scripts/factcheck-eval.ts [--sweep]
// Articles are read the way Pulse reads them (extractArticle, 2500 chars). Pages are cached in .cache/factcheck-eval/ (not in
// git: the text belongs to the publishers). The labels are for the text as it was on 21 Nov 2026; an article whose anchor
// sentence is gone is skipped. Each claim is written like a briefing sentence and labelled by hand:
//   backed = the article says it · not_backed = the article doesn't say it · contradicted = the article says otherwise
import { fork } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { extractArticle } from "../src/lib/pure.ts";
import { BACKED_AT, checkPairs, pairsFor, verdicts, verdictOf, type Claim, type Nli, type Source, type Verdict } from "../src/lib/factcheck-pure.ts";

type Label = Exclude<Verdict, "unchecked">;
const ARTICLES: { id: string; url: string; anchor: string; claims: [Label, string][] }[] = [
  { id: "bbc-markets", url: "https://www.bbc.co.uk/news/articles/c6808ym10vzgo", anchor: "correction territory", claims: [
    ["backed", "Anthropic's shares closed down 8.5% on Friday, close to their IPO price of $83."],
    ["backed", "The S&P 500 and the Dow Jones were both pushed into correction territory."],
    ["backed", "The Nasdaq Composite fell 5.3% on Friday."],
    ["backed", "A few big tech firms spent more than $1 trillion on AI in the last year."],
    ["backed", "Anthropic started trading on the Nasdaq on Thursday at $111.50."],
    ["contradicted", "The Nasdaq Composite rose 5.3% on Friday."],
    ["contradicted", "Anthropic's shares rose further on Friday."],
    ["not_backed", "Analysts expect Anthropic's shares to recover by the end of the year."],
    ["not_backed", "The sell-off was triggered by a surprise rise in US unemployment."],
    ["not_backed", "This shows the AI bubble has burst."],
  ] },
  { id: "npr-markets", url: "https://www.npr.org/2026/11/21/nx-s1-6048729/ai-stock-markets-anthropic-nvidia", anchor: "Jensen Huang", claims: [
    ["backed", "The Nasdaq dropped 10% this week, its worst week since March 2020."],
    ["backed", "In September the Federal Reserve raised interest rates for the first time in over three years."],
    ["backed", "Nvidia's CEO Jensen Huang resigned this month."],
    ["backed", "Democrats took over both chambers of Congress in the midterm elections."],
    ["contradicted", "The Federal Reserve cut interest rates in September."],
    ["contradicted", "Republicans kept control of both chambers of Congress in the midterms."],
    ["not_backed", "Nvidia's shares fell 20% after Jensen Huang resigned."],
    ["not_backed", "OpenAI plans to go public early next year."],
  ] },
  { id: "bbc-zelensky", url: "https://www.bbc.co.uk/news/articles/cxnv4zvmdy0jo", anchor: "Kryvyi Rih", claims: [
    ["backed", "Zelensky called Putin a killer after Trump called the Russian leader his friend."],
    ["backed", "Russian strikes on Kryvyi Rih killed two people, including a boy, and injured 52."],
    ["backed", "Russia fired 110 missiles and more than 400 drones at Ukraine on Friday."],
    ["backed", "Poland said a Russian cruise missile hit a rural area about 50km from the Ukrainian border."],
    ["contradicted", "Nobody was killed in the overnight strikes on Kryvyi Rih."],
    ["contradicted", "The missile that entered Poland hit a city centre."],
    ["not_backed", "Nato called an emergency meeting after the missile hit Poland."],
    ["not_backed", "Trump met Xi Jinping and Putin in Beijing."],
  ] },
  { id: "bbc-cop31", url: "https://www.bbc.co.uk/news/articles/c6ly5w40eg07o", anchor: "Antalya", claims: [
    ["backed", "The COP31 climate talks in Turkey are deadlocked over fossil fuels."],
    ["backed", "France and Panama led a group pushing back against a draft with no mention of cutting fossil fuel demand."],
    ["backed", "For the first time, the draft agreement admits that the 1.5C goal has been missed."],
    ["backed", "Fossil fuel producers led by Saudi Arabia pushed to remove the commitment to move away from oil, gas and coal."],
    ["contradicted", "The draft agreement says the 1.5C goal is still within reach."],
    ["not_backed", "The United States walked out of the COP31 talks."],
    ["not_backed", "All countries signed the final agreement on Saturday."],
  ] },
  { id: "guardian-waves", url: "https://www.theguardian.com/us-news/2026/nov/20/california-coastal-communities-alert-big-waves-hit-state", anchor: "34.1ft", claims: [
    ["backed", "A buoy off Monterey recorded a 34.1ft wave, the highest reading in 30 years."],
    ["backed", "Heavy rain left 32,000 customers without power in Sacramento."],
    ["backed", "Nearly 72,000 people were evacuated in Odisha ahead of Cyclone Akvan."],
    ["contradicted", "Heavy rain left 320,000 customers without power in Sacramento."],
    ["contradicted", "Beaches and piers stayed open last weekend despite the big waves."],
    ["not_backed", "Two surfers died in the big waves in California."],
    ["not_backed", "Cyclone Akvan killed dozens of people in India."],
  ] },
  { id: "npr-un-weapons", url: "https://www.npr.org/2026/11/21/g-s1-154914/nations-at-un-talks-on-ai-killer-robots-agree-to-more-talks-but-no-firm-commitment-to-rein-them-in", anchor: "Geneva", claims: [
    ["backed", "UN talks in Geneva on AI weapons ended with a deal to keep talking for two more years."],
    ["backed", "Countries did not commit to the binding rules the UN Secretary-General wanted."],
    ["backed", "Activists accused Russia and the United States of blocking stronger language."],
    ["backed", "Brazil, Austria, Belgium, Ireland, Mexico, New Zealand and Panama proposed starting negotiations."],
    ["contradicted", "Countries at the Geneva talks agreed binding rules on killer robots."],
    ["not_backed", "China proposed a ban on autonomous weapons at the talks."],
    ["not_backed", "The next round of talks will be held in New York in March."],
    ["not_backed", "This means AI weapons will stay unregulated until at least 2030."],
  ] },
];

const dir = path.join(process.cwd(), ".cache", "factcheck-eval");
mkdirSync(dir, { recursive: true });
async function page(id: string, url: string) {
  const f = path.join(dir, `${id}.html`);
  if (!existsSync(f)) writeFileSync(f, await (await fetch(url, { headers: { "user-agent": "Mozilla/5.0" } })).text());
  const a = extractArticle(readFileSync(f, "utf8"), 2500); // what Pulse keeps of a page it read in full
  return `${a.title}.\n${a.text}`;
}

const claims: (Claim & { label: Label; article: string })[] = [];
const sources = new Map<string, Source>();
for (const a of ARTICLES) {
  const text = await page(a.id, a.url);
  if (!text.includes(a.anchor)) { console.log(`SKIP ${a.id}: the page changed (no "${a.anchor}"), its labels no longer apply`); continue; }
  sources.set(a.id, { id: a.id, text });
  for (const [label, sentence] of a.claims) claims.push({ key: claims.length, sentence, sources: [a.id], label, article: a.id });
}
const pairs = pairsFor(claims, sources, Number(process.env.FC_K) || undefined); // FC_K: windows per source (default WINDOWS_PER_SOURCE)

const w = fork(path.join(process.cwd(), "src/lib/factcheck-worker.mjs"), [], { execArgv: [] });
const ask = (msg: Record<string, unknown>) => new Promise<(Nli | null)[]>((res, rej) => {
  const on = (m: { id?: number; result?: (Nli | null)[]; error?: string }) => { if (m.id !== 1 && m.id !== 2 && m.id !== 3) return; w.off("message", on); m.result ? res(m.result) : rej(new Error(m.error)); };
  w.on("message", on); w.send(msg);
});
const base = { model: process.env.ORBIT_FACTCHECK_MODEL || "Xenova/DeBERTa-v3-base-mnli-fever-anli", cacheDir: path.join(process.cwd(), ".cache", "transformers") };
let t = Date.now();
await ask({ id: 1, ...base });
const loadMs = Date.now() - t;
t = Date.now();
const scores = await ask({ id: 2, ...base, pairs: pairs.map((p) => [p.premise, p.hypothesis]) });
const runMs = Date.now() - t;
const v2 = checkPairs(claims, sources); // the check Pulse uses: whole claim + its separate facts, across all cited sources
const v2Scores = await ask({ id: 3, ...base, pairs: v2.pairs.map((p) => [p.premise, p.hypothesis]) });
w.kill();

const v = process.argv.includes("--v1") ? verdicts(claims, pairs, scores) : v2.decide(v2Scores);
const pct = (a: number, b: number) => (b ? `${a}/${b} = ${Math.round((100 * a) / b)}%` : "n/a");
function report(v: Map<number, Verdict>, print: boolean) {
  const got = claims.map((c) => ({ c, g: v.get(c.key)! }));
  if (print) for (const { c, g } of got) console.log(`${g === c.label ? "ok  " : g === "backed" || c.label === "backed" ? "MISS" : "~   "} ${c.label.padEnd(12)} -> ${g.padEnd(12)} ${c.article}: ${c.sentence}`);
  const marked = got.filter((x) => x.g === "not_backed" || x.g === "contradicted"), bad = got.filter((x) => x.c.label !== "backed");
  const removed = got.filter((x) => x.g === "contradicted"), passed = got.filter((x) => x.g === "backed");
  return {
    flagPrecision: pct(marked.filter((x) => x.c.label !== "backed").length, marked.length), // flagged or removed claims that really aren't backed
    flagRecall: pct(marked.filter((x) => x.c.label !== "backed").length, bad.length),
    removePrecision: pct(removed.filter((x) => x.c.label === "contradicted").length, removed.length),
    removedTrue: removed.filter((x) => x.c.label === "backed").length, // true claims deleted: must stay 0
    backedPrecision: pct(passed.filter((x) => x.c.label === "backed").length, passed.length),
    trueFlagged: marked.filter((x) => x.c.label === "backed").length,
  };
}
console.log("");
const r = report(v, true);
const n = (l: Label) => claims.filter((c) => c.label === l).length;
console.log(`\n${claims.length} claims from ${sources.size} articles (${n("backed")} backed, ${n("not_backed")} not backed, ${n("contradicted")} contradicted), ${pairs.length} pairs`);
console.log(`model load ${loadMs} ms, scoring ${runMs} ms (${Math.round(runMs / pairs.length)} ms per pair)`);
console.log(`flag precision (marked or removed claims that really aren't backed): ${r.flagPrecision}`);
console.log(`flag recall (unbacked/contradicted claims that got marked or removed): ${r.flagRecall}`);
console.log(`removal precision (removed claims that the source really contradicts): ${r.removePrecision}; true claims removed: ${r.removedTrue}`);
console.log(`backed precision (claims passed as backed that really are): ${r.backedPrecision}; true claims flagged: ${r.trueFlagged}`);

if (process.argv.includes("--sweep")) { // entailment threshold for "backed" (the removal rule stays as in factcheck-pure.ts)
  console.log("\nBACKED_AT sweep:");
  for (const at of [0.5, 0.7, 0.8, 0.9, 0.95]) {
    const by = new Map<number, (Nli | null)[]>();
    pairs.forEach((p, i) => by.set(p.claim, [...(by.get(p.claim) ?? []), scores[i]]));
    const vv = new Map(claims.map((c) => {
      const s = (by.get(c.key) ?? []).filter((x): x is Nli => !!x), e = Math.max(0, ...s.map((x) => x[0]));
      return [c.key, e >= at ? "backed" as const : verdictOf(s.map((x) => (x[0] >= BACKED_AT ? [BACKED_AT - 0.01, x[1], x[2]] as Nli : x)))];
    }));
    const q = report(vv, false);
    console.log(`  ${at.toFixed(2)}${at === BACKED_AT ? "*" : " "} flag precision ${q.flagPrecision}, recall ${q.flagRecall}, true claims flagged ${q.trueFlagged}`);
  }
}
