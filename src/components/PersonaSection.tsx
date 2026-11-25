"use client";
import { plainError } from "@/lib/api-error-pure";
import { useEffect, useState } from "react";
import { useT } from "./i18n";
import type { Persona, Slider } from "@/lib/persona-pure"; // types only: persona-pure pulls server code

// Profile → "ORBIT's character": four sliders, the call voice, a fixed preview line, and a pending style suggestion. Data: /api/persona.

type View = { persona: Persona; proposal: { text: string } | null; voices: string[]; preview: string; labels: Record<Slider, string[]> };

export function PersonaSection() {
  const { t } = useT();
  const [v, setV] = useState<View | null>(null);
  const [msg, setMsg] = useState("");
  const send = (body: object, done = t("pers.saved")) => {
    setMsg("");
    fetch("/api/persona", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })
      .then(async (r) => { const j = await r.json(); if (!r.ok) throw new Error(j.error || `Request failed (${r.status})`); setV(j); setMsg(done); })
      .catch((e) => setMsg(plainError(e, t("pers.saveFail"))));
  };
  useEffect(() => { fetch("/api/persona", { cache: "no-store" }).then((r) => r.json()).then((j) => (j.error ? setMsg(t("pers.loadFail")) : setV(j))).catch((e) => setMsg(plainError(e, t("pers.loadFail")))); }, []);
  return (
    <section className="space-y-2" aria-labelledby="persona-h">
      <h3 id="persona-h" className="h3">{t("profile.persona")}</h3>
      <p className="muted text-xs">{t("pers.help")}</p>
      {v && <>
        {v.proposal && (
          <div className="card flex flex-wrap items-center gap-2 text-sm">
            <span>{t("pers.adjust", { x: v.proposal.text })}</span>
            <button type="button" className="btn" onClick={() => send({ decision: "keep" }, t("pers.adjusted"))}>{t("pers.keep")}</button>
            <button type="button" className="chip" onClick={() => send({ decision: "reject" }, t("pers.left"))}>{t("pers.no")}</button>
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
          <span className="w-24">{t("pers.voice")}</span>
          <select className="field" value={v.persona.voice} onChange={(e) => send({ voice: e.target.value })}>
            <option value="">{t("pers.pcDefault")}</option>
            {v.voices.map((x) => <option key={x} value={x}>{x}</option>)}
          </select>
        </label>
        <p className="muted text-xs">{t("pers.sounds", { x: v.preview })}</p>
      </>}
      {msg && <p className="muted text-sm" role="status">{msg}</p>}
    </section>
  );
}
