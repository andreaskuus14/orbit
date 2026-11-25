"use client";
// ARCH daylight study (roadmap 3): per-room direct-sun hours through the model's windows and a daylight-factor rule of thumb.
// All maths in arch-daylight-pure.ts; this runs it one month per macrotask so the UI never freezes, then tints the room floors.
import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { Edges } from "@react-three/drei";
import type { Part } from "@/lib/arch-pure";
import { cleanDaylight, DAYLIGHT_INPUTS, DAYLIGHT_RANGE, daylightPlan, dfBand, studyMonth, summarize, type DaylightInputs, type MonthSample, type Plan, type RoomResult, type Site } from "@/lib/arch-daylight-pure";
import { useT } from "./i18n";

export type Daylight = { plan: Plan; months: MonthSample[]; rooms: RoomResult[]; inp: DaylightInputs };
const KEY = "orbit.arch.daylight.v1";
const NONE = new THREE.Color("#64748b"), FULL = new THREE.Color("#f59e0b"), WARN = "#dc2626";
const MONTHS = "JFMAMJJASOND";
const tint = (hours: number, max: number) => `#${NONE.clone().lerp(FULL, max > 0 ? hours / max : 0).getHexString()}`;

/** In the canvas: each room's floor coloured by annual sun hours (grey = none → amber = sunniest); red edge = no December sun. */
export function DaylightRooms({ d }: { d: Daylight }) {
  const max = Math.max(...d.rooms.map((r) => r.annualHours));
  return <>{d.plan.rooms.map((room) => {
    const res = d.rooms.find((r) => r.id === room.id)!;
    return room.rects.map((q, i) => (
      <mesh key={`${room.id}-${i}`} position={[(q.x0 + q.x1) / 2, room.y + 0.03, (q.z0 + q.z1) / 2]}>
        <boxGeometry args={[q.x1 - q.x0, 0.04, q.z1 - q.z0]} />
        <meshBasicMaterial color={tint(res.annualHours, max)} transparent opacity={0.85} />
        {res.noDecSun && <Edges color={WARN} />}
      </mesh>));
  })}</>;
}

export function DaylightPanel({ parts, site, d, onChange }: { parts: Part[]; site: Site & { name: string }; d: Daylight | null; onChange: (d: Daylight | null) => void }) {
  const { t } = useT();
  const [busy, setBusy] = useState<number | null>(null);
  const [inp, setInp] = useState<DaylightInputs>(DAYLIGHT_INPUTS); // ARC05: study inputs, visible and editable
  useEffect(() => { try { setInp(cleanDaylight(JSON.parse(localStorage.getItem(KEY) ?? "null"))); } catch { /* defaults */ } }, []);
  const set = (k: keyof DaylightInputs, v: string) => setInp((o) => { const n = cleanDaylight({ ...o, [k]: v }); try { localStorage.setItem(KEY, JSON.stringify(n)); } catch { /* private mode */ } return n; });
  const job = useRef(0);
  useEffect(() => { job.current++; setBusy(null); onChange(null); }, [parts, inp]); // eslint-disable-line react-hooks/exhaustive-deps -- an edit makes the result stale

  async function run() {
    const me = ++job.current, plan = daylightPlan(parts), months: MonthSample[] = [];
    for (let m = 0; m < 12; m++) {
      setBusy(m);
      await new Promise((r) => setTimeout(r, 0)); // yield a frame between months
      if (job.current !== me) return;
      months.push(studyMonth(plan, site, m, inp.year, inp.day, inp.stepMin));
    }
    setBusy(null);
    onChange({ plan, months, rooms: summarize(plan, months, inp.stepMin, inp.dfDiv), inp });
  }

  return (
    <div className="card space-y-1.5" aria-label={t("adl.study")}>
      <div className="muted text-[12px] font-medium">{t("adl.study")} · {site.name} · {t("arch.studyEstimate")}</div>
      <div className="flex flex-wrap items-center gap-1.5">
        <button className="btn" disabled={busy !== null} onClick={() => void run()}>{busy !== null ? t("adl.sampling", { m: MONTHS[busy], i: busy + 1 }) : d ? t("adl.again") : t("adl.run")}</button>
        {d && <button className="chip" onClick={() => onChange(null)}>{t("adl.clear")}</button>}
      </div>
      <div className="flex flex-wrap items-center gap-2 text-xs" aria-label={t("arch.dayInputs")}>
        {(["day", "stepMin", "year", "dfDiv"] as const).map((k) => <label key={k} className="flex items-center gap-1">{t(`arch.dayIn.${k}`)}
          <input className="field w-16" type="number" min={DAYLIGHT_RANGE[k][0]} max={DAYLIGHT_RANGE[k][1]} step={k === "dfDiv" ? 0.5 : 1} value={inp[k]} onChange={(e) => set(k, e.target.value)} /></label>)}
        <button className="chip" onClick={() => { setInp(DAYLIGHT_INPUTS); try { localStorage.removeItem(KEY); } catch { /* ignore */ } }}>{t("arch.energyReset")}</button>
      </div>
      <p className="muted text-[11px]">{t("arch.dayInputsNote", { day: inp.day, step: inp.stepMin, year: inp.year, div: inp.dfDiv })}</p>
      {d && !d.rooms.length && <p className="text-xs">{t("adl.noRooms")}</p>}
      {d?.rooms.map((r) => {
        const max = Math.max(...d.rooms.map((x) => x.annualHours)), room = d.plan.rooms.find((x) => x.id === r.id)!;
        return <div key={r.id} className="space-y-1">
          <div className="flex items-center gap-2 text-xs">
            <span className="inline-block h-3 w-3 rounded-sm" style={{ background: tint(r.annualHours, max), outline: r.noDecSun ? `2px solid ${WARN}` : undefined }} aria-hidden />
            <span className="font-semibold">{r.name}</span><span className="muted num">{room.area} m² · {t("adl.windows", { n: room.windows.length })}</span>
          </div>
          <p className="text-xs">{t("adl.hours", { a: r.annualHours.toLocaleString("en"), day: d.inp.day, jun: r.junHours, dec: r.decHours })}
            {r.noDecSun && <span style={{ color: WARN }}> · {t("adl.noDec")}</span>}</p>
          <p className="muted text-[11px]">{t("adl.df", { wfr: r.wfr, df: r.df, band: dfBand(r.df) })}</p>
          <div className="grid gap-px" style={{ gridTemplateColumns: `1rem repeat(${d.months[0]?.up.length ?? 24}, 1fr)` }} role="img"
            aria-label={`${r.name}: sun by month and hour, ${r.decHours} hours on December ${d.inp.day}, ${r.junHours} on June ${d.inp.day}`}>
            {d.months.map((m, mi) => [<span key={`l${mi}`} className="muted text-[9px] leading-[8px]">{MONTHS[mi]}</span>,
              ...m.up.map((up, h) => <span key={`${mi}-${h}`} title={`${MONTHS[mi]} ${d.inp.day}, ${Math.floor((h * d.inp.stepMin) / 60)}:${String((h * d.inp.stepMin) % 60).padStart(2, "0")} solar time: ${m.lit[r.id][h] ? "direct sun" : up ? "sun up, not through a window" : "night"}`}
                style={{ height: 8, background: m.lit[r.id][h] ? FULL.getStyle() : up ? "rgba(148,163,184,.35)" : "rgba(30,41,59,.6)" }} />)])}
          </div>
        </div>;
      })}
      {d && d.rooms.length > 0 && <p className="muted text-[11px]">{t("adl.strip", { day: d.inp.day })}</p>}
      <p className="muted text-[11px]">{t("adl.note", { div: inp.dfDiv })}</p>
    </div>
  );
}
