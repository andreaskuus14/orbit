"use client";
import { useCallback, useEffect, useState } from "react";
import { useT } from "./i18n";

type Place = { name: string; lat: number; lon: number; pc?: boolean };
type View = { on: boolean; places: Place[]; last: { at: string; near: string | null } | null };

/** Profile → Location-aware brief: opt-in switch (off by default), saved places, and one button to forget the latest point. */
export function PlaceSection() {
  const { t } = useT();
  const [v, setV] = useState<View | null>(null);
  const [err, setErr] = useState("");
  const [name, setName] = useState("");
  const [pc, setPc] = useState(false);
  const call = useCallback(async (method: "GET" | "POST" | "DELETE" = "GET", body?: object) => {
    setErr("");
    const r = await fetch("/api/place", { method, ...(body && { headers: { "content-type": "application/json" }, body: JSON.stringify(body) }) }).catch(() => null);
    const j = r && (await r.json().catch(() => null));
    if (r?.ok && j) { setV(j); return true; }
    setErr(t("plc.loadFail"));
    return false;
  }, []);
  useEffect(() => { void call(); }, [call]);
  const save = async (e: React.FormEvent) => { e.preventDefault(); if (await call("POST", { saveHere: name, pc })) { setName(""); setPc(false); } };
  return (
    <section className="space-y-3" aria-labelledby="place-title">
      <h3 id="place-title" className="text-sm font-semibold">{t("plc.title")}</h3>
      <p className="muted text-sm">{t("plc.help1")} <b>{t("plc.update")}</b> {t("plc.help2")}</p>
      {v && <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={v.on} onChange={(e) => void call("POST", { on: e.target.checked })} /> {t("plc.use")}
      </label>}
      {v?.on && <>
        <p className="muted text-sm">{v.last ? t("plc.latest", { at: new Date(v.last.at).toLocaleString(), near: v.last.near ? t("plc.near", { p: v.last.near }) : "" }) : t("plc.noPoint")}</p>
        {v.last && <button className="chip" onClick={() => void call("DELETE")}>{t("plc.delete")}</button>}
        <ul className="space-y-1">
          {v.places.map((p) => (
            <li key={p.name} className="flex items-center gap-2 text-sm">
              <span>{p.name}{p.pc ? ` ${t("plc.pcHere")}` : ""}</span>
              <button className="chip" aria-label={t("plc.rmL", { name: p.name })} onClick={() => void call("POST", { places: v.places.filter((x) => x !== p) })}>{t("plc.remove")}</button>
            </li>
          ))}
        </ul>
        <form onSubmit={save} className="flex flex-wrap items-center gap-2">
          <input className="field" placeholder={t("plc.namePh")} maxLength={30} required aria-label={t("plc.name")} value={name} onChange={(e) => setName(e.target.value)} />
          <label className="flex items-center gap-1 text-sm"><input type="checkbox" checked={pc} onChange={(e) => setPc(e.target.checked)} /> {t("plc.myPc")}</label>
          <button className="btn" disabled={!v.last || !name.trim()}>{t("plc.save")}</button>
        </form>
      </>}
      {err && <p className="error text-sm" role="alert">{err}</p>}
    </section>
  );
}
