"use client";
// The daily mission's target picker (daily-mission-pure CATALOGUE): an inline list in the morning card, max 5, each with its
// daily number. Saving takes effect on the next briefing; progress always comes from ORBIT's records.
import { useState } from "react";
import type { Target, TargetId } from "@/lib/daily-mission-pure";
import { useT } from "./i18n";

type Cat = { targets: Target[]; defaults: Target[]; max: number; catalogue: { id: TargetId; def: number; max: number }[] };

export default function MissionTargets() {
  const { t } = useT();
  const [cat, setCat] = useState<Cat | null>(null);
  const [picked, setPicked] = useState<Target[]>([]);
  const [err, setErr] = useState("");
  const [saved, setSaved] = useState(false);
  const open = () => fetch("/api/daily-mission", { cache: "no-store" }).then((r) => r.json()).then((j: Cat) => { setCat(j); setPicked(j.targets.length ? j.targets : j.defaults); }, () => setErr(t("common.failed")));
  const save = (targets: Target[]) => fetch("/api/daily-mission", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ targets }) })
    .then(async (r) => { const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.error); setCat(null); setSaved(true); }).catch((e: Error) => setErr(e.message || t("common.failed")));

  if (!cat) return <>{saved && <span className="muted text-xs">✓ </span>}<button className="link text-xs" onClick={() => void open()}>{t("mission.edit")}</button>{err && <span className="error text-xs"> {err}</span>}</>;
  const toggle = (id: TargetId, def: number) => setPicked((p) => (p.some((x) => x.id === id) ? p.filter((x) => x.id !== id) : p.length < cat.max ? [...p, { id, n: def }] : p));
  return (
    <form className="mt-1 grid gap-0.5 text-xs" onSubmit={(e) => { e.preventDefault(); void save(picked); }}>
      <span className="muted">{t("mission.max", { n: cat.max })}</span>
      {cat.catalogue.map((c) => {
        const p = picked.find((x) => x.id === c.id);
        return (
          <label key={c.id} className="flex items-center gap-1.5">
            <input type="checkbox" checked={!!p} disabled={!p && picked.length >= cat.max} onChange={() => toggle(c.id, c.def)} />
            {t(`mission.t.${c.id}` as "mission.t.shorts")}
            {p && c.max > 0 && <input className="field w-12 py-0 text-xs" type="number" min={1} max={c.max} value={p.n} aria-label={t(`mission.t.${c.id}` as "mission.t.shorts")}
              onChange={(e) => setPicked((l) => l.map((x) => (x.id === c.id ? { ...x, n: Number(e.target.value) } : x)))} />}
          </label>);
      })}
      <span className="flex gap-2">
        <button className="chip" disabled={!picked.length}>{t("mission.save")}</button>
        <button type="button" className="link" onClick={() => void save([])}>{t("mission.default")}</button>
        <button type="button" className="link" onClick={() => setCat(null)}>{t("common.cancel")}</button>
      </span>
      {err && <span className="error">{err}</span>}
    </form>
  );
}
