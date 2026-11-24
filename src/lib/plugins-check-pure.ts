// Plugins: config validation and the tool-schema checks (Ajv). Split from plugins-pure.ts so client bundles that only need the
// gates/ids (policy-pure, PluginsSection) don't ship Ajv. Server-only callers: plugins.ts, /api/plugins. Tested in tests/plugins.test.ts.
import { Ajv, type ValidateFunction } from "ajv";
import { Ajv2020 } from "ajv/dist/2020.js";
import { compactSchema, ENV, HEADER, isMode, NAME, RESERVED_HEADERS, str, TOOL, type Annotations, type CachedTool, type Mode, type Plugin } from "./plugins-pure.ts";

/** One plugin from untrusted input (his form, plugins.json, setup.ps1), or why not. */
export function validatePlugin(b: unknown): Plugin | string {
  if (!b || typeof b !== "object") return "plugin must be an object";
  const o = b as Record<string, unknown>;
  const name = typeof o.name === "string" ? o.name.trim().toLowerCase() : "";
  if (!NAME.test(name)) return "name: 1-32 lowercase letters, digits or -";
  const command = str(o.command, 400), url = str(o.url, 400);
  if (!!command === !!url) return "give either a command (stdio) or a URL (http), not both";
  if (url) {
    let u: URL;
    try { u = new URL(url); } catch { return "URL is not valid"; }
    const loop = ["localhost", "127.0.0.1", "[::1]"].includes(u.hostname);
    if (u.protocol !== "https:" && !(u.protocol === "http:" && loop)) return "URL must be https:// (or http:// on localhost)";
    if (u.username || u.password) return "no credentials in the URL";
  }
  const args = o.args === undefined ? [] : o.args;
  if (!Array.isArray(args) || args.length > 40 || args.some((a) => typeof a !== "string" || a.length > 500 || /[\r\n\0]/.test(a))) return "args: up to 40 strings";
  const env: Record<string, string> = {};
  if (o.env !== undefined) {
    if (!o.env || typeof o.env !== "object" || Array.isArray(o.env)) return "env must be an object";
    for (const [k, v] of Object.entries(o.env)) {
      if (!ENV.test(k) || typeof v !== "string" || v.length > 4000) return `env ${k.slice(0, 40)}: name A-Z_0-9, value a string`;
      env[k] = v;
    }
  }
  const headers: Record<string, string> = {};
  if (o.headers !== undefined) {
    if (!url) return "headers are for http plugins (url) only; a command plugin gets env";
    if (!o.headers || typeof o.headers !== "object" || Array.isArray(o.headers)) return "headers must be an object";
    for (const [k, v] of Object.entries(o.headers)) {
      if (!HEADER.test(k) || RESERVED_HEADERS.has(k.toLowerCase())) return `headers ${k.slice(0, 40)}: not a header ORBIT can send`;
      if (typeof v !== "string" || !v || v.length > 4000 || /[\r\n\0]/.test(v)) return `headers ${k}: value must be one line of text`;
      headers[k] = v;
    }
  }
  if (o.oauth !== undefined && o.oauth !== true && o.oauth !== false) return "oauth: true or false";
  if (o.oauth === true && !url) return "oauth is for http plugins (url) only";
  if (o.oauth === true && Object.keys(headers).length) return "use either oauth sign-in or a token in headers, not both";
  const tools: Record<string, Mode> = {};
  if (o.tools !== undefined) {
    if (!o.tools || typeof o.tools !== "object" || Array.isArray(o.tools)) return "tools must be an object of tool → auto|ask|off";
    for (const [k, v] of Object.entries(o.tools)) { if (!TOOL.test(k) || !isMode(v)) return `tools.${k.slice(0, 40)}: auto, ask or off`; tools[k] = v; }
  }
  if (o.others !== undefined && !isMode(o.others)) return "others: auto, ask or off";
  const t = o.timeoutSec === undefined ? 60 : Number(o.timeoutSec);
  if (!Number.isInteger(t) || t < 5 || t > 600) return "timeoutSec: 5-600";
  const p: Plugin = { name, args: args as string[], env, enabled: o.enabled !== false, local: o.local === true, tools, timeoutSec: t };
  if (command) p.command = command; else p.url = url;
  if (Object.keys(headers).length) p.headers = headers;
  if (o.oauth === true) p.oauth = true;
  if (o.others !== undefined) p.others = o.others as Mode;
  const note = str(o.note, 300);
  if (note) p.note = note;
  const c = o.cache as Plugin["cache"] | undefined;
  if (c && typeof c === "object" && Array.isArray(c.tools)) p.cache = { at: String(c.at ?? ""), tools: c.tools.flatMap((x) => cleanTool(x) ?? []), ...(c.error ? { error: String(c.error).slice(0, 300) } : {}) };
  return p;
}

/** plugins.json text → valid plugins (invalid or duplicate entries are dropped, never fatal). */
export function parsePlugins(raw: string | null): Plugin[] {
  let list: unknown;
  try { list = JSON.parse((raw ?? "").replace(/^\uFEFF/, ""))?.plugins; } catch { return []; } // BOM: Windows PowerShell 5 writes one
  const out: Plugin[] = [];
  for (const b of Array.isArray(list) ? list : []) { const p = validatePlugin(b); if (typeof p !== "string" && !out.some((x) => x.name === p.name)) out.push(p); }
  return out;
}

/** A tools/list entry → what ORBIT keeps (name checked, description and schema capped). null = unusable name. */
export function cleanTool(t: unknown): CachedTool | null {
  if (!t || typeof t !== "object") return null;
  const o = t as Record<string, unknown>;
  if (typeof o.name !== "string" || !TOOL.test(o.name)) return null;
  const a = (o.annotations && typeof o.annotations === "object" ? o.annotations : {}) as Record<string, unknown>;
  const annotations: Annotations = {};
  for (const k of ["readOnlyHint", "destructiveHint", "openWorldHint"] as const) if (typeof a[k] === "boolean") annotations[k] = a[k] as boolean;
  const description = String(o.description ?? "").replace(/\s+/g, " ").trim().slice(0, 400);
  if (typeof o.schema === "string") { // a cache entry being re-read: keep a refusal; re-check a kept schema (plugins.json is editable)
    const kept: CachedTool = { name: o.name, description, annotations, schema: o.schema.slice(0, 600) };
    if (typeof o.schemaError === "string") return { ...kept, schemaError: o.schemaError.slice(0, 200) };
    if (o.inputSchema === undefined) return kept; // cached before schemas were kept: unchecked until Test connection
    const again = prepSchema(o.inputSchema);
    return typeof again === "string" ? { ...kept, schemaError: again } : { ...kept, inputSchema: again.schema, ...(again.partial ? { partial: true } : {}) };
  }
  const p = prepSchema(o.inputSchema); // a fresh tools/list entry
  return { name: o.name, description, annotations, schema: compactSchema(o.inputSchema), ...(typeof p === "string" ? { schemaError: p } : { inputSchema: p.schema, ...(p.partial ? { partial: true } : {}) }) };
}

// Keywords whose values are subschemas (single, list, or name → schema map); walked to drop regex-running parts.
const SUB = ["additionalProperties", "items", "contains", "not", "if", "then", "else", "propertyNames", "unevaluatedProperties", "unevaluatedItems", "additionalItems"];
const SUB_LIST = ["allOf", "anyOf", "oneOf", "prefixItems", "items"];
const SUB_MAP = ["properties", "$defs", "definitions", "dependentSchemas", "dependencies"];
/** Copy of `s` with every `pattern` removed (partial: some were). Refuses `patternProperties` outright: Ajv's additionalProperties
 *  code runs those regexes on every argument key even with the keyword removed, so a hostile schema could hang ORBIT. */
function stripRegex(s: unknown, found = { partial: false }): unknown {
  if (Array.isArray(s)) return s.map((x) => stripRegex(x, found));
  if (!s || typeof s !== "object") return s;
  const o = { ...(s as Record<string, unknown>) };
  if ("patternProperties" in o) throw new Error("its input schema uses patternProperties (regex keys ORBIT won't evaluate)");
  if (typeof o.pattern === "string") { delete o.pattern; found.partial = true; }
  for (const k of SUB) if (o[k] && typeof o[k] === "object" && !Array.isArray(o[k])) o[k] = stripRegex(o[k], found);
  for (const k of SUB_LIST) if (Array.isArray(o[k])) o[k] = (o[k] as unknown[]).map((x) => stripRegex(x, found));
  for (const k of SUB_MAP) if (o[k] && typeof o[k] === "object") o[k] = Object.fromEntries(Object.entries(o[k] as Record<string, unknown>).map(([n, v]) => [n, stripRegex(v, found)]));
  return o;
}

/** The schema ORBIT keeps and checks with, or why it can't. Validates size/type, drops regexes, compiles once. */
function prepSchema(raw: unknown): { schema: Record<string, unknown>; partial: boolean } | string {
  const full = fullSchema(raw);
  if (typeof full === "string") return full;
  const found = { partial: false };
  let schema: Record<string, unknown>;
  try { schema = stripRegex(full, found) as Record<string, unknown>; } catch (e) { return (e as Error).message; }
  const v = validator(schema);
  return typeof v === "string" ? v : { schema, partial: found.partial };
}

const SCHEMA_MAX = 16_000; // chars of JSON; a bigger schema makes the tool unusable (refused with a clear reason), never unchecked
/** The server's inputSchema as-is, or why ORBIT can't check it. A missing schema means "no arguments" ({type: object}). */
function fullSchema(s: unknown): Record<string, unknown> | string {
  if (s === undefined) return { type: "object" };
  if (!s || typeof s !== "object" || Array.isArray(s)) return "its input schema isn't a JSON object";
  const o = s as Record<string, unknown>;
  if (o.type !== undefined && o.type !== "object") return `its input schema has type ${JSON.stringify(o.type).slice(0, 40)}, not object`;
  let json: string;
  try { json = JSON.stringify(o); } catch { return "its input schema can't be read as JSON"; }
  return json.length <= SCHEMA_MAX ? (JSON.parse(json) as Record<string, unknown>) : `its input schema is ${json.length} chars (ORBIT checks up to ${SCHEMA_MAX})`;
}

// Draft-07 by default; a schema that declares 2019-09/2020-12 gets Ajv2020 (rmcp/schemars and zod v4 emit those). The kept schema
// has its regexes stripped (stripRegex), and these keywords are removed too as a second guard. Formats aren't loaded.
const mk = <T extends Ajv>(a: T) => { for (const k of ["pattern", "patternProperties"]) a.removeKeyword(k); return a; };
const ajv07 = mk(new Ajv({ strict: false, allErrors: true }));
const ajv20 = mk(new Ajv2020({ strict: false, allErrors: true }) as unknown as Ajv);
const compiled = new Map<string, ValidateFunction | string>();
function validator(schema: Record<string, unknown>): ValidateFunction | string {
  const key = JSON.stringify(schema);
  if (!compiled.has(key)) {
    if (compiled.size > 500) compiled.clear(); // shortcut: whole-cache reset; schemas change only on Test connection
    const { $schema, ...body } = schema;
    const a = typeof $schema === "string" && /2019-09|2020-12/.test($schema) ? ajv20 : ajv07;
    try { compiled.set(key, a.compile(body)); } catch (e) { compiled.set(key, `its input schema doesn't compile (${e instanceof Error ? e.message.slice(0, 120) : "error"})`); }
  }
  return compiled.get(key)!;
}

/** CORE's arguments against the tool's cached schema, before anything runs or queues. null = fine. Fails closed: a schema that
 *  can't be checked refuses the call. `t` without inputSchema and schemaError = cached before schemas were kept (unchecked). */
export function checkArgs(t: Pick<CachedTool, "inputSchema" | "schemaError"> | undefined, args: Record<string, unknown>): string | null {
  if (t?.schemaError) return `ORBIT can't check its arguments: ${t.schemaError}. It stays off until the server fixes it (then Test connection)`;
  if (!t?.inputSchema) return null;
  const v = validator(t.inputSchema);
  if (typeof v === "string") return `ORBIT can't check its arguments: ${v}`;
  if (v(args)) return null;
  return "arguments don't match its schema: " + (v.errors ?? []).slice(0, 4).map((e) => `${e.instancePath || "(arguments)"} ${e.message ?? "is invalid"}${e.params && "allowedValues" in e.params ? ` (${(e.params.allowedValues as unknown[]).map((x) => JSON.stringify(x)).join(", ")})` : ""}`).join("; ");
}

/** Profile → Plugins: is this tool's input checked? */
