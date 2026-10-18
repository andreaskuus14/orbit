// Roblox API docs lookup (pure half): name extraction, a minimal YAML reader for Roblox's creator-docs reference files,
// compact docs for prompts, cache TTL/bounds and a validator that flags members the docs don't have. Tested in tests/roblox-docs.test.ts.
import type { LintFlag } from "./luau-pure.ts";

/** Roblox's open-source Creator Docs: content/en-us/reference/engine/{classes,datatypes,enums}/<Name>.yaml */
export const RAW_BASE = "https://raw.githubusercontent.com/Roblox/creator-docs/main/content/en-us/reference/engine";
export const PAGE_BASE = "https://create.roblox.com/docs/reference/engine";
export const DOC_TTL_MS = 7 * 24 * 3600_000;
export const MAX_CACHE = 300; // entries (one per class/datatype/enum)
export const MAX_DOC_CHARS = 1500;

export const SERVICES = ["Players", "Workspace", "ReplicatedStorage", "ReplicatedFirst", "ServerStorage", "ServerScriptService", "StarterGui", "StarterPack", "StarterPlayer",
  "Lighting", "SoundService", "TweenService", "RunService", "UserInputService", "ContextActionService", "DataStoreService", "MemoryStoreService", "MessagingService",
  "HttpService", "MarketplaceService", "TeleportService", "CollectionService", "PathfindingService", "PhysicsService", "Debris", "TextService", "TextChatService",
  "BadgeService", "GroupService", "InsertService", "ProximityPromptService", "GuiService", "HapticService", "Teams", "LocalizationService", "PolicyService",
  "SocialService", "AvatarEditorService", "ContentProvider", "AssetService"];
export const CLASSES = ["Humanoid", "Animator", "Animation", "AnimationTrack", "Part", "MeshPart", "BasePart", "Model", "Folder", "Tool", "Sound", "Attachment", "Beam",
  "ParticleEmitter", "Trail", "PointLight", "SpotLight", "Weld", "WeldConstraint", "Motor6D", "ProximityPrompt", "ClickDetector", "RemoteEvent", "RemoteFunction",
  "UnreliableRemoteEvent", "BindableEvent", "BindableFunction", "ScreenGui", "SurfaceGui", "BillboardGui", "Frame", "ScrollingFrame", "TextLabel", "TextButton", "TextBox",
  "ImageLabel", "ImageButton", "UICorner", "UIStroke", "UIPadding", "UIListLayout", "UIGridLayout", "UIAspectRatioConstraint", "UIGradient", "UIScale", "Camera",
  "Player", "PlayerGui", "Backpack", "Tween", "Highlight", "Explosion", "SpawnLocation", "Seat", "VehicleSeat", "IntValue", "NumberValue", "StringValue", "BoolValue",
  "ObjectValue", "LinearVelocity", "AlignPosition", "AlignOrientation", "VectorForce", "Decal", "Texture", "Terrain", "Team", "DataStore"];
export const DATATYPES = ["CFrame", "Vector3", "Vector2", "UDim", "UDim2", "Color3", "BrickColor", "TweenInfo", "Ray", "RaycastParams", "RaycastResult", "OverlapParams",
  "NumberSequence", "NumberSequenceKeypoint", "ColorSequence", "ColorSequenceKeypoint", "NumberRange", "Rect", "Region3", "RBXScriptSignal", "RBXScriptConnection",
  "PhysicalProperties", "Font", "DateTime", "Random"];
const KNOWN = new Set([...SERVICES, ...CLASSES, ...DATATYPES]);
// Plain-English requests rarely name the API: a few words that reliably imply one.
const HINTS: [RegExp, string[]][] = [
  [/\btween/i, ["TweenService", "TweenInfo"]], [/\b(data ?store|save data|saves? progress)/i, ["DataStoreService"]], [/\bremote/i, ["RemoteEvent"]],
  [/\b(humanoid|walk ?speed|jump|health|character)/i, ["Humanoid"]], [/\b(leaderstats|leaderboard)/i, ["Players"]], [/\b(gui|button|menu|hud)\b/i, ["ScreenGui", "TextButton", "Frame"]],
  [/\b(key ?press|keyboard|input)\b/i, ["UserInputService"]], [/\bprompt\b/i, ["ProximityPrompt"]], [/\b(raycast|ray cast)/i, ["RaycastParams"]],
  [/\b(gamepass|game pass|dev ?product|purchase)/i, ["MarketplaceService"]], [/\b(sound|music)\b/i, ["Sound"]], [/\banimation/i, ["Animator", "AnimationTrack"]],
];

/** Safe for a URL path segment: plain identifiers only (a trust boundary: names come from user text and model output). */
export const validName = (n: string) => /^(Enum\.)?[A-Za-z][A-Za-z0-9]{0,60}$/.test(n);

/** Candidate API names in a request, plan or code: known PascalCase names, Instance.new/GetService/IsA/FindFirst*Of* strings, Enum.X and a few English hints. */
export function extractApiNames(text: string, max = 8): string[] {
  const hits: [number, string][] = [];
  for (const m of text.matchAll(/\b(?:Instance\.new|GetService|IsA|FindFirstChildOfClass|FindFirstChildWhichIsA|FindFirstAncestorOfClass)\s*\(\s*["']([A-Za-z]\w*)["']/g)) hits.push([m.index, m[1]]);
  for (const m of text.matchAll(/\bEnum\.([A-Za-z]\w*)/g)) hits.push([m.index, `Enum.${m[1]}`]);
  for (const m of text.matchAll(/(?<![.\w])[A-Z][A-Za-z0-9]+\b/g)) if (KNOWN.has(m[0])) hits.push([m.index, m[0]]);
  if (/^workspace\b|[^.\w]workspace\b/.test(text)) hits.push([text.search(/\bworkspace\b/), "Workspace"]);
  for (const [re, names] of HINTS) { const i = text.search(re); if (i >= 0) for (const n of names) hits.push([i + 0.5, n]); }
  return [...new Set(hits.sort((a, b) => a[0] - b[0]).map((h) => h[1]).filter(validName))].slice(0, max);
}

/** Raw YAML URLs to try, most likely first. */
export function docUrls(name: string): string[] {
  if (!validName(name)) return [];
  if (name.startsWith("Enum.")) return [`${RAW_BASE}/enums/${name.slice(5)}.yaml`];
  const dirs = DATATYPES.includes(name) ? ["datatypes", "classes"] : ["classes", "datatypes"];
  return dirs.map((d) => `${RAW_BASE}/${d}/${name}.yaml`);
}
export const pageUrl = (name: string) => name.startsWith("Enum.") ? `${PAGE_BASE}/enums/${name.slice(5)}` : `${PAGE_BASE}/${DATATYPES.includes(name) ? "datatypes" : "classes"}/${name}`;

/* ---------- Minimal YAML (the subset the generated reference files use) ---------- */
// shortcut: block maps/sequences, `|`/`>` block scalars, quoted/plain scalars and one-line [a, b] flows only; no anchors, tags or multi-line flows. Enough for creator-docs reference YAML.

type Y = string | number | boolean | null | Y[] | { [k: string]: Y };
export const MAX_YAML_DEPTH = 32;
/** Never throws: anything it can't read (or nested deeper than MAX_YAML_DEPTH) gives null. */
export function parseYaml(text: string): Y {
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  let i = 0, depth = 0;
  const ind = (l: string) => l.length - l.trimStart().length;
  const skip = () => { while (i < lines.length && (!lines[i].trim() || /^\s*#/.test(lines[i]))) i++; };
  const scalar = (s: string): Y => {
    s = s.trim();
    if (s === "" || s === "~" || s === "null") return null;
    if (s.startsWith("'") && s.endsWith("'") && s.length > 1) return s.slice(1, -1).replace(/''/g, "'");
    if (s.startsWith('"') && s.endsWith('"') && s.length > 1) { try { return JSON.parse(s) as string; } catch { return s.slice(1, -1); } }
    if (s === "[]") return [];
    if (s === "{}") return {};
    if (s.startsWith("[") && s.endsWith("]")) return s.slice(1, -1).split(",").map(scalar);
    if (s === "true" || s === "false") return s === "true";
    if (/^-?\d+(\.\d+)?$/.test(s)) return Number(s);
    return s;
  };
  const block = (parent: number, folded: boolean): string => {
    const body: string[] = [];
    while (i < lines.length && (!lines[i].trim() || ind(lines[i]) > parent)) body.push(lines[i++]);
    while (body.length && !body[body.length - 1].trim()) body.pop();
    const cut = body.reduce((m, l) => (l.trim() ? Math.min(m, ind(l)) : m), Infinity);
    const out = body.map((l) => l.slice(cut)).join("\n");
    return (folded ? out.replace(/([^\n])\n(?=[^\n])/g, "$1 ") : out) + "\n";
  };
  const value = (rest: string, at: number): Y => {
    if (/^[|>][-+]?$/.test(rest)) return block(at, rest[0] === ">");
    if (rest) return scalar(rest);
    skip();
    if (i < lines.length && (ind(lines[i]) > at || (ind(lines[i]) === at && /^\s*-( |$)/.test(lines[i])))) return node();
    return null;
  };
  const node = (): Y => {
    if (++depth > MAX_YAML_DEPTH) throw new Error("YAML nested too deep");
    try { return nodeAt(); } finally { depth--; }
  };
  const nodeAt = (): Y => {
    skip();
    if (i >= lines.length) return null;
    const at = ind(lines[i]);
    if (/^\s*-( |$)/.test(lines[i])) {
      const arr: Y[] = [];
      while (skip(), i < lines.length && ind(lines[i]) === at && /^\s*-( |$)/.test(lines[i])) {
        const item = lines[i].slice(at + 1);
        if (/^\s*[\w.$-]+:( |$)/.test(item)) { lines[i] = " ".repeat(at + 1) + item; arr.push(node()); } // "- key: v" → a map one column in
        else { i++; arr.push(value(item.trim(), at)); }
      }
      return arr;
    }
    const obj: { [k: string]: Y } = {};
    while (skip(), i < lines.length && ind(lines[i]) === at && !/^\s*-( |$)/.test(lines[i])) {
      const m = /^\s*([^\s:#][^:]*?):(?: (.*))?$/.exec(lines[i]);
      i++;
      if (m && m[1].trim() !== "__proto__") obj[m[1].trim()] = value((m[2] ?? "").trim(), at);
    }
    return obj;
  };
  try { return node(); } catch { return null; }
}

/* ---------- Compact docs ---------- */

/** Own property only, so names like "constructor" or "toString" never hit Object.prototype. */
export const own = <T>(o: Record<string, T>, k: string): T | undefined => (Object.hasOwn(o, k) ? o[k] : undefined);

export type MemberKind = "property" | "method" | "event" | "callback" | "constructor" | "function" | "constant" | "item";
export type Member = { name: string; kind: MemberKind; sig: string; dep?: string; ro?: true; hidden?: true };
export type ApiDoc = { name: string; kind: "class" | "datatype" | "enum"; summary: string; inherits: string[]; dep?: string; members: Member[]; partial?: true };

const tidy = (s: unknown, max: number) => {
  const t = (typeof s === "string" ? s : "").replace(/`(?:Class|Datatype|Global|Library)\.([^`]+)`/g, "$1").replace(/`(Enum\.[^`]+)`/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1").replace(/\s+/g, " ").trim();
  return t.length > max ? `${t.slice(0, max - 1).replace(/\s\S*$/, "")}…` : t;
};
const list = (v: Y | undefined): Y[] => (Array.isArray(v) ? v : []);
const rec = (v: Y | undefined) => (v && typeof v === "object" && !Array.isArray(v) ? v : {}) as Record<string, Y>;
const depOf = (o: Record<string, Y>) => {
  const msg = tidy(o.deprecation_message, 140);
  return msg || (list(o.tags).includes("Deprecated") ? "deprecated" : "");
};

/** One parsed reference YAML → ApiDoc (enums are keyed "Enum.<Name>"). null when it isn't a reference file. */
export function docFromYaml(y: Y): ApiDoc | null {
  const o = rec(y);
  const kind = o.type === "class" || o.type === "datatype" || o.type === "enum" ? o.type : null;
  if (!kind || typeof o.name !== "string" || !validName(o.name)) return null;
  const members: Member[] = [];
  const seen = new Set<string>();
  const params = (p: Y | undefined) => list(p).map((x) => { const r = rec(x); return `${r.name}${r.type ? `: ${r.type}` : ""}${r.default !== null && r.default !== undefined && r.default !== "" ? ` = ${r.default}` : ""}`; }).join(", ");
  const add = (key: string, mk: MemberKind) => {
    for (const raw of list(o[key])) {
      const r = rec(raw), full = typeof r.name === "string" ? r.name : "";
      const name = /[.:]([A-Za-z_]\w*)$/.exec(full)?.[1] ?? (mk === "item" && /^[A-Za-z_]\w*$/.test(full) ? full : "");
      if (!name || seen.has(`${mk}:${name}`)) continue; // overloads: the first signature is kept
      seen.add(`${mk}:${name}`);
      const tags = list(r.tags), ret = list(r.returns).map((x) => rec(x).type).filter(Boolean).join(", ");
      const sig = mk === "property" || mk === "constant" ? `${name}: ${r.type ?? "?"}`
        : mk === "item" ? name
        : mk === "event" ? `${name}(${params(r.parameters)})`
        : `${name}(${params(r.parameters)})${ret && ret !== "()" ? `: ${ret}` : ""}`;
      const dep = depOf(r);
      members.push({ name, kind: mk, sig, ...(dep ? { dep } : {}), ...(tags.includes("ReadOnly") ? { ro: true as const } : {}), ...(tags.includes("Hidden") ? { hidden: true as const } : {}) });
    }
  };
  add("properties", "property"); add("methods", "method"); add("events", "event"); add("callbacks", "callback");
  add("constructors", "constructor"); add("constants", "constant"); add("functions", "function"); add("items", "item");
  const dep = depOf(o);
  return { name: kind === "enum" ? `Enum.${o.name}` : o.name, kind, summary: tidy(o.summary, 300), inherits: list(o.inherits).filter((x): x is string => typeof x === "string" && validName(x)), ...(dep ? { dep } : {}), members };
}

const SECTIONS: [string, MemberKind[]][] = [["Constructors", ["constructor"]], ["Functions", ["function"]], ["Constants", ["constant"]], ["Properties", ["property"]],
  ["Methods", ["method"]], ["Events", ["event"]], ["Callbacks", ["callback"]], ["Items", ["item"]]];

/** ≤ max chars of reference text for one API: summary, deprecated names to avoid, then members by section. */
export function formatDoc(d: ApiDoc, max = MAX_DOC_CHARS): string {
  const shown = d.members.filter((m) => !m.hidden);
  const dep = shown.filter((m) => m.dep);
  // Too long with full signatures → signatures only for properties → names only, so every member name still fits.
  const render = (level: number) => [
    `## ${d.name} (${d.kind}${d.inherits.length ? `, inherits ${d.inherits.join(", ")}` : ""})${d.dep ? ` DEPRECATED: ${d.dep}` : ""}`,
    d.summary,
    dep.length ? `Deprecated, do not use: ${dep.map((m) => m.name).join(", ")}`.slice(0, 200) : "",
    ...SECTIONS.map(([label, kinds]) => {
      const ms = shown.filter((m) => !m.dep && kinds.includes(m.kind));
      const full = level === 0 || (level === 1 && m0(kinds));
      return ms.length ? `${label}: ${ms.map((m) => (full ? m.sig : m.name) + (m.ro ? " [read-only]" : "")).join(full ? "; " : ", ")}` : "";
    }),
  ].filter(Boolean).join("\n");
  const m0 = (kinds: MemberKind[]) => kinds.includes("property") || kinds.includes("constant");
  const out = [0, 1, 2].map(render).find((t) => t.length <= max) ?? render(2);
  return out.length > max ? `${out.slice(0, max - 1)}…` : out;
}

/** The <roblox_docs> body for the names that were found (partial = summary only, from the docs website). */
export function docsBlock(names: string[], docs: Record<string, ApiDoc>): string {
  return names.map((n) => own(docs, n)).filter((d): d is ApiDoc => !!d).map((d) => formatDoc(d)).join("\n\n");
}

/* ---------- Disk cache bounds ---------- */

export type CacheEntry = { at: number; doc: ApiDoc | null }; // doc null = not in the docs (negative cache)
/** A cache entry as read back from disk: anything wrong-shaped is dropped. */
export const cacheEntryOk = (e: unknown): e is CacheEntry => {
  const o = e as CacheEntry | null;
  return !!o && typeof o === "object" && Number.isFinite(o.at) && (o.doc === null || (!!o.doc && typeof o.doc === "object" && typeof o.doc.name === "string" && validName(o.doc.name)
    && (o.doc.kind === "class" || o.doc.kind === "datatype" || o.doc.kind === "enum") && Array.isArray(o.doc.inherits) && Array.isArray(o.doc.members)
    && o.doc.members.every((m) => !!m && typeof m.name === "string" && typeof m.sig === "string")));
};
export const fresh = (e: CacheEntry | undefined, now: number, ttl = DOC_TTL_MS): e is CacheEntry => !!e && now - e.at >= 0 && now - e.at < ttl;
/** Drop expired entries and keep the newest MAX_CACHE. */
export function pruneCache(c: Record<string, CacheEntry>, now: number, max = MAX_CACHE, ttl = DOC_TTL_MS): Record<string, CacheEntry> {
  return Object.fromEntries(Object.entries(c && typeof c === "object" ? c : {}).filter(([k, e]) => validName(k) && cacheEntryOk(e) && fresh(e, now, ttl)).sort((a, b) => b[1].at - a[1].at).slice(0, max));
}

/* ---------- Validator ---------- */

export function levenshtein(a: string, b: string): number {
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[b.length];
}

/** Closest real member: same name in other case, else small edit distance, else (unless `strict`) one name containing the other. */
export function suggest(bad: string, members: Member[], strict = false): string | null {
  const live = members.filter((m) => !m.dep && !m.hidden), lb = bad.toLowerCase();
  const exact = live.find((m) => m.name.toLowerCase() === lb);
  if (exact) return exact.name;
  let best: Member | null = null, bd = Infinity;
  for (const m of live) { const d = levenshtein(lb, m.name.toLowerCase()); if (d < bd) { bd = d; best = m; } }
  if (best && bd <= Math.max(1, Math.min(3, Math.floor(bad.length / 3)))) return best.name;
  if (strict || bad.length < 4) return null;
  const sub = live.filter((m) => m.name.toLowerCase().includes(lb) || (m.name.length >= 4 && lb.includes(m.name.toLowerCase()))).sort((a, b) => a.name.length - b.name.length);
  return sub[0]?.name ?? null;
}

/** Every member of a class and its ancestors; null when any ancestor's docs are missing (then nothing is flagged). */
export function chainMembers(name: string, docs: Record<string, ApiDoc>): Member[] | null {
  const out: Member[] = [];
  for (let n: string | undefined = name, depth = 0; n; depth++) {
    const d: ApiDoc | undefined = own(docs, n);
    if (!d || d.partial || depth > 12) return null;
    out.push(...d.members);
    n = d.inherits[0];
  }
  return out;
}

const STATIC: MemberKind[] = ["constructor", "function", "constant"];
const blankStrings = (s: string) => s.replace(/"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'/g, (q) => q[0] + " ".repeat(q.length - 2) + q[0]);

/** Flags members used on known Roblox types that the fetched docs don't have, and deprecated ones.
 *  Variables are typed only from `x = Instance.new("C")`, `x = …:GetService("C")`, `x = …:FindFirstChildOfClass/WhichIsA("C")` (C a documented class) and `workspace`
 *  (a WaitForChild("Humanoid") name says nothing certain about the class).
 *  A dot access that isn't an assignment may be a child named that way, so it's flagged only when a close real member exists. */
export function validateApiUse(code: string, docs: Record<string, ApiDoc>): LintFlag[] {
  // shortcut: line-regex typing, no scopes or flow analysis; a variable bound to two classes is ignored.
  const src = code.replace(/\r\n?/g, "\n").split("\n").map((l) => l.replace(/--.*$/, "")).join("\n");
  const types = new Map<string, string | null>([["workspace", "Workspace"]]);
  for (const l of src.split("\n")) {
    const m = /^\s*(?:local\s+)?([A-Za-z_]\w*)(?:\s*:\s*[\w.]+)?\s*=\s*(.+)$/.exec(l);
    if (!m || m[2].startsWith("=")) continue;
    const rhs = m[2].trim();
    const cls = /^Instance\.new\s*\(\s*["'](\w+)["']/.exec(rhs)?.[1]
      ?? /:\s*(?:GetService|FindFirstChildOfClass|FindFirstChildWhichIsA)\s*\(\s*["'](\w+)["'][^()]*\)\s*$/.exec(rhs)?.[1];
    const t = cls && own(docs, cls)?.kind === "class" ? cls : null;
    types.set(m[1], types.has(m[1]) && types.get(m[1]) !== t ? null : t);
  }
  const body = blankStrings(src), flags: LintFlag[] = [], done = new Set<string>();
  const lineAt = (idx: number) => body.slice(0, idx).split("\n").length;
  const flag = (key: string, idx: number, rule: string, message: string) => { if (!done.has(key)) { done.add(key); flags.push({ rule, line: lineAt(idx), message }); } };
  for (const m of body.matchAll(/(?<![.:\w])([A-Za-z_]\w*)\s*([.:])\s*([A-Za-z_]\w*)/g)) {
    const [, v, sep, mem] = m, at = m.index, after = body.slice(at + m[0].length);
    if (v === "Enum") {
      const e = /^\s*\.\s*([A-Za-z_]\w*)/.exec(after)?.[1], d = own(docs, `Enum.${mem}`);
      if (!e || !d || d.partial) continue;
      const item = d.members.find((x) => x.name === e);
      if (!item) { const s = suggest(e, d.members); flag(`Enum.${mem}.${e}`, at, "api", `Enum.${mem} has no item "${e}"${s ? `: did you mean Enum.${mem}.${s}?` : " in Roblox's docs"}`); }
      else if (item.dep) flag(`Enum.${mem}.${e}`, at, "deprecated", `Enum.${mem}.${e} is deprecated: ${item.dep}`);
      continue;
    }
    const d = own(docs, v);
    if (!types.has(v) && d?.kind === "datatype" && !d.partial && sep === ".") { // CFrame.new, Vector3.one …
      const statics = d.members.filter((x) => STATIC.includes(x.kind)), hit = statics.find((x) => x.name === mem);
      if (!hit) { const s = suggest(mem, statics); flag(`${v}.${mem}`, at, "api", `${v}.${mem} doesn't exist in Roblox's docs${s ? `: did you mean ${v}.${s}?` : ""}`); }
      else if (hit.dep) flag(`${v}.${mem}`, at, "deprecated", `${v}.${mem} is deprecated: ${hit.dep}`);
      continue;
    }
    const cls = types.get(v);
    const all = cls ? chainMembers(cls, docs) : null;
    if (!cls || !all) continue;
    const hit = all.find((x) => x.name === mem);
    const label = `${cls}${sep}${mem}`;
    if (hit) { if (hit.dep) flag(label, at, "deprecated", `${label} is deprecated: ${hit.dep}`); continue; }
    // A plain dot read may be a child with that name: only a near-identical member name counts as a typo there.
    const assigns = sep === "." && /^\s*=(?!=)/.test(after), s = suggest(mem, all, sep === "." && !assigns);
    if (sep === ":" || assigns || s) flag(label, at, "api", `${cls} has no member "${mem}" in Roblox's docs${s ? `: did you mean ${s}?` : ""}`);
  }
  return flags;
}
