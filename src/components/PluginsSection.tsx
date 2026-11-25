"use client";
import { plainError } from "@/lib/api-error-pure";
import { useCallback, useEffect, useState } from "react";
import { pollMs } from "@/lib/poll-pure";
import { usePoll } from "./use-poll";
import { takePluginsReturn, type Gate, type Mode, type Pending, type SUGGESTED } from "@/lib/plugins-pure";
import { askConfirm } from "./ui/Dialog";
import { tr as trOut, useT } from "./i18n";
import type { Key } from "@/lib/i18n-en-pure";

type Tool = Gate & { id: string; name: string; description: string; check: "checked" | "partial" | "unchecked" | "refused"; schemaError?: string };
type P = { name: string; command?: string; args: string[]; url?: string; env: Record<string, string>; headers?: Record<string, string>; oauth?: boolean; signedIn?: boolean; enabled: boolean; local: boolean; others?: Mode; timeoutSec: number; note?: string;
  cache?: { at: string; error?: string }; tools: Tool[]; settings: Record<string, Mode> };
export type PluginsView = { plugins: P[]; pending: Pending[]; suggested: typeof SUGGESTED; vault: string; stopAll: boolean; out?: string; tested?: number };

export async function pluginsCall(body?: object): Promise<PluginsView> {
  const r = await fetch("/api/plugins", body ? { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) } : undefined);
  const j = await r.json().catch(() => null);
  if (!r.ok || !j) throw new Error(j?.error ?? "Couldn't load Plugins");
  return j;
}

const TIER_TEXT: Record<string, Key> = { T0: "plg.t0", T1: "plg.t1", T2: "plg.t2", T3: "plg.t3" };

const SIGNIN: Record<string, Key> = { "signed-in": "plg.si.ok", "signin-cancelled": "plg.si.cancel", "signin-state": "plg.si.state", "signin-exchange": "plg.si.exchange" };

/** Profile → Plugins: MCP servers CORE may use, per-tool trust (auto / ask / off), Test connection, and calls waiting for his Run click. */
export function PluginsSection() {
  const [v, setV] = useState<PluginsView | null>(null);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState("");
  const [out, setOut] = useState("");
  const [draft, setDraft] = useState("");
  const { t: tr } = useT();
  const call = useCallback(async (body?: object, label = "") => {
    if (body) { setErr(""); setBusy(label); } // a background poll never touches busy: it would re-enable Run on a call still running
    try { const j = await pluginsCall(body); setV(j); if (j.out !== undefined) setOut(j.out); if (j.tested !== undefined) setOut(trOut("plg.connected", { n: j.tested })); return true; }
    catch (e) { setErr(plainError(e, trOut("plg.failed"))); return false; } finally { if (body) setBusy(""); }
  }, []);
  const poll = useCallback(() => void call(), [call]);
  useEffect(() => { // the sign-in route comes back to /?plugins=<result>
    const { result: q, rest } = takePluginsReturn(location.search);
    if (q !== null) history.replaceState(history.state, "", `${location.pathname}${rest}${location.hash}`);
    const m = q && SIGNIN[q] && trOut(SIGNIN[q]);
    if (m) { if (q === "signed-in") setOut(m); else setErr(m); }
  }, []);
  usePoll(poll, pollMs(30_000));

  async function add() {
    let plugin: unknown;
    try { plugin = JSON.parse(draft); } catch { setErr(tr("plg.badJson")); return; }
    if (await call({ action: "add", plugin }, "add")) setDraft("");
  }

  return (
    <section className="space-y-3" aria-labelledby="plugins-title">
      <h3 id="plugins-title" className="text-sm font-semibold">{tr("plg.title")}</h3>
      <p className="muted text-sm">{tr("plg.introA")} <b>auto</b> {tr("plg.introB")} <b>ask</b> {tr("plg.introC")} <b>off</b>. {tr("plg.introD")}</p>
      {err && <p role="alert" className="text-sm text-red-400">{err}</p>}
      {v?.stopAll && <p className="text-sm text-amber-400">{tr("plg.stopAll")}</p>}

      {!!v?.pending.length && <div className="space-y-2" aria-label={tr("plg.waiting")}>
        <div className="muted text-[12px] font-medium">{tr("plg.waiting")}</div>
        {v.pending.map((q) => (
          <div key={q.id} className="rounded border border-amber-400/40 p-2 text-sm">
            <div><b>{q.server}</b> → {q.tool} <span className="muted text-xs">· {new Date(q.at).toLocaleString()}</span></div>
            {/* the exact arguments that will run (for Blender: the Python code) */}
            <pre className="mt-1 max-h-64 overflow-auto whitespace-pre-wrap text-xs">{typeof q.args.code === "string" ? q.args.code : JSON.stringify(q.args, null, 2)}</pre>
            {q.attempting && !q.running && busy !== q.id && <p className="mt-1 text-xs text-amber-300">{tr("plg.unfinished", { at: new Date(q.attempting).toLocaleString(), server: q.server })}</p>}
            <div className="mt-1 flex gap-2">
              <button className="chip" disabled={!!busy || v.stopAll || q.running} onClick={() => void call({ action: "run", id: q.id, ...(q.attempting ? { again: q.attempting } : {}) }, q.id)}>{busy === q.id || q.running ? tr("plg.running") : q.attempting ? tr("plg.runAgain") : tr("plg.run")}</button>
              <button className="chip" disabled={!!busy || q.running} onClick={() => void call({ action: "discard", id: q.id })}>{tr("invp.discard")}</button>
            </div>
          </div>
        ))}
      </div>}
      {out && <details open className="text-xs"><summary className="cursor-pointer">{tr("plg.last")}</summary><pre className="max-h-48 overflow-auto whitespace-pre-wrap">{out}</pre></details>}

      <ul className="space-y-2" aria-label={tr("plg.list")}>
        {v?.plugins.length === 0 && <li className="muted text-sm">{tr("plg.empty")}</li>}
        {v?.plugins.map((p) => (
          <li key={p.name} className="rounded border border-white/10 p-2 text-sm">
            <div className="flex flex-wrap items-center gap-2">
              <b>{p.name}</b>
              <span className="muted text-xs">{p.command ? `${p.command} ${p.args.join(" ")}` : p.url}{Object.keys(p.env).length ? ` · env ${Object.keys(p.env).join(", ")}` : ""}{p.headers ? ` · headers ${Object.keys(p.headers).join(", ")}` : ""}</span>
            </div>
            <div className="mt-1 flex flex-wrap items-center gap-3 text-xs">
              <label><input type="checkbox" checked={p.enabled} onChange={(e) => void call({ action: "update", name: p.name, enabled: e.target.checked })} /> {tr("plg.enabled")}</label>
              <label title={tr("plg.localTitle")}><input type="checkbox" checked={p.local} onChange={(e) => void call({ action: "update", name: p.name, local: e.target.checked })} /> {tr("plg.local")}</label>
              <button className="chip" disabled={!!busy} onClick={() => void call({ action: "test", name: p.name }, "test:" + p.name)}>{busy === "test:" + p.name ? tr("plg.connecting") : tr("plg.test")}</button>
              {p.oauth && (p.signedIn
                ? <button className="chip" disabled={!!busy} onClick={() => void call({ action: "signout", name: p.name })}>{tr("plg.signOut")}</button>
                : <a className="chip" href={`/api/plugins/oauth?name=${encodeURIComponent(p.name)}`}>{tr("plg.signIn")}</a>)}
              <button className="chip" onClick={async () => (await askConfirm(tr("plg.removeConfirm", { name: p.name }))) && void call({ action: "remove", name: p.name })}>{tr("common.remove")}</button>
            </div>
            {p.cache?.error && <p className="text-xs text-red-400">{tr("plg.testFailed", { err: p.cache.error })}</p>}
            {!p.cache && <p className="muted text-xs">{tr("plg.notTested")}</p>}
            {p.tools.some((t) => t.check === "unchecked") && <p className="text-xs text-amber-400">{tr("plg.unchecked", { n: p.tools.filter((t) => t.check === "unchecked").length })}</p>}
            {!!p.tools.length && <details className="mt-1 text-xs"><summary className="cursor-pointer">{tr("plg.toolsOn", { n: p.tools.filter((t) => t.mode !== "off").length, m: p.tools.length })}</summary>
              <ul className="mt-1 space-y-1">{p.tools.map((t) => (
                <li key={t.name} className="flex items-start justify-between gap-2">
                  <span><b>{t.name}</b> <span className="muted">· {TIER_TEXT[t.tier] ? tr(TIER_TEXT[t.tier]) : t.tier}{t.description ? ` · ${t.description.slice(0, 140)}` : ""}</span>
                    {t.check === "refused" && <span className="block text-red-400">{tr("plg.refused", { err: t.schemaError ?? "" })}</span>}
                    {t.check === "partial" && <span className="block muted">{tr("plg.partial")}</span>}</span>
                  <select aria-label={tr("plg.mode", { name: t.name })} value={p.settings[t.name] ?? ""} onChange={(e) => void call({ action: "update", name: p.name, tools: { ...p.settings, [t.name]: e.target.value || undefined } })}>
                    <option value="">{tr("plg.default", { mode: t.mode })}</option><option value="auto">auto</option><option value="ask">ask</option><option value="off">off</option>
                  </select>
                </li>))}
              </ul>
              {/* auto on a destructive tool is only possible for a local app (plugins-pure toolGate); say what it means for code tools */}
              {p.tools.some((t) => /code|python|exec|script/i.test(t.name) && t.mode === "auto") && <p className="mt-1 text-amber-400">{tr("plg.codeAuto")}</p>}
            </details>}
          </li>
        ))}
      </ul>

      <details className="text-sm">
        <summary className="cursor-pointer">{tr("plg.suggested")}</summary>
        <ul className="mt-2 space-y-2">{v?.suggested.map((s) => (
          <li key={s.title} className="rounded border border-white/10 p-2">
            <div><b>{s.title}</b> <span className="muted">· {s.about}</span></div>
            <div className="muted text-xs">{tr("plg.first", { x: s.install })}</div>
            <button className="chip mt-1" onClick={() => setDraft(JSON.stringify(s.plugin, null, 2))}>{tr("plg.fill")}</button>
          </li>))}
        </ul>
      </details>
      <details className="text-sm" open={!!draft}>
        <summary className="cursor-pointer">{tr("plg.add")}</summary>
        <p className="muted mt-1 text-xs">{tr("plg.jsonHelp", { tools: '{"tool": "auto"|"ask"|"off"}' })}</p>
        <textarea className="field mt-1 h-40 w-full font-mono text-xs" value={draft} onChange={(e) => setDraft(e.target.value)} aria-label={tr("plg.json")} placeholder='{"name": "files", "command": "npx", "args": ["-y", "@modelcontextprotocol/server-filesystem", "C:\\\\path"]}' />
        <button className="chip" disabled={!draft.trim() || !!busy} onClick={() => void add()}>{tr("common.add")}</button>
      </details>
    </section>
  );
}
