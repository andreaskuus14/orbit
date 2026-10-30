// Live work view for a CORE turn: each step as a plain-language line with its key detail and time, redacted so private
// content never shows (only "read a private note") and outside text shows only as titles/domains. Pure: tests and browser.
import { stepLabel } from "./core-ui.ts";

export type StepDone = { out: string; ms: number; ok: boolean };
export type LiveStart = { type: "step"; id: number; tool: string; label: string; key?: string; vars?: Record<string, string>; detail?: string; t: number };
export type LiveDone = { type: "step_done"; id: number; ok: boolean; ms: number; result?: string; t: number };
export type LiveEvent = LiveStart | LiveDone;

const clip = (s: string, n: number) => { const x = s.replace(/\s+/g, " ").trim(); return x.length > n ? x.slice(0, n - 1) + "…" : x; };
export const domainOf = (u: unknown) => { try { return new URL(String(u)).hostname.replace(/^www\./, ""); } catch { return ""; } };
export const sizeOf = (n: number) => (n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1048576).toFixed(1)} MB`);
/** "1m 40s", "4.2s", "0.3s". */
export const fmtMs = (ms: number) => (ms >= 60_000 ? `${Math.floor(ms / 60_000)}m ${Math.round((ms % 60_000) / 1000)}s` : `${(ms / 1000).toFixed(1)}s`);

function files(v: unknown): string {
  if (!Array.isArray(v)) return "";
  const list = v.filter((f) => f && typeof f.path === "string").map((f) => `${f.path.split("/").pop()} (${sizeOf(new TextEncoder().encode(String(f.content ?? "")).length)})`);
  return clip(list.slice(0, 4).join(", ") + (list.length > 4 ? ` +${list.length - 4}` : ""), 120);
}

// Tools that send text out: their query/request is hidden once private data is in the turn (it could carry it).
const OUTBOUND = new Set(["web_search", "read_news", "ask_agent", "save_memory"]);
// Client i18n keys (live.<tool>); every other tool shows the English stepLabel.
const KEYED = new Set(["search_memory", "think", "web_search", "fetch_url", "read_news", "ask_agent", "save_memory", "ws_write", "ws_create", "review", "navigate"]);

/** The line for a step that just started. priv: the tool reads private data (LIFE, journal, business…); tainted: private data is already in this turn. */
export function liveStep(tool: string, input: Record<string, unknown>, priv: boolean, tainted = false): Omit<LiveStart, "type" | "id" | "t" | "tool"> {
  if (priv) return { key: "live.private", label: "Reading a private note…" };
  const s = (k: string) => (typeof input[k] === "string" ? (input[k] as string) : "");
  const detail = tainted && OUTBOUND.has(tool) ? ""
    : tool === "web_search" || tool === "read_news" ? clip(s("query"), 80)
    : tool === "fetch_url" ? domainOf(input.url)
    : tool === "ask_agent" ? clip(s("request"), 80)
    : tool === "save_memory" ? clip(s("title"), 60)
    : tool === "ws_write" ? files(input.files)
    : tool === "ws_create" || tool === "ws_run" ? clip(s("name") || s("workspace"), 40)
    : "";
  const agent = s("agent") ? s("agent")[0].toUpperCase() + s("agent").slice(1) : "";
  return { label: stepLabel(tool, input), ...(KEYED.has(tool) && (tool !== "ask_agent" || agent) && { key: `live.${tool}` }), ...(tool === "ask_agent" && agent && { vars: { agent } }), ...(detail && { detail }) };
}

/** A finished step's short result: counts, ORBIT's own check line, a page title or result domains; never page/agent/private text. */
export function liveResult(tool: string, out: string, priv: boolean): string {
  if (priv || out.startsWith("Error:")) return "";
  if (tool === "search_memory") return clip(out, 40);
  const check = /^Check: ([^\n]+)/m.exec(out);
  if (check) return clip(check[1].replace(/\. Give the user.*$/, ""), 120);
  if (tool === "fetch_url") return clip(/^TITLE: (.+)$/m.exec(out)?.[1] ?? "", 80);
  if (tool === "web_search" || tool === "read_news") {
    const d = [...new Set((out.match(/https?:\/\/[^\s)\]>"']+/g) ?? []).map(domainOf).filter(Boolean))];
    return d.slice(0, 3).join(", ") + (d.length > 3 ? ` +${d.length - 3}` : "");
  }
  return "";
}

// Steps with no explicit end (model thinking, the self-check): they end when the next step starts.
const IMPLICIT = new Set(["think", "review"]);

/** Per turn: numbers steps, times them, and closes thinking when the next step starts. priv(tool, input) marks private reads. */
export function liveTracker(priv: (tool: string, input: Record<string, unknown>) => boolean, tainted = false, now = Date.now) {
  const t0 = now();
  let n = 0;
  const open = new Map<number, { tool: string; at: number; priv: boolean }>();
  const close = (pick: (tool: string) => boolean): LiveDone[] => [...open].filter(([, s]) => pick(s.tool)).map(([id, s]) => {
    open.delete(id);
    return { type: "step_done", id, ok: true, ms: now() - s.at, t: now() - t0 };
  });
  return {
    start(tool: string, input: Record<string, unknown> = {}): LiveEvent[] {
      const p = priv(tool, input);
      const evs: LiveEvent[] = close((t) => IMPLICIT.has(t));
      const id = ++n;
      open.set(id, { tool, at: now(), priv: p });
      evs.push({ type: "step", id, tool, t: now() - t0, ...liveStep(tool, input, p, tainted) });
      if (p) tainted = true;
      return evs;
    },
    finish(tool: string, d: StepDone): LiveEvent[] {
      const id = [...open].reverse().find(([, s]) => s.tool === tool)?.[0];
      if (id === undefined) return [];
      const s = open.get(id)!;
      open.delete(id);
      const result = liveResult(tool, d.out, s.priv);
      return [{ type: "step_done", id, ok: d.ok, ms: d.ms, t: now() - t0, ...(result && { result }) }];
    },
    /** Turn over: close whatever is still open. */
    end: (): LiveEvent[] => close(() => true),
  };
}

// --- client side: the list the activity view renders ---
export type LiveRow = { id: number; tool: string; label: string; key?: string; vars?: Record<string, string>; detail?: string; at: number; ms?: number; ok?: boolean; result?: string };

/** Applies one stream event to the rows (immutable). `at` = the event's server time (ms since the turn started). */
export function applyLive(rows: LiveRow[], ev: LiveEvent): LiveRow[] {
  if (ev.type === "step") return [...rows, { id: ev.id, tool: ev.tool, label: ev.label, key: ev.key, vars: ev.vars, detail: ev.detail, at: ev.t }];
  return rows.map((r) => (r.id === ev.id ? { ...r, ms: ev.ms, ok: ev.ok, result: ev.result } : r));
}

/** "12 steps · 1m 40s" parts. */
export const liveSummary = (rows: LiveRow[], totalMs: number) => ({ n: rows.length, time: fmtMs(totalMs) });

/** NDJSON response body: every event is written as it is sent, so the client sees steps while `run` is still working. */
export function ndjsonStream(run: (send: (ev: Record<string, unknown>) => void) => Promise<void>, onCancel: () => void): ReadableStream<Uint8Array> {
  const enc = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    async start(ctrl) {
      const send = (ev: Record<string, unknown>) => { try { ctrl.enqueue(enc.encode(JSON.stringify(ev) + "\n")); } catch { /* client gone */ } };
      try { await run(send); } finally { try { ctrl.close(); } catch { /* already cancelled */ } }
    },
    cancel() { onCancel(); },
  });
}
