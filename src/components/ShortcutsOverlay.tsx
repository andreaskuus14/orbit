"use client";
// "?" (when not typing) opens a list of ORBIT's keyboard shortcuts. Also opened by the header menu via SHORTCUTS_EVENT.
import { useEffect, useRef } from "react";
import { useT } from "./i18n";
import { Button } from "./ui/Button";
import { IconClose } from "./ui/icons";
import "@/app/planet-ui.css";
import type { Key } from "@/lib/i18n-en-pure";

export const SHORTCUTS_EVENT = "orbit:shortcuts";

// Gathered from the handlers: Orbit.tsx, EveningCapture.tsx, voice/VoiceControls.tsx, ReviewQueue.tsx, ClipFactory.tsx. Keep in sync when adding keys.
const GROUPS: [Key, [string, Key][]][] = [
  ["keys.d20", [
    ["keys.k.ctrlK", "keys.d1"],
    ["Ctrl M", "keys.d2"],
    ["Alt W", "keys.d3"],
    ["Ctrl/⌘ Shift E", "keys.d4"],
    ["keys.k.escCore", "keys.d5"],
    ["keys.k.upEmpty", "keys.d6"],
    ["Enter", "keys.d7"],
    ["Esc", "keys.d8"],
    ["← →", "keys.d9"],
    ["?", "keys.d10"],
    ["keys.k.backtick", "keys.d11"],
  ]],
  ["keys.d21", [
    ["A", "keys.d12"],
    ["R", "keys.d13"],
    ["V", "keys.d14"],
    ["T", "keys.d15"],
    ["M", "keys.d16"],
    ["← →", "keys.d17"],
    ["Esc", "keys.d18"],
  ]],
  ["keys.d22", [["← →", "keys.d19"]]],
];

export function ShortcutsOverlay() {
  const ref = useRef<HTMLDialogElement>(null);
  const { t } = useT();
  useEffect(() => {
    const open = () => { const d = ref.current; if (d && !d.open) d.showModal(); };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "?" || e.ctrlKey || e.metaKey || e.altKey || e.defaultPrevented) return;
      const el = e.target as HTMLElement | null;
      if (el && (/^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName) || el.isContentEditable)) return;
      e.preventDefault();
      if (ref.current?.open) ref.current.close(); else open();
    };
    addEventListener("keydown", onKey);
    addEventListener(SHORTCUTS_EVENT, open);
    return () => { removeEventListener("keydown", onKey); removeEventListener(SHORTCUTS_EVENT, open); };
  }, []);
  return (
    <dialog ref={ref} className="pu pu-modal" data-planet="core" aria-labelledby="keys-title"
      onClick={(e) => { if (e.target === e.currentTarget) e.currentTarget.close(); }}>
      <div className="pu-modal-head">
        <h2 id="keys-title" className="pu-title">{t("keys.title")}</h2>
        <Button variant="ghost" icon={<IconClose />} label={t("common.close")} onClick={() => ref.current?.close()} autoFocus />
      </div>
      {GROUPS.map(([name, rows]) => (
        <section key={name}>
          <h3 className="pu-modal-group">{t(name)}</h3>
          <dl className="keys-list">
            {rows.map(([k, what]) => <div key={name + k}><dt><kbd>{k.startsWith("keys.") ? t(k as Key) : k}</kbd></dt><dd>{t(what)}</dd></div>)}
          </dl>
        </section>
      ))}
    </dialog>
  );
}
