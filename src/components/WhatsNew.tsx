"use client";
import { useEffect, useState } from "react";
import { NAV_EVENT, type NavTarget } from "@/lib/nav-pure";
import { PALETTE_EVENT } from "@/lib/palette-pure";

// One-time "what's new" card after an update. Bump KEY's version when a new round ships something worth showing.
const KEY = "orbit.whatsnew.2026-10-16b";
const ITEMS: { icon: string; title: string; text: string; go?: NavTarget; event?: string }[] = [
  { icon: "🏕", title: "GAME DEV: Roblox tools", text: "Scene from a sentence, free-model virus scan, textures, code helper, style lock and a playtest bot.", go: { panel: "creation" } },
  { icon: "🛠", title: "Devlog → Shorts", text: "Point OBS at the devlog folder; recordings become “Day N” Shorts in REVIEW.", go: { panel: "studio", view: "clips" } },
  { icon: "🌱", title: "LIFE", text: "Habits with streaks, reminders (also “every day at 9”), a focus timer and a journal. Say “start focus”.", go: { panel: "life" } },
  { icon: "🗄️", title: "VAULT", text: "Your private files on this PC: drop, preview, search inside, ask CORE.", go: { panel: "vault" } },
  { icon: "⌕", title: "Search everything", text: "Ctrl+P: planets, actions, memories and files.", event: PALETTE_EVENT },
  { icon: "📅", title: "STUDIO calendar", text: "Your week of Shorts and free slots, in Clip Factory → Calendar.", go: { panel: "studio", view: "clips" } },
  { icon: "🧠", title: "From your memory", text: "The morning briefing brings back what you saved a week, month or year ago." },
  { icon: "🔔", title: "Notifications", text: "The bell keeps STUDIO notes, reminders and agent results." },
  { icon: "🎬", title: "THEATER", text: "Your creators as chips, and Continue watching.", go: { panel: "theater" } },
];

export function WhatsNew({ home }: { home: boolean }) {
  const [open, setOpen] = useState(false);
  useEffect(() => { try { if (!localStorage.getItem(KEY)) setOpen(true); } catch { /* no storage: skip the card */ } }, []);
  if (!open || !home) return null;
  const close = () => { setOpen(false); try { localStorage.setItem(KEY, "1"); } catch { /* ignore */ } };
  const go = (it: (typeof ITEMS)[number]) => {
    close();
    if (it.go) dispatchEvent(new CustomEvent(NAV_EVENT, { detail: it.go }));
    else if (it.event) dispatchEvent(new Event(it.event));
  };
  return (
    <section className="glass hud-panel whats-new absolute left-3 top-16 z-20 w-[min(22rem,calc(100vw-1.5rem))] p-4 text-sm" aria-label="What's new in ORBIT">
      <div className="mb-2 flex items-center justify-between">
        <h2 className="hud-title">WHAT&apos;S NEW</h2>
        <button className="chip" onClick={close} aria-label="Dismiss what's new">Got it</button>
      </div>
      <ul className="grid gap-2">
        {ITEMS.map((it) => (
          <li key={it.title}>
            {it.go || it.event
              ? <button className="w-full text-left" onClick={() => go(it)}><b>{it.icon} {it.title}</b> <span className="muted">{it.text}</span></button>
              : <p><b>{it.icon} {it.title}</b> <span className="muted">{it.text}</span></p>}
          </li>
        ))}
      </ul>
    </section>
  );
}
