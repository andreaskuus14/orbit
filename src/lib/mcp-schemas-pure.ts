// Real JSON schemas for CORE's most-used tools on the MCP engine (core-mcp-pure mcpToolList), plus the arg clean-up that runs before
// each runner: JSON-string arrays/objects/numbers become real values (a live run sent lead_create's `leads` as a string), required
// props and basic types are checked with an error that says how to call it. Tools without a schema pass through as before.
// Tests: tests/mcp-schemas-pure.test.ts.
type Prop = { type: "string" | "number" | "boolean" | "array" | "object"; enum?: string[]; items?: Prop; properties?: Record<string, Prop>; required?: string[]; description?: string };
export type Schema = { type: "object"; properties: Record<string, Prop>; required: string[]; additionalProperties: true };

const str: Prop = { type: "string" }, num: Prop = { type: "number" };
const en = (...v: string[]): Prop => ({ type: "string", enum: v });
const obj = (properties: Record<string, Prop>, required: string[] = []): Prop => ({ type: "object", properties, required });
const S = (required: string[], properties: Record<string, Prop>): Schema => ({ type: "object", properties, required, additionalProperties: true });
const lead = { name: str, city: str, website: str, phone: str, email: str, source_url: { ...str, description: "the page you found it on" }, notes: str };

export const SCHEMAS: Record<string, Schema> = {
  web_search: S(["query"], { query: str }),
  fetch_url: S(["url"], { url: str }),
  scrape_page: S(["url"], { url: str, mode: str, select: str }),
  read_news: S(["query"], { query: str, hours: num, country: str }),
  find_outliers: S([], { channel: str, query: str, limit: num }),
  read_more: S(["ref", "offset"], { ref: str, offset: num }),
  ask_agent: S(["agent", "request"], { agent: str, request: str }),
  save_memory: S(["title", "content"], { title: str, content: str, kind: en("note", "idea", "project", "preference", "decision", "goal"), tags: { type: "array", items: str } }),
  vault_search: S(["query"], { query: str }),
  ws_list: S([], { workspace: str }),
  ws_read: S(["workspace", "path"], { workspace: str, path: str }),
  ws_create: S(["name"], { name: str, template: str }),
  ws_write: S(["workspace", "files"], { workspace: str, files: { type: "array", items: obj({ path: str, content: str }, ["path", "content"]) } }),
  ws_run: S(["workspace"], { workspace: str }),
  // one lead, or {"leads": [up to 10]}: neither shape is required on its own
  lead_create: S([], { ...lead, leads: { type: "array", items: obj(lead, ["name", "source_url"]) } }),
  create_goal: S(["title"], { title: str, why: str, deadline: { ...str, description: "YYYY-MM-DD" }, metric: obj({ kind: en("none", "manual", "steps", "youtube_subscribers"), target: num, how: str }) }),
  local_image: S(["prompt"], { prompt: str, aspect: en("16:9", "9:16", "1:1", "4:3", "3:4", "4:5"), name: str }),
  browse: S(["url"], { url: str, actions: { type: "array", items: { type: "object" } }, screenshot: { type: "boolean" } }),
  navigate: S(["target"], { target: str, country: str, view: en("stats", "clips", "review", "none"), search: str, zoom: en("in", "out", "reset") }),
};

/** The call's shape in one line, for error messages: {"query": string, "hours"?: number}. */
export function signature(name: string): string {
  const s = SCHEMAS[name];
  if (!s) return "";
  const t = (p: Prop): string => p.enum ? p.enum.map((v) => JSON.stringify(v)).join("|") : p.type === "array" ? `[${p.items ? t(p.items) : "..."}]` : p.type === "object" && p.properties ? `{${Object.entries(p.properties).map(([k, v]) => `"${k}"${p.required?.includes(k) ? "" : "?"}: ${t(v)}`).join(", ")}}` : p.type;
  return `${name} ${t({ type: "object", properties: s.properties, required: s.required })}`;
}

const kind = (v: unknown) => (Array.isArray(v) ? "array" : v === null ? "null" : typeof v);
/** Args before the runner: JSON strings → arrays/objects/numbers/booleans where the schema wants them; then required props and
 *  top-level types. Returns the cleaned args, or an error that says how to fix the call. */
export function prepareArgs(name: string, input: Record<string, unknown>): { args: Record<string, unknown> } | { error: string } {
  const s = SCHEMAS[name];
  if (!s) return { args: input };
  const args = { ...input };
  for (const [k, p] of Object.entries(s.properties)) {
    const v = args[k];
    if (typeof v !== "string" || p.type === "string") continue;
    if (p.type === "number" && v.trim() !== "" && Number.isFinite(Number(v))) { args[k] = Number(v); continue; }
    if (p.type === "boolean" && /^(true|false)$/i.test(v.trim())) { args[k] = v.trim().toLowerCase() === "true"; continue; }
    try { const j = JSON.parse(v); if (kind(j) === p.type) args[k] = j; } catch { /* stays a string; the type check below names it */ }
  }
  const how = `Call it as: ${signature(name)}`;
  const missing = s.required.filter((k) => args[k] === undefined || args[k] === null || args[k] === "");
  if (missing.length) return { error: `Error: ${name} is missing ${missing.map((k) => `"${k}"`).join(", ")}. ${how}` };
  for (const [k, p] of Object.entries(s.properties)) {
    if (args[k] === undefined) continue;
    if (kind(args[k]) !== p.type) return { error: `Error: ${name} "${k}" must be ${p.type === "array" ? "a JSON array" : p.type === "object" ? "a JSON object" : `a ${p.type}`}, not ${kind(args[k])}. ${how}` };
    if (p.enum && !p.enum.includes(args[k] as string)) return { error: `Error: ${name} "${k}" must be one of ${p.enum.join(", ")}. ${how}` };
  }
  return { args };
}

/** A runner's own error about the arguments gets the call's shape appended, so the model can fix the call in one go. */
export function fixHint(name: string, out: string): string {
  if (!out.startsWith("Error:") || !SCHEMAS[name] || out.includes("Call it as:")) return out;
  return /\b(missing|required|invalid|must|expected|needs? an?|give|empty|not a valid|unknown (?:field|key|option))\b/i.test(out) ? `${out}\nCall it as: ${signature(name)}` : out;
}
