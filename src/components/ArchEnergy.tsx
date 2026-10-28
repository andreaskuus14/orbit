"use client";
// ARCH sun hours + rough heating need per room (roadmap 8, 6.1). All maths in arch-energy-pure.ts; runs on click, cleared on edit.
import { useEffect, useState } from "react";
import type { Part } from "@/lib/arch-pure";
import { energyStudy, type EnergyRow } from "@/lib/arch-energy-pure";
import { useT } from "./i18n";

export function ArchEnergy({ parts, site, north }: { parts: Part[]; site: { lat: number; lon: number; name: string }; north: number }) {
  const { t } = useT();
  const [rows, setRows] = useState<EnergyRow[] | null>(null);
  useEffect(() => setRows(null), [parts, site.lat, site.lon, north]); // an edit makes the result stale
  const sum = (k: "peakW" | "kWh") => (rows ?? []).reduce((s, r) => s + r[k], 0);
  return (
    <div className="card space-y-1.5" aria-label={t("arch.energyHead", { site: site.name })}>
      <div className="muted text-[10px] uppercase tracking-widest">{t("arch.energyHead", { site: site.name })}</div>
      <button className="btn" onClick={() => setRows(energyStudy(parts, site, north))}>{t("arch.energyRun")}</button>
      {rows && !rows.length && <p className="text-xs">{t("arch.energyNone")}</p>}
      {rows && rows.length > 0 && <table className="w-full text-xs"><thead><tr className="muted">
        <th className="text-left">{t("arch.energyRoom")}</th><th className="text-right">m²</th><th className="text-right">{t("arch.energyDec")}</th>
        <th className="text-right">{t("arch.energyMar")}</th><th className="text-right">{t("arch.energyPeak")}</th><th className="text-right">{t("arch.energyKwh")}</th></tr></thead>
        <tbody>{rows.map((r) => <tr key={r.id}><td>{r.name}</td><td className="num text-right">{r.area}</td><td className="num text-right">{r.sunDec}</td>
          <td className="num text-right">{r.sunMar}</td><td className="num text-right">{r.peakW}</td><td className="num text-right" title={`${r.kWhM2} kWh/m²`}>{r.kWh}</td></tr>)}
          <tr className="font-semibold"><td colSpan={4}>{t("arch.energyTotal")}</td><td className="num text-right">{sum("peakW")}</td><td className="num text-right">{sum("kWh")}</td></tr></tbody></table>}
      <p className="muted text-[11px]">{t("arch.energyNote")}</p>
    </div>
  );
}
