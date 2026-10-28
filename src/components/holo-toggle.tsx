"use client";
// HUD ⋯ menu switch for the Holo HUD theme (default on). The theme is pure CSS keyed off <html data-holo="off">.
import { useEffect, useState } from "react";
import { useT } from "./i18n";

const KEY = "orbit.holo";

export function HoloToggle() {
  const { t } = useT();
  const [on, setOn] = useState(true);
  useEffect(() => { try { setOn(localStorage.getItem(KEY) !== "0"); } catch { /* storage off: keep default */ } }, []);
  useEffect(() => { if (on) delete document.documentElement.dataset.holo; else document.documentElement.dataset.holo = "off"; }, [on]);
  const flip = () => { setOn(!on); try { localStorage.setItem(KEY, on ? "0" : "1"); } catch { /* storage off */ } };
  return <button className="hud-menu-item" aria-pressed={on} onClick={flip} title={t("menu.holoTitle")}>{t("menu.holo", { state: t(on ? "common.on" : "common.off") })}</button>;
}
