// AI playtesters (pure, tested in tests/playtesters.test.ts). IO: playtesters.ts (night slot "playtesters" + /api/playtesters),
// UI: AiPlaytesters.tsx (the shared "Working on it" card + heatmap + bug list + fixes to approve).
// Six testers (grinder, casual, spender, explorer, bug hunter, new player) each play one look-only Studio playtest through the
// existing bridge (roblox.ts runPlaytest: start play, walk, look, read the console, stop). The bridge can't press keys, click or run
// code (denied by design), so what they MEASURE is: where they walked and got stuck, the leaderstats they read after each walk,
// the items under their player, and console errors. Numbers count only when ORBIT finds them in the raw inspect_instance output
// itself (never on the model's word). The owner's Rojo source (his own game only) is checked for RemoteEvents that accept bad input
// and for where each currency is earned and spent. Fixes are proposals: nothing changes until he clicks Approve, and then only through
// rojo.ts writeScript (Selene check, git snapshot, undoable). Nothing is published.
import { fromStages, type Progress } from "./progress-pure.ts";
import type { Lang } from "./i18n-pure.ts";

// ---- Testers -------------------------------------------------------------------

export type Tester = { id: string; name: string; type: string; goal: string };
/** Goals stay under 200 chars (the bridge's goal limit). */
export const SQUAD: Tester[] = [
  { id: "grinder", name: "Gus", type: "Grinder", goal: "As a grinder: walk to every coin/earn spot near spawn, one after another. Read leaderstats after each walk to see how fast coins grow." },
  { id: "casual", name: "Cass", type: "Casual", goal: "As a 10-minute casual player: walk to the nearest egg or fun spot from spawn. Is something fun close by? Read leaderstats after each walk." },
  { id: "spender", name: "Max", type: "Spender", goal: "As a spender: walk to the shop, eggs and any buy pads. List prices you can read. Read leaderstats after each walk to spot coins going down." },
  { id: "explorer", name: "Eli", type: "Explorer", goal: "As an explorer: walk to the far corners and edges of the map and every zone gate. Note where walking fails or you get stuck." },
  { id: "bughunter", name: "Bo", type: "Bug hunter", goal: "As a bug hunter: walk into tight corners, behind walls, onto edges and gaps. Watch for falling through, getting stuck and console errors." },
  { id: "new", name: "Nora", type: "New player", goal: "As a brand-new player: from spawn, walk to what the first screen points at. Is the first goal clear and close? Read leaderstats after." },
];

/** Extra prompt for a telemetry playtest: what to sample and how to report it (added to the bridge's own playtest prompt). */
export function telemetryPrompt(): string {
  return [
    "TELEMETRY (same tool limits): after starting play, find your own player's leaderstats folder (Players.<you>.leaderstats) and your character's HumanoidRootPart with search_game_tree.",
    "After start and after EVERY character_navigation, call inspect_instance on the leaderstats folder (or each value in it) and on HumanoidRootPart once, so each step has its numbers and position.",
    "Also inspect_instance the folder under your player that holds pets or items (if there is one) once at the end.",
    "Add these keys to the final JSON line: \"samples\": [{\"step\": 0, \"x\": 0, \"z\": 0, \"zone\": \"<nearest named part or area>\", \"stats\": {\"Coins\": 0}}], "
      + "\"stuck\": [{\"step\": 2, \"x\": 0, \"z\": 0, \"what\": \"<the walk that failed or left you in place>\"}], \"items\": [\"<unique id or name of each pet/item instance>\"], "
      + "\"steps\": [\"<what you did, plainly, e.g. Walk to Workspace.Eggs.Basic>\"]. step 0 = right after spawn. Copy numbers exactly as the tool showed them; leave out anything you didn't read.",
  ].join("\n");
}

// ---- Parsing a run ---------------------------------------------------------------

export type Sample = { step: number; x: number | null; z: number | null; zone: string; stats: Record<string, number>; verified: boolean };
export type Stuck = { step: number; x: number | null; z: number | null; what: string };
export type Telemetry = { samples: Sample[]; stuck: Stuck[]; items: string[]; steps: string[] };
export const MAX_SAMPLES = 20, MAX_STEPS = 30, MAX_ITEMS = 300;

// eslint-disable-next-line no-control-regex
const clean = (v: unknown, n: number) => (typeof v === "string" ? v.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, n) : "");
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
const statName = /^[A-Za-z][\w ]{0,23}$/;

function lastJson(text: string): Record<string, unknown> | null {
  for (const l of text.split("\n").reverse()) {
    const s = l.trim().replace(/^`+(json)?|`+$/g, "").trim();
    if (!s.startsWith("{")) continue;
    try { const o = JSON.parse(s); if (o && typeof o === "object" && !Array.isArray(o)) return o; } catch { /* keep looking */ }
  }
  return null;
}

/** A number counts as read when it appears in the raw tool output as itself (also with , or space thousands separators). */
export function seenIn(raw: string, n: number): boolean {
  if (!raw) return false;
  const plain = String(n), forms = [plain];
  if (Number.isInteger(n) && Math.abs(n) >= 1000) { const g = Math.abs(n).toLocaleString("en-US"); forms.push((n < 0 ? "-" : "") + g, (n < 0 ? "-" : "") + g.replace(/,/g, " ")); }
  return forms.some((f) => new RegExp(`(^|[^\\d.])${f.replace(/[.*+?^${}()|[\]\\-]/g, "\\$&")}(?![\\d])`).test(raw));
}

/** The telemetry keys of the bot's last JSON line, strictly; stats are verified against the raw inspect_instance output. */
export function parseTelemetry(text: string, rawInspect: string): Telemetry {
  const j = lastJson(text) ?? {};
  const samples: Sample[] = [];
  for (const r of (Array.isArray(j.samples) ? j.samples : []).slice(0, MAX_SAMPLES * 2)) {
    const o = (r && typeof r === "object" ? r : {}) as Record<string, unknown>, step = num(o.step);
    if (step === null || step < 0 || !Number.isInteger(step)) continue;
    const stats: Record<string, number> = {};
    let verified = true, any = false;
    for (const [k, v] of Object.entries((o.stats && typeof o.stats === "object" ? o.stats : {}) as Record<string, unknown>).slice(0, 8)) {
      const n = num(v);
      if (n === null || !statName.test(k)) continue;
      stats[k] = n; any = true;
      if (!seenIn(rawInspect, n)) verified = false;
    }
    samples.push({ step, x: num(o.x), z: num(o.z), zone: clean(o.zone, 60), stats, verified: any && verified });
    if (samples.length >= MAX_SAMPLES) break;
  }
  samples.sort((a, b) => a.step - b.step);
  const stuck: Stuck[] = (Array.isArray(j.stuck) ? j.stuck : []).slice(0, 10).map((r) => {
    const o = (r && typeof r === "object" ? r : {}) as Record<string, unknown>;
    return { step: num(o.step) ?? -1, x: num(o.x), z: num(o.z), what: clean(o.what, 140) };
  }).filter((s) => s.what);
  const items = (Array.isArray(j.items) ? j.items : []).slice(0, MAX_ITEMS).map((x) => clean(x, 80)).filter(Boolean);
  const steps = (Array.isArray(j.steps) ? j.steps : []).slice(0, MAX_STEPS).map((x) => clean(x, 140)).filter(Boolean);
  return { samples, stuck: [...stuck, ...stillStuck(samples, stuck)], items, steps };
}

/** Two samples in a row at (almost) the same spot after a walk = stuck, unless the bot already said so for that step. */
function stillStuck(samples: Sample[], told: Stuck[]): Stuck[] {
  const out: Stuck[] = [];
  for (let i = 1; i < samples.length; i++) {
    const a = samples[i - 1], b = samples[i];
    if (a.x === null || a.z === null || b.x === null || b.z === null) continue;
    if (Math.hypot(a.x - b.x, a.z - b.z) < 2 && !told.some((s) => s.step === b.step)) out.push({ step: b.step, x: b.x, z: b.z, what: `Didn't move after a walk (step ${b.step})` });
  }
  return out;
}

export type Run = { tester: string; done: boolean; findings: { title: string; severity: "low" | "med" | "high"; evidence: string }[]; consoleErrors: string[]; notes: string; tel: Telemetry; error?: string };

// ---- Economy: measured flow + where the code earns and spends ---------------------

export type Flow = { currency: string; earned: number; spent: number; perStep: number; verifiedSamples: number };
/** Per currency over all runs, from verified samples only: rises count as earned, drops as spent. */
export function currencyFlow(runs: Run[]): Flow[] {
  const m = new Map<string, Flow & { steps: number }>();
  for (const r of runs) {
    const s = r.tel.samples.filter((x) => x.verified);
    for (let i = 1; i < s.length; i++) for (const [k, v] of Object.entries(s[i].stats)) {
      const prev = s[i - 1].stats[k];
      if (prev === undefined) continue;
      const f = m.get(k) ?? { currency: k, earned: 0, spent: 0, perStep: 0, verifiedSamples: 0, steps: 0 };
      if (v > prev) f.earned += v - prev; else if (v >= 0) f.spent += prev - v;
      f.steps += s[i].step - s[i - 1].step || 1;
      m.set(k, f);
    }
    for (const x of s) for (const k of Object.keys(x.stats)) { const f = m.get(k); if (f) f.verifiedSamples++; }
  }
  return [...m.values()].map(({ steps, ...f }) => ({ ...f, perStep: steps ? Math.round(((f.earned - f.spent) / steps) * 10) / 10 : 0 })).sort((a, b) => b.earned - a.earned);
}

export type Curve = { tester: string; currency: string; points: { step: number; value: number }[] };
/** Each tester's main currency over its steps (verified samples only): the progression curve. */
export function curves(runs: Run[]): Curve[] {
  return runs.flatMap((r) => {
    const s = r.tel.samples.filter((x) => x.verified), counts = new Map<string, number>();
    for (const x of s) for (const k of Object.keys(x.stats)) counts.set(k, (counts.get(k) ?? 0) + 1);
    const cur = [...counts].sort((a, b) => b[1] - a[1])[0]?.[0];
    if (!cur) return [];
    return [{ tester: r.tester, currency: cur, points: s.filter((x) => cur in x.stats).map((x) => ({ step: x.step, value: x.stats[cur] })) }];
  });
}

export type Spot = { file: string; line: number; text: string };
export type EconomyMap = { currency: string; earn: Spot[]; spend: Spot[] }[];
const LEADERSTAT = /\.Name\s*=\s*"([A-Za-z][\w ]{0,23})"/;
const CLIENT_SCRIPT = /(?:^|[\\/])(?:StarterPlayerScripts|StarterCharacterScripts|StarterGui|ReplicatedFirst)(?:[\\/]|$)|\.client\.luau?$|LocalScript/i;
const isClientScript = (file: string) => CLIENT_SCRIPT.test(file);

/** Where the code earns (+) and spends (-) each leaderstats currency: a faucet/sink map from his Rojo source. */
export function economyMap(files: { file: string; text: string }[]): EconomyMap {
  const serverFiles = files.filter((f) => !isClientScript(f.file));
  const names = new Set<string>();
  for (const f of serverFiles) {
    if (!/leaderstats/.test(f.text)) continue;
    for (const l of f.text.split("\n")) { const m = LEADERSTAT.exec(l); if (m && /Value|Name/.test(l)) names.add(m[1]); }
  }
  const all = serverFiles.map((f) => f.text).join("\n");
  return [...names].filter((c) => new RegExp(`\\b${esc(c)}\\.Value\\b`).test(all)).slice(0, 6).map((c) => {
    const earn: Spot[] = [], spend: Spot[] = [], e = esc(c);
    const plus = new RegExp(`\\b${e}\\.Value\\s*(\\+=|=\\s*[^\\n]*\\b${e}\\.Value\\s*\\+)`), minus = new RegExp(`\\b${e}\\.Value\\s*(-=|=\\s*[^\\n]*\\b${e}\\.Value\\s*-)`);
    for (const f of serverFiles) f.text.split("\n").forEach((l, i) => {
      const spot = { file: f.file, line: i + 1, text: l.trim().slice(0, 160) };
      if (plus.test(l)) earn.push(spot); else if (minus.test(l)) spend.push(spot);
    });
    return { currency: c, earn: earn.slice(0, 20), spend: spend.slice(0, 20) };
  });
}
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// ---- Exploit signs ----------------------------------------------------------------

export type Sev = "high" | "med" | "low";
export type Bug = { id: string; title: string; severity: Sev; kind: "error" | "stuck" | "exploit" | "seen" | "code"; source: "seen" | "code"; who: string[]; repro: string[]; evidence: string };
export const JUMP_MIN = 10_000, JUMP_X = 50;

const name = (id: string) => SQUAD.find((t) => t.id === id)?.name ?? id;
const play = (place: string) => `Open ${place || "the place"} in Roblox Studio and press Play.`;
const stepsTo = (r: Run, step: number) => r.tel.steps.slice(0, Math.max(0, step)).map((s) => `${s}.`);

/** Negative balances, impossible jumps and duplicate items, from what the testers really read. */
export function exploitSigns(runs: Run[], place: string): Bug[] {
  const out: Bug[] = [];
  for (const r of runs) {
    const s = r.tel.samples.filter((x) => x.verified);
    s.forEach((x, i) => {
      for (const [k, v] of Object.entries(x.stats)) {
        if (v < 0) out.push({ id: `neg:${k}`, title: `${k} went below zero (${v})`, severity: "high", kind: "exploit", source: "seen", who: [r.tester],
          repro: [play(place), ...stepsTo(r, x.step), `Look at leaderstats: ${k} shows ${v}.`], evidence: `${name(r.tester)} read ${k} = ${v} at step ${x.step}${x.zone ? ` near ${x.zone}` : ""}.` });
        const p = i ? s[i - 1].stats[k] : undefined;
        if (p !== undefined && v - p >= JUMP_MIN && v >= Math.max(1, Math.abs(p)) * JUMP_X) out.push({ id: `jump:${k}`, title: `${k} jumped from ${p} to ${v} in one step`, severity: "med", kind: "exploit", source: "seen", who: [r.tester],
          repro: [play(place), ...stepsTo(r, x.step), `Compare ${k} before and after the last walk.`], evidence: `${name(r.tester)}: step ${s[i - 1].step} ${k} = ${p}, step ${x.step} = ${v}.` });
      }
    });
    const seen = new Set<string>(), dupes = new Set<string>();
    for (const it of r.tel.items) (seen.has(it) ? dupes : seen).add(it);
    if (dupes.size) out.push({ id: `dupe:${[...dupes][0]}`, title: `Same item id twice in one inventory (${[...dupes].slice(0, 3).join(", ")})`, severity: "high", kind: "exploit", source: "seen", who: [r.tester],
      repro: [play(place), ...r.tel.steps.map((x) => `${x}.`), "Open your player's pets/items folder in the Explorer and look for the same id twice."], evidence: `${dupes.size} duplicate id(s) under ${name(r.tester)}'s player.` });
  }
  return merge(out);
}

// ---- RemoteEvents that accept bad input (static, his own Rojo source) ------------------

export type RemoteKind = "unchecked" | "partial-check" | "table-mutation" | "payload-field" | "async-race" | "no-ratelimit";
export type Remote = { file: string; line: number; remote: string; param: string; why: string; severity: Sev; handlerIndent: string; bodyIndent: string; kind?: RemoteKind; playerParam?: string };
const HANDLER = /([\w.:()"'[\]]+?)\s*(?:\.OnServerEvent\s*:\s*Connect\s*\(\s*(?:function\s*\(([^)]*)\)|([A-Za-z_]\w*)\s*\))|\.OnServerInvoke\s*=\s*(?:function\s*\(([^)]*)\)|([A-Za-z_]\w*)))/;
const ECON_FIELD = "(?:Coins?|Cash|Money|Gems?|Gold|Tokens?|Credits?|Currency|Balance|Points?|XP|Exp|Diamonds?|Crystals?|Bucks|Stars|Tickets|Shards|Souls|Wins|Rebirths?|Inventory|Items|Pets|Stock)";
const VALUE_MUTATION = /\.Value\s*(?:[-+*/]=|=[^\n]*[-+*/])/;
const TABLE_MUTATION = new RegExp(`\\b[A-Za-z_]\\w*(?:\\.[A-Za-z_]\\w*)*\\.${ECON_FIELD}\\b(?:\\s*\\[[^\\]]+\\])?\\s*(?:[-+*/]=|=)`);
const INVENTORY_MUTATION = /\btable\.(?:insert|remove)\s*\(/;
const REWARD_ACTION = /\b(?:Grant|Give|Award|AddCoins|AddCash|AddGems|AddGold|AddMoney|Purchase|BuyItem|Craft|Forge|Hatch|Claim|Collect|Trade)\s*\(/i;
const REWARD_REMOTE = /(?:Click|Tap|Forge|Craft|Buy|Purchase|Sell|Claim|Collect|Reward|Gift|Spin|Hatch|Roll|Open|Drop|Mine|Swing|Farm|Harvest|AddCoins|GiveCoins|Earn|Trade)/i;
const NUMERIC_USE = (p: string) => new RegExp(`\\.Value\\s*(?:[-+*/]=|=)[^\\n]*\\b${esc(p)}(?![\\w.])|\\b${esc(p)}(?![\\w.])[^\\n]*(?:[-+*/])[^\\n]*\\.Value|\\.Value\\s*[-+*/]\\s*${esc(p)}(?![\\w.])`);
const TABLE_NUMERIC_USE = (p: string) => new RegExp(`\\b[A-Za-z_]\\w*(?:\\.[A-Za-z_]\\w*)*\\.${ECON_FIELD}\\b(?:\\s*\\[[^\\]]+\\])?\\s*(?:[-+*/]=|=)[^\\n]*\\b${esc(p)}(?![\\w.])|\\b${esc(p)}(?![\\w.])[^\\n]*[-+*/][^\\n]*\\.${ECON_FIELD}\\b`);
const ASYNC_YIELD = /\b(?:task\.wait|wait)\s*\(|:(?:UpdateAsync|SetAsync)\s*\(/;
const HAS_RATELIMIT = /\bos\.clock\s*\(|\btick\s*\(|\btime\s*\(|\bos\.time\s*\(|\b(?:cooldown|cooldowns|debounce|debounces|lastClick|lastAction|lastFire|lastCall|lastUse|lastTime|rateLimit|rateLimiter|throttle|busy|inFlight|in_flight|locks?)\b/i;
const SKIP_PROP = /^(?:Name|Parent|UserId|ClassName|Character|Team|DisplayName)$/;
const PAYLOAD_NUM_FIELD = /^(?:qty|quantity|amount|count|price|cost|coins?|cash|gems?|gold|value|num|number|bet|wager|bid|total|mult|multiplier|level|tier|slots?)$/i;
const indentOf = (l: string) => /^\s*/.exec(l)![0];
const stripComments = (s: string) => s.replace(/--\[\[[\s\S]*?\]\]/g, "").replace(/--[^\n]*/g, "");

/** Body lines of a handler: until the `end` (or `end)`) at the handler's own indent (StyLua-formatted code). */
function bodyOf(lines: string[], start: number): { body: string[]; indent: string } {
  const ind = indentOf(lines[start]), body: string[] = [];
  for (let i = start + 1; i < lines.length && body.length < 200; i++) {
    const l = lines[i];
    if (l.trim() && indentOf(l).length <= ind.length && /^\s*end\b/.test(l)) break;
    body.push(l);
  }
  return { body, indent: body.find((l) => l.trim()) ? indentOf(body.find((l) => l.trim())!) : `${ind}\t` };
}

function aliasesOf(expr: string, code: string): string[] {
  const names = [expr];
  const re = new RegExp(`\\blocal\\s+([A-Za-z_]\\w*)\\s*=\\s*${esc(expr)}(?:\\s|$|[^\\w.])`, "g");
  for (const m of code.matchAll(re)) if (!names.includes(m[1])) names.push(m[1]);
  return names;
}

function numericUse(expr: string, code: string, mutatesEcon: boolean): { used: boolean; viaTable: boolean } {
  const vars = aliasesOf(expr, code);
  if (vars.some((v) => TABLE_NUMERIC_USE(v).test(code))) return { used: true, viaTable: true };
  if (vars.some((v) => NUMERIC_USE(v).test(code))) return { used: true, viaTable: false };
  if (mutatesEcon) {
    const inMath = vars.some((v) => new RegExp(`(?:[-+*/]\\s*${esc(v)}(?![\\w.])|\\b${esc(v)}(?![\\w.])\\s*[-+*/]|for\\s+[A-Za-z_]\\w*\\s*=\\s*[^,\\n]+,\\s*${esc(v)}(?![\\w.]))`).test(code));
    if (inMath) return { used: true, viaTable: TABLE_MUTATION.test(code) };
  }
  return { used: false, viaTable: false };
}

function checkNumericValidation(expr: string, code: string): { hasType: boolean; missing: string[] } {
  const vars = aliasesOf(expr, code);
  const hasType = vars.some((v) => new RegExp(`(?:typeof|type)\\s*\\(\\s*${esc(v)}\\s*\\)|\\btonumber\\s*\\(\\s*${esc(v)}\\s*\\)`).test(code));
  const hasNaN = vars.some((v) => new RegExp(`\\b${esc(v)}\\s*(?:~=|==)\\s*${esc(v)}\\b|math\\.isnan\\s*\\(\\s*${esc(v)}\\s*\\)|math\\.floor\\s*\\(\\s*${esc(v)}\\s*\\)\\s*(?:~=|==)\\s*${esc(v)}\\b|\\b${esc(v)}\\s*%\\s*1\\s*(?:==|~=)\\s*0\\b`).test(code));
  const hasInf = vars.some((v) => new RegExp(`(?:math\\.abs\\s*\\(\\s*${esc(v)}\\s*\\)|\\b${esc(v)})\\s*(?:==|~=|>=|>|<|<=)\\s*math\\.huge|math\\.huge\\s*(?:==|~=|>=|>|<|<=)\\s*(?:math\\.abs\\s*\\(\\s*${esc(v)}\\s*\\)|${esc(v)}\\b)|math\\.clamp\\s*\\(\\s*${esc(v)}\\b|\\b${esc(v)}\\s*(?:>|>=|<|<=)\\s*(?:[1-9]\\d+(?:_\\d+)*(?:e\\d+)?|1e\\d+|[A-Z_]*MAX[A-Z0-9_]*|[A-Z_]*LIMIT[A-Z0-9_]*)\\b`).test(code));
  const hasRange = vars.some((v) => new RegExp(`\\b${esc(v)}\\s*(?:<|<=|>|>=)\\s*(?:0|1)\\b|\\b(?:0|1)\\s*(?:<|<=|>|>=)\\s*${esc(v)}\\b|math\\.clamp\\s*\\(\\s*${esc(v)}\\b`).test(code));
  const missing: string[] = [];
  if (!hasNaN) missing.push("NaN");
  if (!hasInf) missing.push("infinity");
  if (!hasRange) missing.push("range");
  return { hasType, missing };
}

/** Server handlers whose client-sent values, table mutations, async yields, or unthrottled actions expose exploits. */
export function auditRemotes(files: { file: string; text: string }[]): Remote[] {
  const out: Remote[] = [];
  for (const f of files) {
    if (isClientScript(f.file) || !/OnServer(Event|Invoke)/.test(f.text)) continue;
    const lines = f.text.split("\n");
    lines.forEach((l, i) => {
      const m = HANDLER.exec(l);
      if (!m) return;
      const remote = m[1].replace(/:WaitForChild\(["']([^"']+)["']\)/g, ".$1").split(".").pop()!.replace(/[^\w]/g, "") || "remote";
      let params = m[2] ?? m[4], at = i;
      const named = m[3] ?? m[5];
      if (params === undefined && named) { // :Connect(onBuy) → local function onBuy(player, …)
        at = lines.findIndex((x) => new RegExp(`function\\s+${esc(named)}\\s*\\(`).test(x));
        if (at < 0) return;
        params = /\(([^)]*)\)/.exec(lines[at])![1];
      }
      const rawPs = (params ?? "").replace(/\{[^}]*\}/g, "").split(",").map((p) => p.replace(/:.*$/, "").trim()).filter((p) => /^[A-Za-z_]\w*$/.test(p));
      const playerParam = rawPs[0] ?? "player";
      const ps = rawPs.slice(m[4] !== undefined || m[2] !== undefined || named ? 1 : 0);
      const { body, indent } = bodyOf(lines, at), text = body.join("\n"), code = stripComments(text);
      const handlerIndent = indentOf(lines[at]);
      const mutatesEcon = VALUE_MUTATION.test(code) || TABLE_MUTATION.test(code) || INVENTORY_MUTATION.test(code) || REWARD_ACTION.test(code);

      // Classes A, B, C, D1: direct client params & table payload fields (e.g. payload.qty)
      const candidates: { expr: string; isField: boolean }[] = [];
      for (const p of ps) {
        candidates.push({ expr: p, isField: false });
        const fieldRe = new RegExp(`\\b${esc(p)}\\.([A-Za-z_]\\w*)`, "g");
        const seenFields = new Set<string>();
        for (const fm of code.matchAll(fieldRe)) {
          const fld = fm[1];
          if (SKIP_PROP.test(fld) || seenFields.has(fld)) continue;
          seenFields.add(fld);
          candidates.push({ expr: `${p}.${fld}`, isField: true });
        }
      }

      for (const { expr, isField } of candidates) {
        const use = numericUse(expr, code, mutatesEcon);
        const fieldName = isField ? expr.split(".")[1] : "";
        const payloadNumeric = isField && PAYLOAD_NUM_FIELD.test(fieldName) && (mutatesEcon || /[-+*/<>=]/.test(code));
        if (!use.used && !payloadNumeric) continue;

        const { hasType, missing } = checkNumericValidation(expr, code);
        if (!hasType) {
          const kind: RemoteKind = isField ? "payload-field" : use.viaTable ? "table-mutation" : "unchecked";
          const target = isField ? `table payload field "${expr}"` : use.viaTable ? `"${expr}" into player data/currency table` : `"${expr}" from the client into a value`;
          out.push({ file: f.file, line: at + 1, remote, param: expr, severity: "high", handlerIndent, bodyIndent: indent, kind, playerParam,
            why: `${remote} uses ${target} without checking it is a finite positive number. A cheater could send -1e9, math.huge or NaN.` });
        } else if (missing.length > 0) {
          out.push({ file: f.file, line: at + 1, remote, param: expr, severity: "high", handlerIndent, bodyIndent: indent, kind: "partial-check", playerParam,
            why: `${remote} checks typeof(${expr}) == "number" but is missing ${missing.join("/")} validation (NaN, math.huge, or negative/zero bypass).` });
        }
      }

      // Class D2: async duplication race (yield before deduction or without per-player lock)
      if (mutatesEcon && ASYNC_YIELD.test(code)) {
        const lockRe = new RegExp(`\\b(?:busy|inFlight|in_flight|debounce|debounces|lock|locks|locked|processing|pending|active|inProgress|mutex)\\s*\\[\\s*(?:${esc(playerParam)}(?:\\.UserId)?|userId|uid)\\s*\\]`, "i");
        if (!lockRe.test(code)) {
          out.push({ file: f.file, line: at + 1, remote, param: "async-race", severity: "high", handlerIndent, bodyIndent: indent, kind: "async-race", playerParam,
            why: `${remote} yields (task.wait/wait/UpdateAsync/SetAsync) while mutating currency/inventory without a per-player lock (e.g. busy[player]), allowing async duplication.` });
        }
      }

      // Class E: missing rate-limit / throttle on economy/reward/click/purchase handlers
      if ((mutatesEcon || REWARD_REMOTE.test(remote)) && !HAS_RATELIMIT.test(code)) {
        out.push({ file: f.file, line: at + 1, remote, param: "rate-limit", severity: "med", handlerIndent, bodyIndent: indent, kind: "no-ratelimit", playerParam,
          why: `${remote} mutates currency or grants rewards without a per-player cooldown/rate-limit (os.clock/tick/debounce), allowing rapid-fire spam.` });
      }
    });
  }
  return out.slice(0, 30);
}

export const remoteBugs = (rs: Remote[]): Bug[] => rs.map((r) => {
  const title = r.kind === "async-race" ? `${r.remote} has an async duplication race`
    : r.kind === "no-ratelimit" ? `${r.remote} has no rate limit`
    : r.kind === "partial-check" ? `${r.remote} has incomplete number check on "${r.param}"`
    : `${r.remote} trusts "${r.param}" from the client`;
  const repro = r.kind === "async-race"
    ? ["In Studio: Test → Clients and Servers (1 player), then Start.", `Fire "${r.remote}" twice in rapid succession from the client command bar before the yield finishes.`, "In the server window, check whether currency/items duplicated."]
    : r.kind === "no-ratelimit"
    ? ["In Studio: Test → Clients and Servers (1 player), then Start.", `In a tight loop in the client command bar, fire "${r.remote}" 50 times in one frame.`, "In the server window, check whether currency/rewards grew every call."]
    : ["In Studio: Test → Clients and Servers (1 player), then Start.", `In the client window's command bar, find the RemoteEvent named "${r.remote}" and fire it with ${r.param} = -1e9, e.g. game:GetService("ReplicatedStorage"):FindFirstChild("${r.remote}", true):FireServer(-1e9) (put -1e9 in ${r.param}'s place if it isn't the first value).`,
      "In the server window, look at the player's leaderstats.", "Expected: nothing changes. If the number moved, a cheater can do the same."];
  return { id: `remote:${r.file}:${r.line}:${r.param}`, title, severity: r.severity, kind: "code", source: "code", who: [], repro, evidence: `${r.file} line ${r.line}: ${r.why}` };
});

// ---- Proposals (Rojo file edits he approves) ---------------------------------------------

export type Proposal = { id: string; file: string; line: number; title: string; why: string; before: string; after: string; hash: string; status: "pending" | "applied" | "dismissed"; note?: string };
export const GUARD_MAX = 1_000_000;
export const GUARD_TAG = "-- ORBIT playtesters: ignore bad input from the client";

/** FNV-1a of the file text: a proposal is only applied to exactly the text it was made from. */
export function hashText(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h.toString(16).padStart(8, "0");
}

/** One guard line right after the handler's first line, per flagged param: reject non-numbers, NaN, infinity, non-positive and huge values; plus cooldown when unthrottled. */
export function guardProposals(files: { file: string; text: string }[], rs: Remote[]): Proposal[] {
  const byFile = new Map<string, Remote[]>();
  for (const r of rs) byFile.set(r.file, [...(byFile.get(r.file) ?? []), r]);
  const out: Proposal[] = [];
  for (const [file, list] of byFile) {
    const f = files.find((x) => x.file === file);
    if (!f) continue;
    const lines = f.text.split("\n"), handlers = [...new Set(list.map((r) => r.line))].sort((a, b) => b - a); // bottom-up keeps line numbers valid
    let needsCooldownTable = false;
    for (const at of handlers) {
      const group = list.filter((r) => r.line === at), ind = group[0].bodyIndent;
      if (lines[at]?.includes(GUARD_TAG)) continue;
      const insert: string[] = [];
      const paramFindings = group.filter((r) => r.kind !== "async-race" && r.kind !== "no-ratelimit" && /^[A-Za-z_]\w*(?:\.[A-Za-z_]\w*)*$/.test(r.param));
      if (paramFindings.length) {
        const roots = [...new Set(paramFindings.filter((r) => r.param.includes(".")).map((r) => r.param.split(".")[0]))];
        const parts = [
          ...roots.map((rt) => `typeof(${rt}) ~= "table"`),
          ...paramFindings.map((r) => `typeof(${r.param}) ~= "number" or ${r.param} ~= ${r.param} or math.abs(${r.param}) == math.huge or ${r.param} <= 0 or ${r.param} > ${GUARD_MAX}`),
        ];
        insert.push(`${ind}if ${parts.join(" or ")} then`, `${ind}\treturn ${GUARD_TAG}`, `${ind}end`);
      }
      const rl = group.find((r) => r.kind === "no-ratelimit");
      const pl = rl?.playerParam && rl.playerParam !== "_" ? rl.playerParam : "";
      if (rl && pl) {
        needsCooldownTable = true;
        insert.push(`${ind}local _now = os.clock()`, `${ind}if _now - (_orbitCooldown[${pl}] or 0) < 0.25 then`, `${ind}\treturn ${GUARD_TAG}`, `${ind}end`, `${ind}_orbitCooldown[${pl}] = _now`);
      }
      if (insert.length) lines.splice(at, 0, ...insert);
    }
    if (needsCooldownTable && !lines.some((l) => l.includes("local _orbitCooldown"))) {
      lines.unshift(`local _orbitCooldown = {} ${GUARD_TAG}`);
    }
    const after = lines.join("\n");
    if (after === f.text) continue;
    out.push({ id: `fix:${hashText(file + after)}`, file, line: Math.min(...list.map((r) => r.line)), title: `Check client input in ${[...new Set(list.map((r) => r.remote))].join(", ")}`,
      why: `${list.length} finding(s) in client-callable handlers. The fix rejects non-numbers, NaN, math.huge, values <= 0 or > ${GUARD_MAX.toLocaleString("en-US")}, and adds a per-player cooldown where missing.`,
      before: f.text, after, hash: hashText(f.text), status: "pending" });
  }
  return out;
}

/** The changed lines of a proposal (for showing it): + for added. */
export function proposalDiff(p: Pick<Proposal, "before" | "after">): string[] {
  const a = p.before.split("\n"), b = p.after.split("\n"), out: string[] = [];
  let i = 0, j = 0;
  while (j < b.length) { if (a[i] === b[j]) { i++; j++; continue; } out.push(`+ ${b[j]}`); j++; }
  return out.slice(0, 40);
}

// ---- Bugs seen in play --------------------------------------------------------------------

/** Console errors (deduped across testers), stuck spots and the bots' own findings, each with exact repro steps. */
export function playBugs(runs: Run[], place: string): Bug[] {
  const out: Bug[] = [];
  for (const r of runs) {
    for (const e of r.consoleErrors) out.push({ id: `err:${e.slice(0, 80)}`, title: `Script error: ${e.slice(0, 100)}`, severity: "med", kind: "error", source: "seen", who: [r.tester],
      repro: [play(place), ...r.tel.steps.map((s) => `${s}.`), "Open View → Output and look for this line."], evidence: e });
    for (const s of r.tel.stuck) out.push({ id: `stuck:${Math.round((s.x ?? 0) / 16)}:${Math.round((s.z ?? 0) / 16)}`, title: `Stuck${s.x !== null && s.z !== null ? ` near x ${Math.round(s.x)}, z ${Math.round(s.z)}` : ""}: ${s.what}`, severity: "low", kind: "stuck", source: "seen", who: [r.tester],
      repro: [play(place), ...stepsTo(r, s.step), `${s.what}.`], evidence: `${name(r.tester)} at step ${s.step}.` });
    for (const f of r.findings) out.push({ id: `seen:${f.title.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()}`, title: f.title, severity: f.severity, kind: "seen", source: "seen", who: [r.tester],
      repro: [play(place), ...r.tel.steps.map((s) => `${s}.`), "Look for what the evidence says."], evidence: f.evidence });
  }
  return merge(out);
}

const SEV_ORDER: Record<Sev, number> = { high: 0, med: 1, low: 2 };
/** Same bug from several testers → one bug with all their names (first repro kept). */
function merge(bugs: Bug[]): Bug[] {
  const m = new Map<string, Bug>();
  for (const b of bugs) { const o = m.get(b.id); if (o) o.who = [...new Set([...o.who, ...b.who])]; else m.set(b.id, { ...b, who: [...b.who] }); }
  return [...m.values()];
}
export const sortBugs = (bs: Bug[]) => [...bs].sort((a, b) => SEV_ORDER[a.severity] - SEV_ORDER[b.severity] || (a.kind === "exploit" || a.kind === "code" ? -1 : 0) - (b.kind === "exploit" || b.kind === "code" ? -1 : 0) || b.who.length - a.who.length);

// ---- Heatmap -----------------------------------------------------------------------------

export type Cell = { visits: number; stuck: number; quit: number };
export type Heat = { cols: number; rows: number; minX: number; minZ: number; size: number; cells: Cell[]; zones: { x: number; z: number; zone: string }[] };
export const HEAT_N = 12;

/** Where testers walked, got stuck and stopped, binned into a square grid over the map area they covered. null when no positions. */
export function heatGrid(runs: Run[], n = HEAT_N): Heat | null {
  const pts = runs.flatMap((r) => r.tel.samples.filter((s) => s.x !== null && s.z !== null).map((s) => ({ x: s.x!, z: s.z! })));
  const st = runs.flatMap((r) => r.tel.stuck.filter((s) => s.x !== null && s.z !== null).map((s) => ({ x: s.x!, z: s.z! })));
  const all = [...pts, ...st];
  if (!all.length) return null;
  const minX = Math.min(...all.map((p) => p.x)), maxX = Math.max(...all.map((p) => p.x)), minZ = Math.min(...all.map((p) => p.z)), maxZ = Math.max(...all.map((p) => p.z));
  const size = Math.max(1, Math.ceil(Math.max(maxX - minX, maxZ - minZ) / n) || 1);
  const cells: Cell[] = Array.from({ length: n * n }, () => ({ visits: 0, stuck: 0, quit: 0 }));
  const at = (x: number, z: number) => cells[Math.min(n - 1, Math.floor((z - minZ) / size)) * n + Math.min(n - 1, Math.floor((x - minX) / size))];
  for (const p of pts) at(p.x, p.z).visits++;
  for (const p of st) at(p.x, p.z).stuck++;
  for (const r of runs) { // where a run ended early or stuck at its last step = where that tester "quit"
    const last = [...r.tel.samples].reverse().find((s) => s.x !== null && s.z !== null);
    const endStuck = r.tel.stuck.some((s) => s.step >= (r.tel.samples.at(-1)?.step ?? 0));
    if (last && (!r.done || endStuck)) at(last.x!, last.z!).quit++;
  }
  const zones = runs.flatMap((r) => r.tel.samples.filter((s) => s.zone && s.x !== null && s.z !== null).map((s) => ({ x: s.x!, z: s.z!, zone: s.zone })))
    .filter((z, i, a) => a.findIndex((y) => y.zone === z.zone) === i).slice(0, 8);
  return { cols: n, rows: n, minX, minZ, size, cells, zones };
}

const xml = (s: string) => s.replace(/[<>&"']/g, (c) => `&#${c.charCodeAt(0)};`);
/** The heatmap as a calm SVG image (top-down, x right, z down): grey = walked, amber = stuck, red = stopped there. */
export function heatmapSvg(h: Heat, title: string): string {
  const px = 32, pad = 28, W = h.cols * px + pad * 2, H = h.rows * px + pad * 2 + 24;
  const max = Math.max(1, ...h.cells.map((c) => c.stuck + 2 * c.quit)), vmax = Math.max(1, ...h.cells.map((c) => c.visits));
  const rects = h.cells.map((c, i) => {
    const x = pad + (i % h.cols) * px, y = pad + Math.floor(i / h.cols) * px, bad = c.stuck + 2 * c.quit;
    const fill = bad ? (c.quit ? "#fb7185" : "#fbbf24") : c.visits ? "#94a3b8" : "#1e293b";
    const op = bad ? 0.35 + 0.65 * (bad / max) : c.visits ? 0.15 + 0.4 * (c.visits / vmax) : 0.6;
    return `<rect x="${x}" y="${y}" width="${px - 2}" height="${px - 2}" rx="4" fill="${fill}" fill-opacity="${op.toFixed(2)}"><title>${c.visits} visits, ${c.stuck} stuck, ${c.quit} stopped</title></rect>`;
  }).join("");
  const labels = h.zones.map((z) => {
    const x = pad + Math.min(h.cols - 1, Math.floor((z.x - h.minX) / h.size)) * px + px / 2, y = pad + Math.min(h.rows - 1, Math.floor((z.z - h.minZ) / h.size)) * px + px / 2;
    return `<text x="${x}" y="${y + 4}" font-size="10" text-anchor="middle" fill="#e2e8f0">${xml(z.zone.slice(0, 14))}</text>`;
  }).join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="system-ui, sans-serif">`
    + `<rect width="${W}" height="${H}" fill="#0f172a"/><text x="${pad}" y="18" font-size="13" fill="#e2e8f0">${xml(title.slice(0, 60))}</text>${rects}${labels}`
    + `<g font-size="11" fill="#cbd5e1" transform="translate(${pad},${H - 12})"><rect width="10" height="10" y="-9" fill="#94a3b8"/><text x="14">walked</text>`
    + `<rect x="70" width="10" height="10" y="-9" fill="#fbbf24"/><text x="84">stuck</text><rect x="130" width="10" height="10" y="-9" fill="#fb7185"/><text x="144">stopped</text>`
    + `<text x="210">1 square = ${h.size} studs</text></g></svg>`;
}

// ---- Report ----------------------------------------------------------------------------

export type Report = {
  at: string; place: string; project: string; studio: string; runs: Run[]; bugs: Bug[]; flow: Flow[]; curves: Curve[]; economy: EconomyMap;
  heat: Heat | null; heatSvg: string | null; proposals: Proposal[]; line: string; untested: string[];
};

export function reportLine(r: Pick<Report, "runs" | "bugs" | "proposals">): string {
  const played = r.runs.filter((x) => x.done).length, ex = r.bugs.filter((b) => b.kind === "exploit" || b.kind === "code").length, fixes = r.proposals.filter((p) => p.status === "pending").length;
  return [`AI playtesters: ${played} of ${r.runs.length || SQUAD.length} played`, `${r.bugs.length} bug${r.bugs.length === 1 ? "" : "s"}`, ex && `${ex} exploit sign${ex === 1 ? "" : "s"}`, fixes && `${fixes} fix${fixes === 1 ? "" : "es"} wait for you`].filter(Boolean).join(" · ");
}

/** What this report could NOT check, said plainly in the report itself. */
export function untested(r: Pick<Report, "runs" | "flow" | "studio">, hadCode: boolean): string[] {
  const out = ["The testers can only walk and look: they can't click, buy, hatch or press keys, so spending and buying are not measured."];
  if (!r.runs.length) out.push(`No Studio runs: ${r.studio}`);
  else if (!r.flow.length) out.push("No coin numbers could be confirmed from Studio's own output, so there is no money curve this time.");
  if (!hadCode) out.push("No Rojo project connected, so the code wasn't checked for exploits (GAME DEV → Build → Files).");
  else out.push("Exploit checks on the code are a careful guess from reading it, not a real attack; try the repro steps to confirm.");
  return out;
}

// ---- Run (deps injected: the MCP bridge and Rojo are mocked in tests) -------------------------

export type Deps = {
  status: () => Promise<{ configured: boolean; open: boolean; place: string; notes: string }>;
  /** One look-only playtest with the telemetry prompt; text = the bot's final text, inspect = raw inspect_instance output. */
  play: (goal: string, extra: string) => Promise<{ done: boolean; findings: Run["findings"]; consoleErrors: string[]; notes: string; text: string; inspect: string }>;
  code: () => Promise<{ project: string; files: { file: string; text: string }[] } | null>;
  onStep?: (index: number, label: string) => void;
  signal?: AbortSignal;
  now: () => string;
};

export const STAGE_STUDIO = "Check Studio is open";
export const STAGE_CODE = "Check the code for exploits";
export const STAGE_REPORT = "Write the report";
export const stages = (ts: Tester[] = SQUAD) => [STAGE_STUDIO, ...ts.map((t) => `${t.name} plays (${t.type.toLowerCase()})`), STAGE_CODE, STAGE_REPORT];

export async function runSquad(d: Deps, ts: Tester[] = SQUAD): Promise<Report> {
  d.onStep?.(0, STAGE_STUDIO);
  const st = await d.status();
  const runs: Run[] = [];
  let studio = !st.configured ? "the Roblox Studio bridge isn't set up." : !st.open ? `Studio wasn't open (${st.notes || "no answer"}).` : "";
  for (const [i, t] of ts.entries()) {
    if (studio || d.signal?.aborted) break;
    d.onStep?.(i + 1, `${t.name} is playing`);
    try {
      const r = await d.play(t.goal, telemetryPrompt());
      runs.push({ tester: t.id, done: r.done, findings: r.findings, consoleErrors: r.consoleErrors, notes: r.notes, tel: parseTelemetry(r.text, r.inspect) });
    } catch (e) {
      runs.push({ tester: t.id, done: false, findings: [], consoleErrors: [], notes: "", tel: { samples: [], stuck: [], items: [], steps: [] }, error: (e instanceof Error ? e.message : String(e)).slice(0, 200) });
    }
  }
  if (!studio && runs.length) studio = `${runs.filter((r) => r.done).length} of ${runs.length} runs finished in ${st.place || "Studio"}.`;
  d.onStep?.(ts.length + 1, STAGE_CODE);
  const code = await d.code().catch(() => null);
  const files = code?.files ?? [], remotes = auditRemotes(files);
  d.onStep?.(ts.length + 2, STAGE_REPORT);
  const place = st.place, flow = currencyFlow(runs), heat = heatGrid(runs);
  const bugs = sortBugs([...exploitSigns(runs, place), ...remoteBugs(remotes), ...playBugs(runs, place)]).slice(0, 40);
  const proposals = guardProposals(files, remotes);
  const base = { runs, bugs, flow, studio, proposals };
  return { at: d.now(), place, project: code?.project ?? "", studio, runs, bugs, flow, curves: curves(runs), economy: economyMap(files), heat,
    heatSvg: heat ? heatmapSvg(heat, `Where testers walked and got stuck · ${place || "Studio"}`) : null, proposals, line: reportLine(base), untested: untested(base, !!code) };
}

// ---- The "Working on it" card ----------------------------------------------------------------

export type Live = { running: boolean; step: number; now: string; startedAt: string | null };
export const OPEN = "#o=creation&v=test";
export const TYPICAL_MS = (SQUAD.length * 4 + 2) * 60_000;

/** Running → the live card; otherwise the last report as a done card (Review when fixes wait for his click). */
export function squadProgress(live: Live, report: Report | null, lang: Lang, nowMs: number): Progress | null {
  const ss = stages();
  if (live.running) return fromStages({ id: "playtesters", title: lang === "et" ? "AI mängutestijad" : "AI playtesters", stages: ss, current: live.step, now: live.now, startedAt: live.startedAt, typicalMs: TYPICAL_MS, at: live.startedAt ?? new Date(nowMs).toISOString() }, lang, nowMs);
  if (!report) return null;
  const fixes = report.proposals.filter((p) => p.status === "pending").length;
  return fromStages({ id: "playtesters", title: lang === "et" ? "AI mängutestijad" : "AI playtesters", stages: ss, current: ss.length, result: { text: report.line, open: OPEN },
    needs: fixes ? { kind: "approve", label: lang === "et" ? "Vaata parandusi" : "Review fixes", open: OPEN } : null, at: report.at }, lang, nowMs);
}
