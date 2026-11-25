"use client";
// HUD ⋯ menu switch for the galaxy's real sky (default on). No three.js here: Orbit's main chunk imports it.
import { useEffect, useState } from "react";
import { useT } from "./i18n";

const KEY = "orbit.realSky", EVENT = "orbit:real-sky";
const read = () => { try { return localStorage.getItem(KEY) !== "0"; } catch { return true; } };

export function useRealSkyOn() {
  const [on, setOn] = useState(true);
  useEffect(() => {
    const sync = () => setOn(read());
    sync();
    addEventListener(EVENT, sync);
    return () => removeEventListener(EVENT, sync);
  }, []);
  return on;
}

export function RealSkyToggle() {
  const { t } = useT();
  const on = useRealSkyOn();
  const flip = () => { try { localStorage.setItem(KEY, on ? "0" : "1"); } catch { /* storage off */ } dispatchEvent(new Event(EVENT)); };
  return <button className="hud-menu-item" aria-pressed={on} onClick={flip} title={t("sky.tip")}>{t("sky.state", { state: t(on ? "common.on" : "common.off") })}</button>;
}
