"use client";
import { MAPPING, compare } from "@/lib/persona-calibration-pure";
import type { PersonaResult } from "@/lib/personas-pure";
import type { Retention } from "@/lib/gamedev-retention-pure";
import type { Calibration } from "@/lib/personas";
import { useT } from "./i18n";

/** GAME DEV R1: persona predictions vs the owner's imported Roblox analytics, with the error per metric and raw vs calibrated values. */
export default function PersonaCalibration({ results, real, saved, busy, onSave }: { results: PersonaResult[]; real: Retention | undefined; saved: Calibration | null; busy: boolean; onSave: () => void }) {
  const { t } = useT();
  const fmt = (x: number | null, unit: string) => (x === null ? t("gd.cal.unknown") : unit === "rate" ? `${Math.round(x * 1000) / 10}%` : `${Math.round(x * 10) / 10}`);
  const rows = real ? compare(results, real, saved?.factors).rows : [];
  return (
    <div aria-label={t("gd.cal.title")} className="grid gap-1">
      <b className="text-xs">{t("gd.cal.title")}</b>
      <p className="muted text-xs">{t("gd.cal.help")}</p>
      {!real ? <p className="muted text-xs">{t("gd.cal.none")}</p> : <>
        <table className="w-full text-[11px]">
          <thead><tr><th className="text-left">{t("gd.cal.metric")}</th><th>{t("gd.cal.raw")}</th><th>{t("gd.cal.real")}</th><th>{t("gd.cal.err")}</th><th>{t("gd.cal.factor")}</th><th>{t("gd.cal.adj")}</th></tr></thead>
          <tbody>{rows.map((r) => (
            <tr key={r.key} className="text-center">
              <td className="text-left">{r.label}</td><td>{fmt(r.raw, r.unit)}</td><td>{fmt(r.real, r.unit)}</td>
              <td>{r.error === null ? "" : `${r.error > 0 ? "+" : ""}${fmt(r.error, r.unit)}`}</td><td>{r.factor ?? ""}</td><td>{saved ? fmt(r.calibrated, r.unit) : ""}</td>
            </tr>))}</tbody>
        </table>
        <p className="muted text-[11px]">{t("gd.cal.mapping", { m: MAPPING })}</p>
        {saved && <p className="muted text-[11px]">{t("gd.cal.saved", { at: new Date(saved.at).toLocaleString(), rep: new Date(saved.report).toLocaleString(), asOf: saved.asOf })}</p>}
        <div><button className="chip" onClick={onSave} disabled={busy}>{t("gd.cal.btn")}</button></div>
      </>}
    </div>
  );
}
