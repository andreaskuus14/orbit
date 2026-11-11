"use client";
// STUDIO → Production track (Y2): his staged method on one page. Stages 4 and 5 wait for his click on the exact version shown.
import { useCallback, useEffect, useState } from "react";
import type { Stage, Track } from "@/lib/clips/track-pure";

type Row = { track: Track; state: { current: string; gate: string; waiting: { stage: string; ref: string; hash: string }[] } };
const link = (ref: string) => (/^https?:\/\//.test(ref) ? ref : `/api/studio/clips/media?f=${encodeURIComponent(ref)}`);
async function post(body: unknown) {
  const r = await fetch("/api/studio/track", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || `Request failed (${r.status})`);
}

export default function StudioTrack() {
  const [data, setData] = useState<{ stages: Stage[]; tracks: Row[] } | null>(null);
  const [err, setErr] = useState("");
  const [form, setForm] = useState({ title: "", ref: "", note: "", sec: "6" });
  const load = useCallback(() => fetch("/api/studio/track", { cache: "no-store" }).then((r) => r.json()).then(setData, (e: Error) => setErr(e.message)), []);
  useEffect(() => { void load(); }, [load]);
  const act = (b: unknown) => post(b).then(() => { setErr(""); return load(); }, (e: Error) => setErr(e.message));
  if (!data) return <p className="text-sm opacity-70">{err || "Loading…"}</p>;
  return (
    <div className="space-y-4 text-sm">
      {err && <p role="alert" className="text-red-400">{err}</p>}
      <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); void act({ action: "create", title: form.title }); }}>
        <input aria-label="New video title" className="flex-1 rounded bg-white/5 px-2 py-1" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="New video…" />
        <button className="rounded bg-white/10 px-3">Start track</button>
      </form>
      {data.tracks.map(({ track: t, state }) => {
        const cur = data.stages[t.stage];
        return (
          <section key={t.id} className="rounded border border-white/10 p-3 space-y-2">
            <h3 className="font-medium">{t.title} <span className="opacity-60">· stage {t.stage + 1}/8 {cur.name}{t.revisions ? ` · revision ${t.revisions}` : ""}</span></h3>
            <ol className="space-y-1">
              {data.stages.map((s, i) => {
                const a = s.id === "style" ? null : t.out[s.id];
                return (
                  <li key={s.id} className={i === t.stage ? "font-medium" : i > t.stage ? "opacity-50" : ""}>
                    {i + 1}. {s.name} <span className="opacity-60">({s.inputs} → {s.output}; {s.gate === "owner" ? "your approval" : "check"}{s.spends ? ", spend via story.approve" : ""})</span>
                    {a && <> · <a className="underline" href={link(a.ref)} target="_blank" rel="noreferrer">{a.ref}</a>{a.approved ? " ✓" : ""}</>}
                    {s.id === "style" && t.frames.map((f) => <span key={f.ref}> · <a className="underline" href={link(f.ref)} target="_blank" rel="noreferrer">{f.ref}</a>{f.approved ? " ✓" : ""}</span>)}
                  </li>);
              })}
            </ol>
            <p className="opacity-80">{state.gate || "Gate passed: ready for the next stage."}</p>
            {state.waiting.length > 0 && <div><p className="font-medium">Waiting for you</p>
              {state.waiting.map((w) => <div key={w.stage + w.ref} className="flex gap-2 items-center">
                <a className="underline" href={link(w.ref)} target="_blank" rel="noreferrer">{w.stage}: {w.ref}</a>
                <button className="rounded bg-emerald-600/40 px-2" onClick={() => void act({ action: "approve", id: t.id, stage: w.stage, ref: w.ref, hash: w.hash })}>Approve this version</button>
              </div>)}</div>}
            <form className="flex flex-wrap gap-2" onSubmit={(e) => { e.preventDefault(); void act({ action: "submit", id: t.id, stage: cur.id, ref: form.ref, note: form.note, sec: Number(form.sec) }); }}>
              <input aria-label="Output link or path" className="flex-1 rounded bg-white/5 px-2 py-1" value={form.ref} onChange={(e) => setForm({ ...form, ref: e.target.value })} placeholder={cur.output} />
              <input aria-label="Note" className="rounded bg-white/5 px-2 py-1" value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} placeholder="note" />
              {cur.id === "motion" && <input aria-label="Seconds" type="number" min={5} max={8} className="w-16 rounded bg-white/5 px-2 py-1" value={form.sec} onChange={(e) => setForm({ ...form, sec: e.target.value })} />}
              <button className="rounded bg-white/10 px-3">Save output</button>
              <button type="button" className="rounded bg-white/10 px-3" onClick={() => void act({ action: "advance", id: t.id })}>Next stage</button>
              {cur.id === "render" && <button type="button" className="rounded bg-white/10 px-3" onClick={() => void act({ action: "revise", id: t.id })}>Revise</button>}
            </form>
          </section>);
      })}
    </div>);
}
