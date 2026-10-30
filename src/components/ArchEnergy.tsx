"use client";
// ARCH sun hours + rough heating need per room (roadmap 8, 6.1). All maths in arch-energy-pure.ts; runs on click, cleared on edit.
import { useEffect, useState } from "react";
import type { Part } from "@/lib/arch-pure";
import { cleanInputs, ENERGY_INPUTS, energyStudy, INPUT_RANGE, type EnergyInputs, type EnergyRow } from "@/lib/arch-energy-pure";
import { useT } from "./i18n";

const KEY = "orbit.arch.energy.v1";

export function ArchEnergy({ parts, site, north }: { parts: Part[]; site: { lat: number; lon: number; name: string }; north: number }) {
  const { t } = useT();
  const [rows, setRows] = useState<EnergyRow[] | null>(null);
  const [inp, setInp] = useState<EnergyInputs>(ENERGY_INPUTS);
  useEffect(() => { try { setInp(cleanInputs(JSON.parse(localStorage.getItem(KEY) ?? "null"))); } catch { /* defaults */ } }, []);
  useEffect(() => setRows(null), [parts, site.lat, site.lon, north, inp]); // an edit makes the result stale
  const set = (k: keyof EnergyInputs, v: number) => setInp((o) => { const n = cleanInputs({ ...o, [k]: v }); try { localStorage.setItem(KEY, JSON.stringify(n)); } catch { /* private mode */ } return n; });
  const sum = (k: "peakW" | "kWh") => (rows ?? []).reduce((s, r) => s + r[k], 0);
  return (
    <div className="card space-y-1.5" aria-label={t("arch.energyHead", { site: site.name })}>
      <div className="muted text-[10px] uppercase tracking-widest">{t("arch.energyHead", { site: site.name })}</div>
      <details className="text-xs"><summary className="cursor-pointer">{t("arch.energyInputs")}</summary>
        <div className="grid grid-cols-2 gap-1 pt-1">{(Object.keys(ENERGY_INPUTS) as (keyof EnergyInputs)[]).map((k) => (
          <label key={k} className="flex items-center justify-between gap-1"><span className="muted text-[11px]">{t(`arch.ein.${k}`)}</span>
            <input className="field w-20 text-right" type="number" min={INPUT_RANGE[k][0]} max={INPUT_RANGE[k][1]} step={k.startsWith("u") || k === "ach" ? 0.01 : 1} defaultValue={inp[k]} key={`${k}${inp[k]}`}
              onBlur={(e) => set(k, Number(e.target.value))} /></label>))}</div>
        <button className="chip mt-1" onClick={() => { setInp(ENERGY_INPUTS); try { localStorage.removeItem(KEY); } catch { /* ignore */ } }}>{t("arch.energyReset")}</button>
      </details>
      <button className="btn" onClick={() => setRows(energyStudy(parts, site, north, inp))}>{t("arch.energyRun")}</button>
      {rows && !rows.length && <p className="text-xs">{t("arch.energyNone")}</p>}
      {rows && rows.length > 0 && <table className="w-full text-xs"><thead><tr className="muted">
        <th className="text-left">{t("arch.energyRoom")}</th><th className="text-right">m²</th><th className="text-right">{t("arch.energyDec")}</th>
        <th className="text-right">{t("arch.energyMar")}</th><th className="text-right">{t("arch.energyPeak")}</th><th className="text-right">{t("arch.energyKwh")}</th></tr></thead>
        <tbody>{rows.map((r) => <tr key={r.id}><td>{r.name}</td><td className="num text-right">{r.area}</td><td className="num text-right">{r.sunDec}</td>
          <td className="num text-right">{r.sunMar}</td><td className="num text-right">{r.peakW}</td><td className="num text-right" title={`${r.kWhM2} kWh/m²`}>{r.kWh}</td></tr>)}
          <tr className="font-semibold"><td colSpan={4}>{t("arch.energyTotal")}</td><td className="num text-right">{sum("peakW")}</td><td className="num text-right">{sum("kWh")}</td></tr></tbody></table>}
      <p className="muted text-[11px]">{t("arch.energyNote")} {t("arch.energyUsed", { dd: inp.degreeDays, design: inp.design, inside: inp.inside, year: inp.year, step: inp.stepMin })}</p>
    </div>
  );
}
