"use client";
import { useEffect, useState } from "react";
import { useT } from "./i18n";
import type { Persona, Slider } from "@/lib/persona-pure"; // types only: persona-pure pulls server code

// Profile → "ORBIT's character": four sliders, the call voice, a fixed preview line, and a pending style suggestion. Data: /api/persona.

type View = { persona: Persona; proposal: { text: string } | null; voices: string[]; preview: string; labels: Record<Slider, string[]> };

export function PersonaSection() {
  const { t } = useT();
  const [v, setV] = useState<View | null>(null);
  const [msg, setMsg] = useState("");
  const send = (body: object, done = "Saved.") => {
    setMsg("");
    fetch("/api/persona", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })
      .then(async (r) => { const j = await r.json(); if (!r.ok) throw new Error(j.error || `Request failed (${r.status})`); setV(j); setMsg(done); })
      .catch((e) => setMsg(e instanceof Error ? e.message : "Could not save"));
  };
  useEffect(() => { fetch("/api/persona", { cache: "no-store" }).then((r) => r.json()).then((j) => (j.error ? setMsg(j.error) : setV(j))).catch((e) => setMsg(e.message)); }, []);
  return (
    <section className="space-y-2" aria-labelledby="persona-h">
      <h3 id="persona-h" className="h3">{t("profile.persona")}</h3>
      <p className="muted text-xs">One voice in chat, calls, the morning brief and push: a calm, dry-witted alien intelligence that likes you. It always disagrees honestly and says when it&apos;s unsure; no setting makes it flatter you.</p>
      {v && <>
        {v.proposal && (
          <div className="card flex flex-wrap items-center gap-2 text-sm">
            <span>Adjust: {v.proposal.text}?</span>
            <button type="button" className="btn" onClick={() => send({ decision: "keep" }, "Adjusted.")}>Keep</button>
            <button type="button" className="chip" onClick={() => send({ decision: "reject" }, "Left as is.")}>No</button>
          </div>
        )}
        {(Object.keys(v.labels) as Slider[]).map((s) => (
          <label key={s} className="flex items-center gap-3 text-sm">
            <span className="w-24 capitalize">{s}</span>
            <input type="range" min={0} max={3} step={1} value={v.persona[s]} aria-valuetext={v.labels[s][v.persona[s]]}
              onChange={(e) => send({ [s]: Number(e.target.value) })} />
            <span className="muted w-24">{v.labels[s][v.persona[s]]}</span>
          </label>
        ))}
        <label className="flex items-center gap-3 text-sm">
          <span className="w-24">Call voice</span>
          <select className="field" value={v.persona.voice} onChange={(e) => send({ voice: e.target.value })}>
            <option value="">PC default</option>
            {v.voices.map((x) => <option key={x} value={x}>{x}</option>)}
          </select>
        </label>
        <p className="muted text-xs">Sounds like: “{v.preview}”</p>
      </>}
      {msg && <p className="muted text-sm" role="status">{msg}</p>}
    </section>
  );
}
