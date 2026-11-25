"use client";
// INTELLIGENCE: the one bar over every map (Earth, News weather, Classic map). Same place, same buttons in every mode, so there
// is always a way back. Right side: where the camera is (Earth only), Live, and the local time. Rules: lib/intel-view-pure.ts.
import { useEffect, useState } from "react";
import { useT } from "../i18n";
import { TABS, currentTab, type MapView, type Place, type Tab } from "@/lib/intel-view-pure";

/** EarthView sends this (at most every 400 ms, only when it changed) so the bar can show where the camera is. */
export const EARTH_VIEW_EVENT = "orbit:earth-view";
export type EarthViewDetail = { lon: number; lat: number; alt: number };

const fmtAlt = (a: number) => (a >= 100 ? `${Math.round(a).toLocaleString("en")} km` : `${a.toFixed(1)} km`);

export default function IntelBar({ view, place, onTab }: { view: MapView; place: Place; onTab: (id: Tab["id"]) => void }) {
  const { t, lang } = useT();
  const lit = currentTab(view, place);
  const [pos, setPos] = useState<EarthViewDetail | null>(null);
  useEffect(() => {
    const on = (e: Event) => setPos((e as CustomEvent<EarthViewDetail>).detail);
    addEventListener(EARTH_VIEW_EVENT, on);
    return () => removeEventListener(EARTH_VIEW_EVENT, on);
  }, []);
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => { setNow(new Date()); const i = setInterval(() => setNow(new Date()), 30_000); return () => clearInterval(i); }, []);
  const where = view === "earth" && pos ? `${Math.abs(pos.lat).toFixed(2)}° ${pos.lat >= 0 ? "N" : "S"}  ${Math.abs(pos.lon).toFixed(2)}° ${pos.lon >= 0 ? "E" : "W"} · ${fmtAlt(pos.alt)}` : "";
  return (
    <nav className="intel-bar" data-intel-bar="" aria-label={t("earth.places")}>
      <div className="intel-tabs">
        {TABS.map((b, i) => (
          <button key={b.id} type="button" data-intel-tab={b.id} aria-current={lit === b.id ? "true" : undefined}
            className={i === 4 ? "intel-tab intel-gap" : "intel-tab"} onClick={() => onTab(b.id)}>{t(b.key as Parameters<typeof t>[0])}</button>
        ))}
      </div>
      <div className="intel-status" title={t("earth.escHint")}>
        {where && <span className="intel-where">{where}</span>}
        <span className="intel-live"><i aria-hidden />{t("earth.live")}</span>
        {now && <time dateTime={now.toISOString()}>{now.toLocaleTimeString(lang === "et" ? "et-EE" : "en-GB", { hour: "2-digit", minute: "2-digit" })}</time>}
      </div>
    </nav>
  );
}
