"use client";
// "?" (when not typing) opens a list of ORBIT's keyboard shortcuts. Also opened by the header menu via SHORTCUTS_EVENT.
import { useEffect, useRef } from "react";

export const SHORTCUTS_EVENT = "orbit:shortcuts";

// Gathered from the handlers: Orbit.tsx, voice/VoiceControls.tsx, ReviewQueue.tsx, ClipFactory.tsx. Keep in sync when adding keys.
const GROUPS: [string, [string, string][]][] = [
  ["Everywhere", [
    ["Ctrl/⌘ K", "Focus the command bar (or CORE's input when CORE is open)"],
    ["Ctrl/⌘ P", "Search everything: planets, actions, memories, VAULT files"],
    ["Ctrl M", "Start / stop voice input"],
    ["Esc (CORE answering)", "Stop the answer"],
    ["↑ (empty CORE input)", "Bring back your last question"],
    ["Enter", "While listening: done talking"],
    ["Esc", "Cancel listening · close a popover or panel"],
    ["← →", "Fly to the previous / next planet"],
    ["?", "Show this list"],
  ]],
  ["Studio · review queue", [
    ["A", "Approve clip"],
    ["R", "Reject (then 1–9 for a reason, Enter to confirm)"],
    ["V", "Versions"],
    ["T", "Edit title"],
    ["M", "Mute / unmute"],
    ["← →", "Previous / next clip"],
    ["Esc", "Back out / close the queue"],
  ]],
  ["Studio · clip factory", [["← →", "Switch tabs (when a tab is focused)"]]],
];

export function ShortcutsOverlay() {
  const ref = useRef<HTMLDialogElement>(null);
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
    <dialog ref={ref} className="glass keys-overlay" aria-labelledby="keys-title"
      onClick={(e) => { if (e.target === e.currentTarget) e.currentTarget.close(); }}>
      <div className="mb-3 flex items-center justify-between gap-4">
        <h2 id="keys-title" className="hud-title">KEYBOARD SHORTCUTS</h2>
        <button className="chip" onClick={() => ref.current?.close()} autoFocus>Close</button>
      </div>
      {GROUPS.map(([name, rows]) => (
        <section key={name} className="mb-3 last:mb-0">
          <h3 className="h3 mb-1.5">{name}</h3>
          <dl className="keys-list">
            {rows.map(([k, what]) => <div key={name + k}><dt><kbd>{k}</kbd></dt><dd>{what}</dd></div>)}
          </dl>
        </section>
      ))}
    </dialog>
  );
}
