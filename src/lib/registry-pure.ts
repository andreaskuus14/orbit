// Estonian e-Business Register enrichment for BUSINESS leads. Pure: which open-data files to fetch, CSV/JSON row parsing, the
// compact local index, the scored fuzzy name + place match, the facts a lead card shows, the draft facts line and the GDPR
// guard. IO (download, index build, people store): registry.ts. Tests: tests/registry.test.ts.
//
// Data: the e-Business Register OPEN DATA bulk files (https://avaandmed.ariregister.rik.ee/en/downloading-open-data), licence
// CC BY 4.0 (https://creativecommons.org/licenses/by/4.0/legalcode): reuse is allowed, commercial too, with attribution. RIK's
// page adds: when open data has personal data, the re-user must follow the GDPR. So board-member names (personal data) are
// kept only for the leads in his pipeline, only on his lead card: never in drafts, prompts or anything sent to a model.
// No per-lead lookups on paid services, no logins: one weekly bulk refresh into a local index.

export const PAGE_URL = "https://avaandmed.ariregister.rik.ee/en/downloading-open-data";
export const HOST = "https://avaandmed.ariregister.rik.ee";
export const LICENCE_URL = "https://creativecommons.org/licenses/by/4.0/legalcode";
export const ATTRIBUTION = "Estonian e-Business Register open data (RIK), CC BY 4.0";
export const companyUrl = (code: string) => `https://ariregister.rik.ee/est/company/${encodeURIComponent(code)}`;
export const REFRESH_DAYS = 7;

// ---- Which files -------------------------------------------------------------------------

export type Files = { basic: string; persons: string | null; reports: string | null; emtak: string | null; figures: { year: number; url: string }[] };

/** The download page → the bulk files we use. File names carry a date and change monthly, so they are read from the page. Only
 *  links on RIK's own /sites/default/files/ path are taken. null when the basic-data CSV isn't there (page changed). */
export function pickFiles(html: string): Files | null {
  const hrefs = [...html.matchAll(/href="(\/sites\/default\/files\/[^"?#\s]+\.zip)"/g)].map((m) => m[1]);
  const one = (re: RegExp) => { const h = hrefs.find((x) => re.test(x)); return h ? HOST + h : null; };
  const basic = one(/\/ettevotja_rekvisiidid__lihtandmed\.csv\.zip$/);
  if (!basic) return null;
  const figures = new Map<number, string>();
  for (const h of hrefs) { const m = /\/4\.(\d{4})_aruannete_elemendid[^/]*\.zip$/.exec(h); if (m && !figures.has(+m[1])) figures.set(+m[1], HOST + h); }
  return {
    basic,
    persons: one(/\/ettevotja_rekvisiidid__kaardile_kantud_isikud\.json\.zip$/),
    reports: one(/\/1\.aruannete_yldandmed[^/]*\.zip$/),
    emtak: one(/\/2\.EMTAK_myygitulu[^/]*\.zip$/),
    figures: [...figures].sort((a, b) => b[0] - a[0]).slice(0, 2).map(([year, url]) => ({ year, url })), // latest two years: a late filer still gets figures
  };
}

// ---- CSV ---------------------------------------------------------------------------------

/** One ;-separated row with "quoted ""fields""". */
export function splitRow(line: string, sep = ";"): string[] {
  const out: string[] = [];
  let cell = "", q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (q) { if (c === '"') { if (line[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += c; }
    else if (c === '"') q = true;
    else if (c === sep) { out.push(cell); cell = ""; }
    else cell += c;
  }
  out.push(cell);
  return out;
}
/** Lines → whole rows: a quoted field may hold a line break, so a line with an open quote waits for the next one. */
export function rowJoiner(): (line: string) => string | null {
  let held = "";
  return (line) => {
    const cur = held ? `${held}\n${line}` : line;
    if (((cur.match(/"/g)?.length ?? 0) & 1) === 1) { held = cur; return null; }
    held = "";
    return cur;
  };
}
export const headerIndex = (header: string[]) => {
  const h = header.map((x) => x.replace(/^﻿/, "").trim().toLowerCase());
  return (name: string) => h.indexOf(name);
};

// ---- Basic data → index rows ---------------------------------------------------------------

export type Status = "active" | "liquidation" | "bankrupt" | "deleted";
const STATUS: Record<string, Status> = { R: "active", L: "liquidation", N: "bankrupt", K: "deleted" };
export type RegRow = { code: string; name: string; form: string; status: Status; founded: string; street: string; place: string; postcode: string };
/** Legal forms that are never a client (apartment associations, state and municipal bodies, parties, unions). */
const NOT_LEADS = /^(korteriühistu|kohaliku omavalitsuse asutus|täidesaatva riigivõimu|avalik-õiguslik|erakond|ametiühing|maaparandusühistu|hooneühistu)/i;
const day = (v: string) => { const m = /^(\d{2})\.(\d{2})\.(\d{4})$/.exec(v.trim()); return m ? `${m[3]}-${m[2]}-${m[1]}` : ""; };

/** The basic-data CSV header → a row parser (by column name, so a reordered file still reads). null = not that file. */
export function basicParser(header: string[]): ((r: string[]) => RegRow | null) | null {
  const at = headerIndex(header);
  const c = { name: at("nimi"), code: at("ariregistri_kood"), form: at("ettevotja_oiguslik_vorm"), status: at("ettevotja_staatus"), founded: at("ettevotja_esmakande_kpv"),
    street: at("asukoht_ettevotja_aadressis"), place: at("asukoha_ehak_tekstina"), postcode: at("indeks_ettevotja_aadressis") };
  if (c.name < 0 || c.code < 0 || c.status < 0) return null;
  const get = (r: string[], i: number) => (i < 0 ? "" : (r[i] ?? "").trim());
  return (r) => {
    const code = get(r, c.code), form = get(r, c.form), status = STATUS[get(r, c.status)];
    if (!/^\d{8}$/.test(code) || !status || NOT_LEADS.test(form)) return null;
    return { code, name: get(r, c.name), form, status, founded: day(get(r, c.founded)), street: get(r, c.street), place: get(r, c.place), postcode: get(r, c.postcode) };
  };
}

/** Per company, from its latest annual report: main EMTAK code (with version), revenue and average staff (full-time equivalent). */
export type Figures = { emtak: string; emtakV: "2008" | "2025" | ""; revenue: number | null; staff: number | null; year: number };
export type IndexRow = RegRow & Partial<Figures>;

const clean = (s: string) => s.replace(/[\t\r\n]+/g, " ").trim();
const COLS = ["code", "name", "form", "status", "founded", "street", "place", "postcode", "emtak", "emtakV", "revenue", "staff", "year"] as const;
/** One index line (tab-separated, no personal data beyond what the public business name carries). */
export function encodeRow(r: IndexRow): string {
  return COLS.map((k) => { const v = r[k]; return v === undefined || v === null ? "" : clean(String(v)); }).join("\t");
}
export function decodeRow(line: string): IndexRow | null {
  const p = line.split("\t");
  if (p.length < 8 || !/^\d{8}$/.test(p[0]) || !(Object.values(STATUS) as string[]).includes(p[3])) return null;
  const num = (v: string | undefined) => (v === undefined || v === "" ? null : Number.isFinite(Number(v)) ? Number(v) : null);
  const r: IndexRow = { code: p[0], name: p[1], form: p[2], status: p[3] as Status, founded: p[4], street: p[5], place: p[6], postcode: p[7] };
  if (p[12]) Object.assign(r, { emtak: p[8] ?? "", emtakV: (p[9] === "2008" || p[9] === "2025" ? p[9] : "") as Figures["emtakV"], revenue: num(p[10]), staff: num(p[11]), year: Number(p[12]) || 0 });
  return r;
}

// ---- Annual-report files → figures -----------------------------------------------------------

/** "1. General information of reports": report id → company and year (only the years we keep). */
export function reportsParser(header: string[], years: Set<number>): ((r: string[]) => { id: string; code: string; year: number } | null) | null {
  const at = headerIndex(header), id = at("report_id"), code = at("registrikood"), year = at("aruandeaasta");
  if (id < 0 || code < 0 || year < 0) return null;
  return (r) => { const y = Number(r[year]); return years.has(y) && /^\d{8}$/.test(r[code]?.trim() ?? "") ? { id: r[id].trim(), code: r[code].trim(), year: y } : null; };
}
/** "2. Sales revenue by EMTAK": the main activity line of a report. */
export function emtakParser(header: string[]): ((r: string[]) => { id: string; emtak: string; v: Figures["emtakV"] } | null) | null {
  const at = headerIndex(header), id = at("report_id"), emtak = at("emtak"), main = at("põhitegevusala"), ver = at("emtak_version");
  if (id < 0 || emtak < 0 || main < 0) return null;
  return (r) => {
    if ((r[main] ?? "").trim().toLowerCase() !== "jah" || !/^\d{2,5}$/.test(r[emtak]?.trim() ?? "")) return null;
    const v = /2025/.test(r[ver] ?? "") ? "2025" : /2008/.test(r[ver] ?? "") ? "2008" : "";
    return { id: r[id].trim(), emtak: r[emtak].trim(), v };
  };
}
/** "4. Key indicators": revenue (TotalRevenue for non-profits) and average staff. */
export function figuresParser(header: string[]): ((r: string[]) => { id: string; what: "revenue" | "staff"; value: number } | null) | null {
  const at = headerIndex(header), id = at("report_id"), name = at("elemendi_nimetus"), val = at("vaartus");
  if (id < 0 || name < 0 || val < 0) return null;
  return (r) => {
    const n = (r[name] ?? "").trim(), what = n === "Revenue" || n === "TotalRevenue" ? "revenue" : n === "AverageNumberOfEmployeesInFullTimeEquivalentUnits" ? "staff" : null;
    const value = Number((r[val] ?? "").trim());
    return what && (r[val] ?? "").trim() !== "" && Number.isFinite(value) ? { id: r[id].trim(), what, value } : null;
  };
}

// ---- Names and places ----------------------------------------------------------------------

/** Lowercase, accents folded (õ ä ö ü š ž → o a o u s z), anything else → single spaces. */
export const fold = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const LEGAL = /\b(ou|osauhing|as|aktsiaselts|fie|mtu|mittetulundusuhing|tu|taisuhing|uu|usaldusuhing|sa|sihtasutus|tuh|tulundusuhistu|filiaal|ltd|llc|oy|ab|gmbh|sia|uab)\b/g;
/** The name without legal form words: "OÜ Kati Ilusalong" → "kati ilusalong". */
export const coreName = (s: string) => fold(s).replace(LEGAL, " ").replace(/\s+/g, " ").trim();
/** Words too common to find a business by on their own. */
const GENERIC = new Set(["salong", "salon", "pood", "kauplus", "kohvik", "cafe", "restoran", "baar", "studio", "stuudio", "grupp", "group", "teenused", "teenus", "eesti", "estonia", "tallinn", "tartu", "parnu", "ilu", "auto", "ehitus", "kodu", "service", "services", "shop", "the", "and", "ja"]);
/** Search words of a name (3+ letters, not generic). */
export const keyWords = (s: string) => [...new Set(coreName(s).split(" ").filter((w) => w.length >= 3 && !GENERIC.has(w)))];

function bigrams(s: string): Map<string, number> {
  const t = ` ${s} `, m = new Map<string, number>();
  for (let i = 0; i < t.length - 1; i++) { const b = t.slice(i, i + 2); m.set(b, (m.get(b) ?? 0) + 1); }
  return m;
}
/** Dice coefficient on letter pairs, 0..1. */
export function dice(a: string, b: string): number {
  if (!a || !b) return 0;
  if (a === b) return 1;
  const A = bigrams(a), B = bigrams(b);
  let both = 0, n = 0;
  for (const [k, v] of A) { both += Math.min(v, B.get(k) ?? 0); n += v; }
  for (const v of B.values()) n += v;
  return (2 * both) / n;
}
/** Name likeness 0..1: half letter pairs, half shared words (so word order doesn't matter). */
export function nameScore(a: string, b: string): number {
  const x = coreName(a), y = coreName(b);
  if (!x || !y) return 0;
  if (x === y) return 1;
  const wa = new Set(x.split(" ")), wb = new Set(y.split(" "));
  const shared = [...wa].filter((w) => wb.has(w)).length / Math.max(wa.size, wb.size);
  return 0.5 * dice(x, y) + 0.5 * shared;
}

export type Place = { city: string; street: string; postcode: string };
/** A lead's place from its notes ("City: Tartu", "Address: Turu tn 34, 51004, Tartu" from OSM / Maps). */
export function leadPlace(notes: string | null | undefined): Place {
  const n = notes ?? "";
  const city = /^City: (.+)$/m.exec(n)?.[1].trim() ?? "";
  const addr = /^Address: (.+)$/m.exec(n)?.[1].trim() ?? "";
  const parts = addr.split(",").map((x) => x.trim()).filter(Boolean);
  const postcode = parts.find((x) => /^\d{5}$/.test(x)) ?? /\b(\d{5})\b/.exec(addr)?.[1] ?? "";
  const street = parts.find((x) => /\p{L}/u.test(x) && /\d/.test(x) && !/^\d{5}$/.test(x)) ?? "";
  const cityFromAddr = parts.filter((x) => x !== street && x !== postcode && !/\d/.test(x)).at(-1) ?? "";
  return { city: city || cityFromAddr, street, postcode };
}
const PLACE_WORDS = /\b(linnaosa|linn|vald|alevik|alev|kula|maakond|parish|city|town|county|village)\b/g;
/** "Pirita linnaosa, Tallinn, Harju maakond" → ["pirita", "tallinn", "harju"]. */
export const placeParts = (s: string) => s.split(",").map((x) => fold(x).replace(PLACE_WORDS, " ").replace(/\s+/g, " ").trim()).filter(Boolean);
/** Street likeness: same street and house number 1, same street 0.5, else 0 (null = the lead has no street). */
export function streetScore(lead: string, reg: string): number | null {
  if (!lead.trim()) return null;
  const parse = (s: string) => { const f = fold(s).replace(/\b(tn|tanav|pst|puiestee|mnt|maantee|tee|plats|pk|street|st|road)\b/g, " ").replace(/\s+/g, " ").trim(); const no = /\b(\d+[a-z]?)\b/.exec(f)?.[1] ?? ""; return { name: f.replace(/\b\d.*$/, "").trim(), no }; };
  const a = parse(lead), b = parse(reg);
  if (!a.name || a.name !== b.name) return 0;
  return a.no && a.no === b.no ? 1 : 0.5;
}

// ---- The match ------------------------------------------------------------------------------

export const MATCH_AT = 80, OPTION_AT = 60, OPTION_NAME = 0.6, GAP = 10, NAME_MIN = 0.85, MAX_OPTIONS = 3;
export type Scored = { row: IndexRow; score: number; name: number; city: number | null; street: number | null };
/** 0..100: name 60 %, municipality 25 %, street 15 % (unknown street counts half). city null = the lead has no place. */
export function scoreOne(lead: { name: string; place: Place }, row: IndexRow): Scored {
  const name = nameScore(lead.name, row.name);
  const parts = placeParts(row.place), c = fold(lead.place.city).replace(PLACE_WORDS, " ").trim();
  const city = c ? (parts.includes(c) ? 1 : 0) : null;
  const st = streetScore(lead.place.street, row.street);
  const street = st === null ? (lead.place.postcode && lead.place.postcode === row.postcode ? 0.75 : null) : Math.max(st, lead.place.postcode && lead.place.postcode === row.postcode ? 0.5 : 0);
  const score = Math.round(100 * (0.6 * name + 0.25 * (city ?? 0) + 0.15 * (street ?? 0.5)));
  return { row, score, name, city, street };
}

export type Option = { code: string; name: string; place: string; score: number };
/** matched: one clear winner · ambiguous: close options he picks from (never guessed) · none · no-place: the lead has no city. */
export type Decision = { state: "matched"; best: Scored; options: Option[] } | { state: "ambiguous"; options: Option[] } | { state: "none" | "no-place"; options: Option[] };
const opt = (s: Scored): Option => ({ code: s.row.code, name: s.row.name, place: [s.row.street, s.row.place].filter(Boolean).join(", "), score: s.score });

/** A clear winner needs: score ≥ 80, a near-same name, the same municipality, and a 10-point lead over the runner-up.
 *  Options he can pick from: score ≥ 60 with a name at least 60 % alike. */
export function decide(lead: { name: string; place: Place }, rows: IndexRow[]): Decision {
  const all = rows.map((r) => scoreOne(lead, r)).sort((a, b) => b.score - a.score || a.row.code.localeCompare(b.row.code));
  const close = all.filter((s) => s.score >= OPTION_AT && s.name >= OPTION_NAME).slice(0, MAX_OPTIONS).map(opt);
  if (!lead.place.city.trim()) return { state: "no-place", options: all.filter((s) => s.name >= NAME_MIN).slice(0, MAX_OPTIONS).map(opt) };
  const [a, b] = all;
  if (a && a.score >= MATCH_AT && a.name >= NAME_MIN && a.city === 1 && (!b || a.score - b.score >= GAP)) return { state: "matched", best: a, options: [opt(a)] };
  return close.length ? { state: "ambiguous", options: close } : { state: "none", options: [] };
}

// ---- What the card shows ---------------------------------------------------------------------

export type Band = { en: string; et: string };
export type Info = {
  code: string; name: string; form: string; formShort: string; status: Status; founded: string;
  field: { code: string; en: string; et: string } | null; turnover: Band | null; staff: Band | null; year: number | null; link: string;
};
const FORMS: [RegExp, string][] = [[/^osaühing/i, "OÜ"], [/^aktsiaselts/i, "AS"], [/^füüsilisest isikust ettevõtja/i, "FIE"], [/^mittetulundusühing/i, "MTÜ"], [/^sihtasutus/i, "SA"],
  [/^täisühing/i, "TÜ"], [/^usaldusühing/i, "UÜ"], [/^tulundusühistu/i, "TÜH"], [/^välismaa äriühingu filiaal/i, "branch"], [/^euroopa äriühing/i, "SE"]];
export const shortForm = (form: string) => FORMS.find(([re]) => re.test(form))?.[1] ?? form;

// Field of activity from the EMTAK division (first two digits). EMTAK 2008 = NACE Rev. 2, EMTAK 2025 = NACE Rev. 2.1; they differ at 45 and 58–63.
type F = [number, number, string, string];
const FIELDS: F[] = [
  [1, 3, "Farming, forestry and fishing", "Põllumajandus, metsandus ja kalandus"], [5, 9, "Mining", "Mäetööstus"], [10, 33, "Manufacturing", "Tootmine"],
  [35, 35, "Energy supply", "Energiavarustus"], [36, 39, "Water and waste", "Vesi ja jäätmed"], [41, 43, "Construction", "Ehitus"],
  [45, 47, "Shops and trade", "Kaubandus"], [49, 53, "Transport and storage", "Veondus ja laondus"], [55, 56, "Accommodation and food", "Majutus ja toitlustus"],
  [58, 63, "Information and communication", "Info ja side"], [64, 66, "Finance and insurance", "Finants ja kindlustus"], [68, 68, "Real estate", "Kinnisvara"],
  [69, 75, "Professional services", "Erialane ja teaduslik tegevus"], [77, 82, "Office and support services", "Haldus- ja abitegevused"], [84, 84, "Public administration", "Avalik haldus"],
  [85, 85, "Education", "Haridus"], [86, 88, "Health and social care", "Tervishoid ja hoolekanne"], [90, 93, "Arts, sports and leisure", "Kunst, sport ja vaba aeg"],
  [94, 96, "Other services", "Muud teenused"], [97, 98, "Households as employers", "Kodumajapidamised tööandjana"], [99, 99, "International bodies", "Rahvusvahelised organisatsioonid"],
];
const FIELDS_2025: F[] = [[58, 60, "Publishing and media", "Kirjastamine ja meedia"], [61, 63, "Telecom and IT", "Side ja IT"]];
/** A few divisions small businesses often have, in plainer words than the section. */
const DIVISIONS: Record<string, [string, string]> = {
  "56": ["Restaurants and cafes", "Toitlustus"], "47": ["Shops", "Jaekaubandus"], "43": ["Building trades", "Ehitustööd"], "96": ["Personal services (hair, beauty and more)", "Isikuteenused (juuksur, ilu jm)"],
  "86": ["Health care", "Tervishoid"], "55": ["Accommodation", "Majutus"], "62": ["Software and IT", "Tarkvara ja IT"], "93": ["Sports and leisure", "Sport ja vaba aeg"], "45": ["Car sales and repair", "Autode müük ja remont"],
};
export function fieldOf(emtak: string | undefined, v: Figures["emtakV"] | undefined): Info["field"] {
  if (!emtak || !/^\d{2,5}$/.test(emtak)) return null;
  const d = Number(emtak.slice(0, 2)), div = DIVISIONS[emtak.slice(0, 2)];
  if (div && !(v === "2025" && d === 45)) return { code: emtak, en: div[0], et: div[1] };
  const hit = (v === "2025" ? FIELDS_2025.find(([a, b]) => d >= a && d <= b) : undefined) ?? FIELDS.find(([a, b]) => d >= a && d <= b);
  return hit ? { code: emtak, en: hit[2], et: hit[3] } : null;
}
/** Turnover band from the latest annual report (euros). */
export function turnoverBand(eur: number | null | undefined): Band | null {
  if (eur === null || eur === undefined || !Number.isFinite(eur) || eur < 0) return null;
  const B: [number, string, string][] = [[1, "no sales", "müügitulu pole"], [10_000, "under €10k", "alla 10 000 €"], [50_000, "€10k–50k", "10 000–50 000 €"], [200_000, "€50k–200k", "50 000–200 000 €"],
    [1_000_000, "€200k–1M", "200 000 €–1 mln €"], [10_000_000, "€1M–10M", "1–10 mln €"]];
  const b = B.find(([max]) => eur < max);
  return b ? { en: b[1], et: b[2] } : { en: "over €10M", et: "üle 10 mln €" };
}
/** Staff band from the average full-time-equivalent staff. */
export function staffBand(fte: number | null | undefined): Band | null {
  if (fte === null || fte === undefined || !Number.isFinite(fte) || fte < 0) return null;
  const n = Math.round(fte);
  if (n === 0) return { en: "no staff (owner only)", et: "töötajaid pole (ainult omanik)" };
  if (n === 1) return { en: "1 person", et: "1 inimene" };
  if (n <= 9) return { en: "2–9 people", et: "2–9 inimest" };
  if (n <= 49) return { en: "10–49 people", et: "10–49 inimest" };
  if (n <= 249) return { en: "50–249 people", et: "50–249 inimest" };
  return { en: "250+ people", et: "250+ inimest" };
}
/** An index row → what the lead card shows. */
export function toInfo(r: IndexRow): Info {
  return {
    code: r.code, name: r.name, form: r.form, formShort: shortForm(r.form), status: r.status, founded: r.founded,
    field: fieldOf(r.emtak, r.emtakV), turnover: r.year ? turnoverBand(r.revenue) : null, staff: r.year ? staffBand(r.staff) : null, year: r.year || null, link: companyUrl(r.code),
  };
}

/** How long they've been in business, in words (drafts may not carry digits). */
export function yearsActive(founded: string, today: string): string {
  const a = Date.parse(`${founded}T00:00:00Z`), b = Date.parse(`${today}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b) || b < a) return "";
  const y = (b - a) / (365.25 * 86_400_000);
  return y < 1 ? "less than a year" : y < 3 ? "a year or two" : y < 5 ? "a few years" : y < 10 ? "over five years" : y < 20 ? "over ten years" : "over twenty years";
}

/** The ONLY registry text that may go into a draft prompt: field of activity and years in business. Never names, never money. */
export function draftFacts(info: Pick<Info, "field" | "founded" | "status"> | null | undefined, today: string): string {
  if (!info || info.status !== "active") return "";
  const bits = [info.field && `field of activity: ${info.field.en.toLowerCase()}`, info.founded && yearsActive(info.founded, today) && `in business for ${yearsActive(info.founded, today)}`].filter(Boolean);
  return bits.length ? `Public registry facts (Estonian e-Business Register, use only if it helps, never quote numbers): ${bits.join("; ")}.` : "";
}
/** Why no first message should go to this business ("" = fine): the registry says it is closing or closed. */
export const closedProblem = (info: Pick<Info, "status"> | null | undefined) =>
  !info || info.status === "active" ? "" : `The registry says this business is ${info.status === "liquidation" ? "being wound up" : info.status === "bankrupt" ? "bankrupt" : "deleted"}: no pitch`;

// ---- The record kept on the lead (prospect-crm.json) ------------------------------------------

/** No personal data in here: the board lives in the separate people store, read only by the lead card. */
export type RegMatch = { state: "matched" | "picked" | "ambiguous" | "none" | "no-place" | "gone"; score: number; checkedAt: string; info?: Info; options?: Option[] };
export function toMatch(d: Decision, at: string): RegMatch {
  if (d.state === "matched") return { state: "matched", score: d.best.score, checkedAt: at, info: toInfo(d.best.row) };
  return { state: d.state, score: d.options[0]?.score ?? 0, checkedAt: at, ...(d.options.length && { options: d.options }) };
}
/** A matched or picked lead whose code is no longer in the open data (which lists only live entities) → deleted. */
export function refreshMatch(m: RegMatch, row: IndexRow | null, at: string): RegMatch {
  if (!row) return { ...m, state: "gone", checkedAt: at, ...(m.info && { info: { ...m.info, status: "deleted" as const } }) };
  return { ...m, state: m.state === "gone" ? "matched" : m.state, checkedAt: at, info: toInfo(row) };
}
export const isLinked = (m: RegMatch | undefined): m is RegMatch & { info: Info } => !!m?.info && (m.state === "matched" || m.state === "picked" || m.state === "gone");

// ---- Board members: personal data (GDPR) ---------------------------------------------------------

export type Person = { name: string; role: string; since: string };
type PersonEntry = { isiku_roll_tekstina?: unknown; eesnimi?: unknown; nimi_arinimi?: unknown; algus_kpv?: unknown; lopp_kpv?: unknown };
/** Current management-board members of one company object of the persons file. No ID codes, birth dates or addresses kept. */
export function boardOf(obj: unknown): { code: string; board: Person[] } | null {
  const o = obj as { ariregistri_kood?: unknown; kaardile_kantud_isikud?: unknown };
  const code = String(o?.ariregistri_kood ?? "");
  if (!/^\d{8}$/.test(code)) return null;
  const list = Array.isArray(o.kaardile_kantud_isikud) ? (o.kaardile_kantud_isikud as PersonEntry[]) : [];
  const board = list.filter((p) => typeof p?.isiku_roll_tekstina === "string" && /^juhatuse/i.test(p.isiku_roll_tekstina) && !p.lopp_kpv)
    .map((p) => ({ name: clean(`${typeof p.eesnimi === "string" ? p.eesnimi : ""} ${typeof p.nimi_arinimi === "string" ? p.nimi_arinimi : ""}`).slice(0, 120), role: String(p.isiku_roll_tekstina).slice(0, 60), since: day(String(p.algus_kpv ?? "")) }))
    .filter((p) => p.name);
  return { code, board };
}

/** Streams a JSON array of objects: feed text chunks, get back each top-level element's text (strings and escapes respected). */
export function arraySplitter(): (chunk: string) => string[] {
  let depth = 0, inStr = false, esc = false, buf = "";
  return (chunk) => {
    const out: string[] = [];
    let start = depth >= 1 ? 0 : -1;
    for (let i = 0; i < chunk.length; i++) {
      const c = chunk[i];
      if (inStr) { if (esc) esc = false; else if (c === "\\") esc = true; else if (c === '"') inStr = false; continue; }
      if (c === '"') { inStr = true; continue; }
      if (c === "{" || c === "[") { depth++; if (depth === 2) start = i; }
      else if (c === "}" || c === "]") {
        if (depth === 2 && start >= 0) { out.push(buf + chunk.slice(start, i + 1)); buf = ""; start = -1; }
        depth--;
      }
    }
    if (depth >= 2 && start >= 0) buf += chunk.slice(start);
    return out;
  };
}

/** Board-member names found in text that will go to a model or into a draft ([] = none). The lead's own business name is left out
 *  first: an FIE trades under the owner's own name, which is the public business name already in the pipeline. */
export function peopleIn(text: string, people: Person[], ownName = ""): string[] {
  let t = ` ${fold(text)} `;
  const own = fold(ownName);
  if (own) t = t.split(` ${own} `).join("  ");
  return people.filter((p) => {
    const w = fold(p.name).split(" ").filter(Boolean);
    if (!w.length) return false;
    const orders = [w.join(" "), [...w.slice(1), w[0]].join(" "), w.length > 1 ? `${w[0]} ${w.at(-1)}` : ""].filter(Boolean);
    return orders.some((o) => t.includes(` ${o} `));
  }).map((p) => p.name);
}
export const PEOPLE_REFUSAL = "This text has a board member's name from the registry. Personal names never go to the AI: take the name out of the notes or draft first.";

// ---- Progress (shared ProgressCard) --------------------------------------------------------------

export type RunState = {
  on: boolean;                 // weekly refresh: on after his first "Get registry data" click
  stage: number;               // index into STAGES while running; -1 idle
  startedAt: string | null; finishedAt: string | null; error: string;
  companies: number; checked: number; matched: number; ambiguous: number; none: number;
  files: Record<string, string>; // file url → Last-Modified seen (annual-report files are re-read only when they change)
};
export const IDLE: RunState = { on: false, stage: -1, startedAt: null, finishedAt: null, error: "", companies: 0, checked: 0, matched: 0, ambiguous: 0, none: 0, files: {} };
export const STAGES = { en: ["Download the registry files", "Read the annual reports", "Build the local index", "Match your leads", "Look up board members"],
  et: ["Laadin registri failid", "Loen majandusaasta aruanded", "Teen kohaliku indeksi", "Sobitan sinu müügivihjed", "Vaatan juhatuse liikmed"] } as const;
export const TYPICAL_MS = 6 * 60_000;

/** Weekly: due when on and the last finished run is 7+ days old (or never finished). */
export function refreshDue(s: Pick<RunState, "on" | "finishedAt" | "stage">, now: number): boolean {
  if (!s.on || s.stage >= 0) return false;
  const last = Date.parse(s.finishedAt ?? "");
  return !Number.isFinite(last) || now - last >= REFRESH_DAYS * 86_400_000;
}

/** The plain result line. */
export function resultLine(s: Pick<RunState, "checked" | "matched" | "ambiguous" | "none">, lang: "en" | "et"): string {
  if (!s.checked) return lang === "et" ? "Indeks on valmis. Müügivihjeid pole veel." : "The index is ready. No leads to check yet.";
  return lang === "et"
    ? `Kontrollisin ${s.checked}: leidsin ${s.matched}, ${s.ambiguous} vajab sinu valikut, ${s.none} ei leidnud.`
    : `Checked ${s.checked}: found ${s.matched}, ${s.ambiguous} need${s.ambiguous === 1 ? "s" : ""} your pick, ${s.none} not found.`;
}
