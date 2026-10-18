"use client";
import { useState } from "react";
import { approvedText, SCRIPT_KINDS, PARENTS, MAX_INPUT, type LuauMode, type ScriptKind, type DiffLine, type LintFlag } from "@/lib/luau-pure";

// DevWorld → Luau Code Helper: write, fix or explain Roblox scripts, review changes line by line, copy only approved lines.
const PINK = "#f472b6";
const MODES: [LuauMode, string][] = [["write", "✍️ Write"], ["fix", "🩹 Fix"], ["explain", "📖 Explain"]];

type Result =
  | { mode: "explain"; text: string }
  | { mode: "write" | "fix"; code: string; notes: string[]; flags: LintFlag[]; diff: DiffLine[] | null };

export default function CodeHelper() {
  const [mode, setMode] = useState<LuauMode>("write");
  const [request, setRequest] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [kind, setKind] = useState<ScriptKind>("Script");
  const [parent, setParent] = useState<string>("ServerScriptService");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [res, setRes] = useState<Result | null>(null);
  const [rejected, setRejected] = useState<Set<number>>(new Set());
  const [copied, setCopied] = useState(false);

  const size = request.length + code.length + error.length;
  const ready = mode === "write" ? !!request.trim() : !!code.trim();

  async function run() {
    setBusy(true); setErr(""); setRes(null); setRejected(new Set()); setCopied(false);
    const body = mode === "write" ? { mode, request, kind, parent } : mode === "fix" ? { mode, code, error, kind } : { mode, code };
    try {
      const r = await fetch("/api/luau", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || `Failed (${r.status})`);
      setRes(j as Result);
    } catch (e) { setErr(e instanceof Error ? e.message : "Couldn't reach ORBIT"); } finally { setBusy(false); }
  }

  function toggle(i: number) {
    setCopied(false);
    setRejected((s) => { const n = new Set(s); if (n.has(i)) n.delete(i); else n.add(i); return n; });
  }

  async function copy() {
    if (!res || res.mode === "explain") return;
    try { await navigator.clipboard.writeText(res.diff ? approvedText(res.diff, rejected) : res.code); setCopied(true); }
    catch { setErr("Clipboard blocked: select the code and copy it manually"); }
  }

  const changed = res && res.mode !== "explain" && res.diff ? res.diff.filter((d) => d.op !== " ").length : 0;
  return (
    <section className="w-full max-w-[420px] space-y-3" aria-labelledby="ch-title">
      <h2 id="ch-title" className="text-base font-semibold" style={{ color: PINK }}>🧩 Luau Code Helper</h2>
      <div className="flex gap-1.5" role="group" aria-label="Mode">
        {MODES.map(([m, label]) => (
          <button key={m} className="chip" aria-pressed={mode === m} onClick={() => { setMode(m); setRes(null); setErr(""); }}
            style={mode === m ? { borderColor: PINK, color: PINK } : undefined}>{label}</button>
        ))}
      </div>

      <form className="space-y-2" onSubmit={(e) => { e.preventDefault(); if (ready && !busy) void run(); }}>
        {mode === "write" && <>
          <label htmlFor="ch-req" className="sr-only">What should the script do?</label>
          <textarea id="ch-req" className="field h-24 w-full" value={request} maxLength={MAX_INPUT} onChange={(e) => setRequest(e.target.value)}
            placeholder="A coin that spins and gives 10 coins on touch, server-side, with a debounce" />
        </>}
        {mode !== "write" && <>
          <label htmlFor="ch-code" className="sr-only">Paste your Luau code</label>
          <textarea id="ch-code" className="field h-40 w-full font-mono text-xs" value={code} maxLength={MAX_INPUT} spellCheck={false}
            onChange={(e) => setCode(e.target.value)} placeholder="Paste your script here…" />
        </>}
        {mode === "fix" && <>
          <label htmlFor="ch-err" className="sr-only">Error from the Output window</label>
          <textarea id="ch-err" className="field h-16 w-full font-mono text-xs" value={error} maxLength={MAX_INPUT} spellCheck={false}
            onChange={(e) => setError(e.target.value)} placeholder="Error from Output (optional), e.g. attempt to index nil with 'Humanoid'" />
        </>}
        {mode !== "explain" && (
          <div className="flex gap-2">
            <select className="field flex-1" value={kind} aria-label="Script type" onChange={(e) => setKind(e.target.value as ScriptKind)}>
              {SCRIPT_KINDS.map((k) => <option key={k}>{k}</option>)}
            </select>
            {mode === "write" && (
              <select className="field flex-1" value={parent} aria-label="Where it goes" onChange={(e) => setParent(e.target.value)}>
                {PARENTS.map((p) => <option key={p}>{p}</option>)}
              </select>
            )}
          </div>
        )}
        <div className="flex items-center justify-between gap-2">
          <span className={`text-xs ${size > MAX_INPUT ? "error" : "muted"}`}>{size.toLocaleString("en")} / {MAX_INPUT.toLocaleString("en")}</span>
          <button className="btn" disabled={busy || !ready || size > MAX_INPUT}>{busy ? "Thinking…" : mode === "write" ? "Write code" : mode === "fix" ? "Fix it" : "Explain"}</button>
        </div>
      </form>

      {err && <p className="error text-sm" role="alert">{err}</p>}
      <div aria-live="polite" aria-busy={busy}>
        {busy && <p className="muted text-sm">{mode === "explain" ? "Reading your code…" : "Writing Luau (the smart model can take a minute)…"}</p>}
        {res?.mode === "explain" && <div className="whitespace-pre-wrap text-sm leading-relaxed">{res.text}</div>}
        {res && res.mode !== "explain" && (
          <div className="space-y-2">
            {res.flags.length > 0 && (
              <ul className="space-y-1 rounded-lg border border-amber-400/50 bg-amber-400/10 p-2 text-xs" aria-label="Warnings">
                {res.flags.map((f, i) => <li key={i}>{f.rule === "api" || f.rule === "deprecated" ? "📘" : "⚠️"} <b>Line {f.line}:</b> {f.message}</li>)}
              </ul>
            )}
            {res.diff ? <>
              <p className="muted text-xs">{changed} {res.mode === "fix" ? "changed" : "new"} line{changed === 1 ? "" : "s"} · untick any you don&apos;t want</p>
              <ol className="max-h-80 overflow-auto rounded-lg bg-black/40 p-1 font-mono text-[11px] leading-snug">
                {res.diff.map((d, i) => {
                  const bg = d.op === "+" ? "rgba(74,222,128,.12)" : d.op === "-" ? "rgba(248,113,113,.14)" : undefined;
                  const off = rejected.has(i);
                  return (
                    <li key={i} className="flex items-start gap-1" style={{ background: bg, opacity: off ? 0.45 : 1 }}>
                      {d.op === " " ? <span className="w-4 shrink-0" />
                        : <input type="checkbox" className="mt-0.5 shrink-0" checked={!off} onChange={() => toggle(i)}
                            aria-label={`${d.op === "+" ? "Add" : "Remove"} line: ${d.text.trim() || "(blank)"}`} style={{ accentColor: PINK }} />}
                      <span className="w-3 shrink-0 select-none muted">{d.op}</span>
                      <span className={`whitespace-pre ${off && d.op === "+" ? "line-through" : ""}`}>{d.text || " "}</span>
                    </li>
                  );
                })}
              </ol>
            </> : <>
              <p className="muted text-xs">Too long for line-by-line review (over 600 lines): copying takes the whole result.</p>
              <pre className="max-h-80 overflow-auto rounded-lg bg-black/40 p-2 text-[11px]">{res.code}</pre>
            </>}
            <button className="btn w-full" onClick={() => void copy()} style={{ borderColor: PINK }}>{copied ? "✓ Copied" : res.diff ? "Copy approved code" : "Copy code"}</button>
            {res.notes.length > 0 && <ul className="list-disc space-y-0.5 pl-5 text-xs">{res.notes.map((n, i) => <li key={i}>{n}</li>)}</ul>}
          </div>
        )}
      </div>
      <p className="muted text-xs">Copy into a Script in Studio — direct apply comes later.</p>
    </section>
  );
}
