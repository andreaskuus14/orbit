"use client";
import { useCallback, useState } from "react";
import { pollMs } from "@/lib/poll-pure";
import { usePoll } from "./use-poll";
import type { Gate, Mode, Pending, SUGGESTED } from "@/lib/plugins-pure";

type Tool = Gate & { id: string; name: string; description: string; check: "checked" | "partial" | "unchecked" | "refused"; schemaError?: string };
type P = { name: string; command?: string; args: string[]; url?: string; env: Record<string, string>; enabled: boolean; local: boolean; others?: Mode; timeoutSec: number; note?: string;
  cache?: { at: string; error?: string }; tools: Tool[]; settings: Record<string, Mode> };
export type PluginsView = { plugins: P[]; pending: Pending[]; suggested: typeof SUGGESTED; vault: string; stopAll: boolean; out?: string; tested?: number };

export async function pluginsCall(body?: object): Promise<PluginsView> {
  const r = await fetch("/api/plugins", body ? { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) } : undefined);
  const j = await r.json().catch(() => null);
  if (!r.ok || !j) throw new Error(j?.error ?? "Couldn't load Plugins");
  return j;
}

const TIER_TEXT: Record<string, string> = { T0: "reads", T1: "reads the web", T2: "changes things on this PC", T3: "acts outside / destructive" };

/** Profile → Plugins: MCP servers CORE may use, per-tool trust (auto / ask / off), Test connection, and calls waiting for his Run click. */
export function PluginsSection() {
  const [v, setV] = useState<PluginsView | null>(null);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState("");
  const [out, setOut] = useState("");
  const [draft, setDraft] = useState("");
  const call = useCallback(async (body?: object, label = "") => {
    if (body) { setErr(""); setBusy(label); } // a background poll never touches busy: it would re-enable Run on a call still running
    try { const j = await pluginsCall(body); setV(j); if (j.out !== undefined) setOut(j.out); if (j.tested !== undefined) setOut(`Connected: ${j.tested} tools.`); return true; }
    catch (e) { setErr(e instanceof Error ? e.message : String(e)); return false; } finally { if (body) setBusy(""); }
  }, []);
  const poll = useCallback(() => void call(), [call]);
  usePoll(poll, pollMs(30_000));

  async function add() {
    let plugin: unknown;
    try { plugin = JSON.parse(draft); } catch { setErr("The plugin text isn't valid JSON"); return; }
    if (await call({ action: "add", plugin }, "add")) setDraft("");
  }

  return (
    <section className="space-y-3" aria-labelledby="plugins-title">
      <h3 id="plugins-title" className="text-sm font-semibold">Plugins (MCP)</h3>
      <p className="muted text-sm">Programs CORE can use as tools. Each tool is <b>auto</b> (CORE may call it), <b>ask</b> (CORE only queues the exact call below; nothing runs until you click Run) or <b>off</b>. Anything that acts outside this PC always asks. Stop-all halts plugin calls too; every call is in OPERATIONS → Activity.</p>
      {err && <p role="alert" className="text-sm text-red-400">{err}</p>}
      {v?.stopAll && <p className="text-sm text-amber-400">Stop-all is on: plugin calls are paused.</p>}

      {!!v?.pending.length && <div className="space-y-2" aria-label="Waiting for your click">
        <div className="muted text-[10px] uppercase tracking-widest">Waiting for your click</div>
        {v.pending.map((q) => (
          <div key={q.id} className="rounded border border-amber-400/40 p-2 text-sm">
            <div><b>{q.server}</b> → {q.tool} <span className="muted text-xs">· {new Date(q.at).toLocaleString()}</span></div>
            {/* the exact arguments that will run (for Blender: the Python code) */}
            <pre className="mt-1 max-h-64 overflow-auto whitespace-pre-wrap text-xs">{typeof q.args.code === "string" ? q.args.code : JSON.stringify(q.args, null, 2)}</pre>
            {q.attempting && !q.running && busy !== q.id && <p className="mt-1 text-xs text-amber-300">Started {new Date(q.attempting).toLocaleString()} and never finished: it may or may not have run. Check {q.server} before running it again.</p>}
            <div className="mt-1 flex gap-2">
              <button className="chip" disabled={!!busy || v.stopAll || q.running} onClick={() => void call({ action: "run", id: q.id, ...(q.attempting ? { again: q.attempting } : {}) }, q.id)}>{busy === q.id || q.running ? "Running…" : q.attempting ? "Run again" : "Run"}</button>
              <button className="chip" disabled={!!busy || q.running} onClick={() => void call({ action: "discard", id: q.id })}>Discard</button>
            </div>
          </div>
        ))}
      </div>}
      {out && <details open className="text-xs"><summary className="cursor-pointer">Last result</summary><pre className="max-h-48 overflow-auto whitespace-pre-wrap">{out}</pre></details>}

      <ul className="space-y-2" aria-label="Plugins">
        {v?.plugins.length === 0 && <li className="muted text-sm">No plugins yet. Add one from Suggested below.</li>}
        {v?.plugins.map((p) => (
          <li key={p.name} className="rounded border border-white/10 p-2 text-sm">
            <div className="flex flex-wrap items-center gap-2">
              <b>{p.name}</b>
              <span className="muted text-xs">{p.command ? `${p.command} ${p.args.join(" ")}` : p.url}{Object.keys(p.env).length ? ` · env ${Object.keys(p.env).join(", ")}` : ""}</span>
            </div>
            <div className="mt-1 flex flex-wrap items-center gap-3 text-xs">
              <label><input type="checkbox" checked={p.enabled} onChange={(e) => void call({ action: "update", name: p.name, enabled: e.target.checked })} /> enabled</label>
              <label title="A program on this PC that doesn't reach the internet. Only then can its changing tools run without asking."><input type="checkbox" checked={p.local} onChange={(e) => void call({ action: "update", name: p.name, local: e.target.checked })} /> local app only</label>
              <button className="chip" disabled={!!busy} onClick={() => void call({ action: "test", name: p.name }, "test:" + p.name)}>{busy === "test:" + p.name ? "Connecting…" : "Test connection"}</button>
              <button className="chip" onClick={() => confirm(`Remove plugin ${p.name}?`) && void call({ action: "remove", name: p.name })}>Remove</button>
            </div>
            {p.cache?.error && <p className="text-xs text-red-400">Last test failed: {p.cache.error}</p>}
            {!p.cache && <p className="muted text-xs">Not tested yet: CORE sees its tools after Test connection.</p>}
            {p.tools.some((t) => t.check === "unchecked") && <p className="text-xs text-amber-400">Arguments aren&apos;t checked yet for {p.tools.filter((t) => t.check === "unchecked").length} tool(s): Test connection again to load their full schemas.</p>}
            {!!p.tools.length && <details className="mt-1 text-xs"><summary className="cursor-pointer">{p.tools.filter((t) => t.mode !== "off").length} of {p.tools.length} tools on</summary>
              <ul className="mt-1 space-y-1">{p.tools.map((t) => (
                <li key={t.name} className="flex items-start justify-between gap-2">
                  <span><b>{t.name}</b> <span className="muted">· {TIER_TEXT[t.tier]}{t.description ? ` · ${t.description.slice(0, 140)}` : ""}</span>
                    {t.check === "refused" && <span className="block text-red-400">Off: ORBIT can&apos;t check its arguments ({t.schemaError}).</span>}
                    {t.check === "partial" && <span className="block muted">Arguments checked, except text patterns: the program checks those itself.</span>}</span>
                  <select aria-label={`${t.name} mode`} value={p.settings[t.name] ?? ""} onChange={(e) => void call({ action: "update", name: p.name, tools: { ...p.settings, [t.name]: e.target.value || undefined } })}>
                    <option value="">default ({t.mode})</option><option value="auto">auto</option><option value="ask">ask</option><option value="off">off</option>
                  </select>
                </li>))}
              </ul>
              {/* auto on a destructive tool is only possible for a local app (plugins-pure toolGate); say what it means for code tools */}
              {p.tools.some((t) => /code|python|exec|script/i.test(t.name) && t.mode === "auto") && <p className="mt-1 text-amber-400">A code tool is on auto: CORE can run any code in this program without asking. Save your work often.</p>}
            </details>}
          </li>
        ))}
      </ul>

      <details className="text-sm">
        <summary className="cursor-pointer">Suggested plugins</summary>
        <ul className="mt-2 space-y-2">{v?.suggested.map((s) => (
          <li key={s.title} className="rounded border border-white/10 p-2">
            <div><b>{s.title}</b> <span className="muted">· {s.about}</span></div>
            <div className="muted text-xs">First: {s.install}</div>
            <button className="chip mt-1" onClick={() => setDraft(JSON.stringify(s.plugin, null, 2))}>Fill the form</button>
          </li>))}
        </ul>
      </details>
      <details className="text-sm" open={!!draft}>
        <summary className="cursor-pointer">Add a plugin</summary>
        <p className="muted mt-1 text-xs">JSON: name, command + args (a program on this PC) or url (https), env, local, tools {"{"}"tool": "auto"|"ask"|"off"{"}"}, others (default for unlisted tools). Saved only on this PC (plugins.json in ORBIT&apos;s data folder), never in git.</p>
        <textarea className="field mt-1 h-40 w-full font-mono text-xs" value={draft} onChange={(e) => setDraft(e.target.value)} aria-label="Plugin JSON" placeholder='{"name": "files", "command": "npx", "args": ["-y", "@modelcontextprotocol/server-filesystem", "C:\\\\path"]}' />
        <button className="chip" disabled={!draft.trim() || !!busy} onClick={() => void add()}>Add</button>
      </details>
    </section>
  );
}
