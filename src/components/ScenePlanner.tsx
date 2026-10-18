"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { MAX_GUI_BRIEF, MAX_MAP_REFS, PACK_MAX, PACK_MIN, guiRequest, type HistoryEntry, type Item, type PlanResult, type ScenePlan } from "@/lib/roblox-pure";
import { approvedText, type DiffLine, type LintFlag } from "@/lib/luau-pure";
import type { BoardItem, Style } from "@/lib/refs-pure";
import { PINK, ScanPanel, call, scanTargets, type Built } from "./RobloxBuild";

type Plan = PlanResult & { planId: string; expiresAt: number; scene?: ScenePlan; thumbs?: Record<string, string> };
type Mode = "scene" | "map" | "pack" | "gui";
const btn = { background: `linear-gradient(90deg, ${PINK}, #db2777)`, boxShadow: `0 0 18px ${PINK}55` };
const v3 = (v: number[]) => v.map((n) => Math.round(n)).join(", ");
const on = (a: boolean) => (a ? { borderColor: PINK, color: PINK } : undefined);
const MODES: [Mode, string][] = [["scene", "🏕 Scene"], ["map", "🗺 Map from board"], ["pack", "🌲 Asset pack"], ["gui", "🖥 GUI"]];
const HINT: Record<Exclude<Mode, "gui">, string> = {
  scene: "A cosy campsite with a tent, a campfire and pine trees by a lake",
  map: "A small island hub: spawn beach, a pine forest, a village with a shop",
  pack: "Tree set: pines, oaks and birches",
};

/** GAME DEV → Scene / Map / Pack: plan (read-only, Creator Store search) → untick → build only the ticked ones → auto free-model scan; GUI writes a Luau script to paste. */
export default function ScenePlanner() {
  const [mode, setMode] = useState<Mode>("scene");
  const [prompt, setPrompt] = useState("");
  const [count, setCount] = useState(6);
  const [refs, setRefs] = useState<{ board: BoardItem[]; style: Style } | null>(null);
  const [picked, setPicked] = useState<string[]>([]); // titles of the references chosen for a map
  const [plan, setPlan] = useState<Plan | null>(null);
  const [ticked, setTicked] = useState<boolean[]>([]);
  const [built, setBuilt] = useState<Built | null>(null);
  const [busy, setBusy] = useState<"" | "plan" | "build">("");
  const [err, setErr] = useState("");
  const [histKey, setHistKey] = useState(0);
  const text = prompt.trim();

  useEffect(() => {
    if ((mode !== "map" && mode !== "gui") || refs) return;
    fetch("/api/refs", { cache: "no-store" }).then((r) => r.json()).then((j: { board?: BoardItem[]; style?: Style }) => setRefs({ board: j.board ?? [], style: j.style ?? { items: [], summary: "", keywords: [], updatedAt: "" } }))
      .catch(() => setRefs({ board: [], style: { items: [], summary: "", keywords: [], updatedAt: "" } }));
  }, [mode, refs]);
  const refTitles = useMemo(() => [...new Set([...(refs?.style.items ?? []), ...(refs?.board ?? [])].map((r) => r.title))], [refs]);

  const switchMode = (m: Mode) => { setMode(m); setPlan(null); setBuilt(null); setErr(""); };
  const item = (): Item => mode === "map" ? { kind: "map", prompt: text, style: refs?.style.summary ?? "", refs: picked }
    : mode === "pack" ? { kind: "pack", prompt: text, count } : { kind: "scene", prompt: text };

  const doPlan = async () => {
    setBusy("plan"); setErr(""); setPlan(null); setBuilt(null);
    try {
      const p = await call<Plan>({ method: "POST", body: JSON.stringify({ action: "plan", item: item() }) });
      if (!p.ready || !p.scene) setErr(p.notes || "Studio isn't ready. Open Roblox Studio with your place and enable the MCP plugin.");
      else { setPlan(p); setTicked([...p.scene.objects, ...(p.scene.generate ?? [])].map(() => true)); }
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(""); }
  };

  const doBuild = async () => {
    if (!plan) return;
    if (Date.now() > plan.expiresAt) { setErr("This plan expired (plans last 10 minutes). Make a new plan."); setPlan(null); return; }
    setBusy("build"); setErr("");
    try {
      const keep = ticked.flatMap((t, i) => (t ? [i] : []));
      setBuilt(await call<Built>({ method: "POST", body: JSON.stringify({ action: "build", planId: plan.planId, keep }) }));
      setPlan(null); // plans are single use
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(""); setHistKey((k) => k + 1); }
  };

  const autoScan = useMemo(() => (built?.done ? scanTargets(built) : null), [built]);
  const count2 = ticked.filter(Boolean).length;
  const objs = plan?.scene?.objects ?? [], gens = plan?.scene?.generate ?? [];
  const tick = (i: number) => (e: React.ChangeEvent<HTMLInputElement>) => setTicked((t) => t.map((x, j) => (j === i ? e.target.checked : x)));
  const noun = mode === "map" ? "map" : mode === "pack" ? "pack" : "scene";

  return (
    <section className="glass grid gap-2 rounded-xl p-3 text-sm" style={{ borderColor: `${PINK}44`, maxWidth: 420 }} aria-label="Scene, map and asset builder">
      <div className="flex flex-wrap gap-1" role="group" aria-label="What to build">
        {MODES.map(([m, label]) => <button key={m} className="chip" aria-pressed={mode === m} style={on(mode === m)} onClick={() => switchMode(m)} disabled={!!busy}>{label}</button>)}
      </div>

      {mode === "gui" ? <GuiWriter style={refs?.style.summary ?? ""} /> : (
        <>
          <textarea className="field text-xs" rows={2} maxLength={200} value={prompt} onChange={(e) => { setPrompt(e.target.value); setPlan(null); }}
            placeholder={HINT[mode]} aria-label={mode === "pack" ? "Pack theme" : mode === "map" ? "Map brief" : "Describe the scene"} />
          {mode === "pack" && (
            <label className="text-xs">Variants{" "}
              <input type="number" className="field w-16 py-1 text-xs" min={PACK_MIN} max={PACK_MAX} value={count}
                onChange={(e) => { setPlan(null); setCount(Math.min(PACK_MAX, Math.max(PACK_MIN, Math.round(Number(e.target.value) || PACK_MIN)))); }} />
              <span className="muted"> ({PACK_MIN}–{PACK_MAX}, free models first, at most 3 generated)</span>
            </label>
          )}
          {mode === "map" && (
            <div className="grid gap-1 text-xs">
              <p className="muted">Style: {refs?.style.summary ? <span style={{ color: PINK }}>{refs.style.summary}</span> : "none locked yet (lock one with 🎯 on the References tab)"}</p>
              {refTitles.length > 0 && <>
                <p className="muted">Use these references ({picked.length}/{MAX_MAP_REFS}):</p>
                <div className="flex flex-wrap gap-1">
                  {refTitles.slice(0, 40).map((t) => {
                    const sel = picked.includes(t);
                    return <button key={t} className="chip !px-2 text-[11px]" aria-pressed={sel} style={on(sel)} disabled={!sel && picked.length >= MAX_MAP_REFS}
                      onClick={() => { setPlan(null); setPicked((p) => (sel ? p.filter((x) => x !== t) : [...p, t])); }}>{t.slice(0, 40)}</button>;
                  })}
                </div>
              </>}
              <p className="muted text-[11px]">Up to 30 free models in zones, plus up to 3 generated items. Planning looks only; up to 7 minutes.</p>
            </div>
          )}
          <button className="btn" style={btn} onClick={doPlan} disabled={!!busy || text.length < 3}>
            {busy === "plan" ? `Planning (looks only, up to ${mode === "scene" ? 2 : 7} min)…` : `Plan ${noun}`}
          </button>
        </>
      )}

      {plan?.scene && (
        <div className="rounded-lg border p-2" style={{ borderColor: `${PINK}55` }}>
          <p className="mb-1 text-xs"><b>{plan.scene.scene}</b>{plan.place && <> in <b>{plan.place}</b></>} · origin {v3(plan.scene.origin)}. Untick what you don&apos;t want:</p>
          <table className="w-full text-[11px]">
            <thead className="muted text-left"><tr><th /><th /><th>Object</th><th>{mode === "map" ? "Zone · offset" : "Offset (studs)"}</th></tr></thead>
            <tbody>
              {objs.map((o, i) => {
                const img = plan.thumbs?.[o.assetId];
                return (
                  <tr key={o.assetId} style={{ opacity: ticked[i] ? 1 : 0.45 }}>
                    <td><input type="checkbox" checked={!!ticked[i]} aria-label={`Include ${o.name}`} disabled={!!busy} onChange={tick(i)} /></td>
                    <td className="w-9">{img?.startsWith("https://") && (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={img} alt="" width={32} height={32} className="rounded" loading="lazy" referrerPolicy="no-referrer" />
                    )}</td>
                    <td><b>{o.name}</b><br /><a className="muted font-mono" href={`https://create.roblox.com/store/asset/${o.assetId}`} target="_blank" rel="noreferrer noopener">{o.assetId}</a></td>
                    <td className="font-mono">{o.zone && <span style={{ color: PINK }}>{o.zone} · </span>}{v3(o.position)}{o.rotation.some(Boolean) && <span className="muted"> ⟳{v3(o.rotation)}</span>}</td>
                  </tr>
                );
              })}
              {gens.map((g, k) => {
                const i = objs.length + k;
                return (
                  <tr key={`g${k}`} style={{ opacity: ticked[i] ? 1 : 0.45 }}>
                    <td><input type="checkbox" checked={!!ticked[i]} aria-label={`Generate ${g.name}`} disabled={!!busy} onChange={tick(i)} /></td>
                    <td className="w-9 text-center" aria-hidden>⚙</td>
                    <td><b>{g.name}</b><br /><span className="muted">{g.tool === "generate_mesh" ? "generated mesh" : "procedural model"}: {g.prompt}</span></td>
                    <td className="font-mono">{g.zone && <span style={{ color: PINK }}>{g.zone}</span>}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {plan.notes && <p className="muted mt-1 text-[11px]">{plan.notes}</p>}
          <p className="muted mt-1 text-[11px]">Studio&apos;s insert tool can&apos;t set positions, so objects land at the default spot; use the offsets to arrange them.{gens.length > 0 && " Generated items count against the 3-generation cap."}</p>
          <div className="mt-2 flex gap-2">
            <button className="btn" style={btn} onClick={doBuild} disabled={!!busy || !count2}>
              {busy === "build" ? `Building (up to ${mode === "scene" ? 4 : 7} minutes)…` : `Build ${noun} (${count2})`}
            </button>
            <button className="chip" onClick={() => setPlan(null)} disabled={!!busy}>Cancel</button>
          </div>
        </div>
      )}

      {built && (
        <div className="rounded-lg border p-2 text-xs" style={{ borderColor: built.done ? "rgba(110,231,183,0.4)" : "rgba(251,113,133,0.4)" }}>
          <p style={{ color: built.done ? "var(--mint)" : "var(--rose)" }}><b>{built.done ? "Built in Studio." : "Not finished."}</b></p>
          {built.inserted.length > 0 && (
            <ul className="mt-1 text-[11px]">{built.inserted.map((x, i) => <li key={i}><b>{x.name}</b> <span className="muted font-mono">{x.path}</span></li>)}</ul>
          )}
          {built.notes && <p className="muted mt-1 text-[11px]">{built.notes}</p>}
          {built.historyId ? <p className="muted mt-1 text-[11px]">Before/after screenshots are in Build history below.</p>
            : built.image?.startsWith("data:image/png;base64,") && built.image.length < 3_100_000 && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={built.image} alt="Screenshot of Roblox Studio after the build" className="mt-2 w-full rounded-md" />
            )}
        </div>
      )}

      {mode !== "gui" && <ScanPanel autoPaths={autoScan} />}
      {err && <p className="error" role="alert">{err}</p>}
      <BuildHistory refresh={histKey} />
    </section>
  );
}

type LuauResult = { code: string; notes: string[]; flags: LintFlag[]; diff: DiffLine[] | null };

/** GUIs live in StarterGui/PlayerGui, outside Workspace. No Studio tool ORBIT allows can create them (and execute_luau stays blocked), so this only writes a LocalScript for the owner to review line by line and paste. */
function GuiWriter({ style }: { style: string }) {
  const [brief, setBrief] = useState("");
  const [useStyle, setUseStyle] = useState(true);
  const [res, setRes] = useState<LuauResult | null>(null);
  const [rejected, setRejected] = useState<Set<number>>(new Set());
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [copied, setCopied] = useState(false);

  const run = async () => {
    const r = guiRequest(brief, useStyle ? style : "");
    if ("error" in r) { setErr(r.error); return; }
    setBusy(true); setErr(""); setRes(null); setRejected(new Set()); setCopied(false);
    try {
      const x = await fetch("/api/luau", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ mode: "write", request: r.request, kind: "LocalScript", parent: "StarterPlayerScripts" }) });
      const j = await x.json().catch(() => ({}));
      if (!x.ok) throw new Error(j.error || `Failed (${x.status})`);
      setRes(j as LuauResult);
    } catch (e) { setErr(e instanceof Error ? e.message : "Couldn't reach ORBIT"); } finally { setBusy(false); }
  };
  const copy = async () => {
    if (!res) return;
    try { await navigator.clipboard.writeText(res.diff ? approvedText(res.diff, rejected) : res.code); setCopied(true); }
    catch { setErr("Clipboard blocked: select the code and copy it manually"); }
  };
  const toggle = (i: number) => { setCopied(false); setRejected((s) => { const n = new Set(s); if (n.has(i)) n.delete(i); else n.add(i); return n; }); };

  return (
    <div className="grid gap-2 text-xs">
      <p className="rounded-md p-2" style={{ background: "rgba(251,191,36,0.10)" }}>
        <b>ORBIT can&apos;t put a GUI into Studio for you.</b> GUIs live in StarterGui, outside Workspace, and Roblox&apos;s Studio tools can only insert models into Workspace. Running code in Studio stays blocked for safety. So ORBIT <b>writes a LocalScript</b> that builds the GUI when you press Play: review it line by line, copy it, and paste it into a LocalScript in <b>StarterPlayer › StarterPlayerScripts</b>.
      </p>
      <textarea className="field" rows={2} maxLength={MAX_GUI_BRIEF} value={brief} onChange={(e) => setBrief(e.target.value)}
        placeholder="A shop window with 6 pet slots, a coins counter top-right and a close button" aria-label="Describe the GUI" />
      {style && <label className="flex items-center gap-1.5"><input type="checkbox" checked={useStyle} onChange={(e) => setUseStyle(e.target.checked)} /> Match my game&apos;s style</label>}
      <button className="btn" style={btn} onClick={() => void run()} disabled={busy || brief.trim().length < 3}>{busy ? "Writing Luau (can take a minute)…" : "Write GUI script"}</button>
      {err && <p className="error" role="alert">{err}</p>}
      {res && (
        <div className="grid gap-2" aria-live="polite">
          {res.flags.length > 0 && (
            <ul className="space-y-1 rounded-lg border border-amber-400/50 bg-amber-400/10 p-2" aria-label="Warnings">
              {res.flags.map((f, i) => <li key={i}>{f.rule === "api" || f.rule === "deprecated" ? "📘" : "⚠️"} <b>Line {f.line}:</b> {f.message}</li>)}
            </ul>
          )}
          {res.diff ? (
            <ol className="max-h-80 overflow-auto rounded-lg bg-black/40 p-1 font-mono text-[11px] leading-snug">
              {res.diff.map((d, i) => {
                const off = rejected.has(i);
                return (
                  <li key={i} className="flex items-start gap-1" style={{ opacity: off ? 0.45 : 1 }}>
                    {d.op === " " ? <span className="w-4 shrink-0" /> : <input type="checkbox" className="mt-0.5 shrink-0" checked={!off} onChange={() => toggle(i)}
                      aria-label={`Keep line: ${d.text.trim() || "(blank)"}`} style={{ accentColor: PINK }} />}
                    <span className={`whitespace-pre ${off ? "line-through" : ""}`}>{d.text || " "}</span>
                  </li>
                );
              })}
            </ol>
          ) : <pre className="max-h-80 overflow-auto rounded-lg bg-black/40 p-2 text-[11px]">{res.code}</pre>}
          <button className="btn w-full" onClick={() => void copy()}>{copied ? "✓ Copied: paste it into a LocalScript" : res.diff ? "Copy approved lines" : "Copy code"}</button>
          {res.notes.length > 0 && <ul className="list-disc space-y-0.5 pl-5">{res.notes.map((n, i) => <li key={i}>{n}</li>)}</ul>}
        </div>
      )}
    </div>
  );
}

/** The last 30 builds' before/after screenshots (stored by the server around each build), with a drag slider. */
function BuildHistory({ refresh }: { refresh: number }) {
  const [list, setList] = useState<HistoryEntry[]>([]);
  const [open, setOpen] = useState<HistoryEntry | null>(null);
  const [cut, setCut] = useState(50);
  const load = useCallback(() => { call<{ history: HistoryEntry[] }>(undefined, "?history=1").then((r) => setList(r.history), () => {}); }, []);
  useEffect(load, [load, refresh]);
  if (!list.length) return null;
  const src = (e: HistoryEntry, side: "before" | "after") => `/api/roblox?shot=${e.id}&side=${side}`;

  return (
    <div className="grid gap-1 text-xs" aria-label="Build history">
      <b style={{ color: PINK }}>Build history <span className="muted">({list.length})</span></b>
      <ul className="flex gap-1 overflow-x-auto pb-1">
        {list.map((e) => (
          <li key={e.id} className="shrink-0">
            <button className="chip !p-0.5" aria-pressed={open?.id === e.id} onClick={() => { setOpen(open?.id === e.id ? null : e); setCut(50); }} title={`${e.label} · ${new Date(e.at).toLocaleString()}`}
              aria-label={`Show before and after of ${e.label}`}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={src(e, e.after ? "after" : "before")} alt="" width={64} height={40} className="h-10 w-16 rounded object-cover" loading="lazy" />
            </button>
          </li>
        ))}
      </ul>
      {open && (
        <div className="grid gap-1">
          <p><b>{open.label}</b> <span className="muted">· {new Date(open.at).toLocaleString()}</span></p>
          {open.before && open.after ? (
            <>
              <div className="relative w-full overflow-hidden rounded-md">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={src(open, "before")} alt="Studio before the build" className="block w-full" />
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={src(open, "after")} alt="Studio after the build" className="absolute inset-0 h-full w-full" style={{ clipPath: `inset(0 0 0 ${cut}%)` }} />
                <span className="pointer-events-none absolute inset-y-0 w-0.5" style={{ left: `${cut}%`, background: PINK }} aria-hidden />
              </div>
              <input type="range" min={0} max={100} value={cut} onChange={(e) => setCut(Number(e.target.value))} aria-label="Slide between before (left) and after (right)" style={{ accentColor: PINK }} />
              <p className="muted flex justify-between"><span>◀ before</span><span>after ▶</span></p>
            </>
          ) : (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={src(open, open.after ? "after" : "before")} alt={`Studio ${open.after ? "after" : "before"} the build (only one screenshot was taken)`} className="w-full rounded-md" />
          )}
        </div>
      )}
    </div>
  );
}
