"use client";
// A planet's "simple page / all tools" choice, per viewer (localStorage), shared live between the parts of one planet
// (INTELLIGENCE: the globe and its panel). Kept apart from PlanetHome so light worlds can read it without its imports.
import { useEffect, useState } from "react";

const MANUAL_EVENT = "orbit:planet-manual";

export function useManual(planet: string): [boolean, (on: boolean) => void] {
  const key = `orbit.manual.${planet}`;
  const [on, setOn] = useState(false);
  useEffect(() => {
    try { setOn(localStorage.getItem(key) === "1"); } catch { /* no storage: simple view */ }
    const sync = (e: Event) => { const d = (e as CustomEvent<{ planet: string; on: boolean }>).detail; if (d?.planet === planet) setOn(d.on); };
    addEventListener(MANUAL_EVENT, sync);
    return () => removeEventListener(MANUAL_EVENT, sync);
  }, [key, planet]);
  return [on, (v: boolean) => {
    setOn(v); try { localStorage.setItem(key, v ? "1" : "0"); } catch { /* no storage */ }
    dispatchEvent(new CustomEvent(MANUAL_EVENT, { detail: { planet, on: v } }));
  }];
}
