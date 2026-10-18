"use client";
import { useEffect, useState } from "react";
import { NAV_EVENT, type NavTarget } from "@/lib/nav-pure";
import { PALETTE_EVENT } from "@/lib/palette-pure";
import { TERMINAL_EVENT } from "@/lib/terminal-pure";

// One-time "what's new" card after an update. Bump KEY's version when a new round ships something worth showing.
const KEY = "orbit.whatsnew.2026-10-18b";
const ITEMS: { icon: string; title: string; text: string; go?: NavTarget; event?: string }[] = [
  { icon: "✨", title: "Pop-ups", text: "ORBIT now pops up uploads due, viral trends (Clip it), briefings and breaking news. Mute it in the 🔔 bell." },
  { icon: "🔥", title: "Blowing up in your niche", text: "Trend Radar → Rising shows Shorts exploding in your niche right now.", go: { panel: "creation" } },
  { icon: "📚", title: "Viral study", text: "Press 📚 Study on a viral Short: ORBIT learns why it works and edits your clips that way.", go: { panel: "studio", view: "clips" } },
  { icon: "🏆", title: "Winners vs flops", text: "See which of your Shorts won or flopped and why. Autopilot learns from it.", go: { panel: "studio", view: "clips" } },
  { icon: "🔺", title: "Rising games", text: "Trend Radar → Rising spots Roblox games growing fast, before they peak.", go: { panel: "creation" } },
  { icon: "🟦", title: "The Grid", text: "GAME DEV → Grid: your scripts as a neon city. Red buildings have errors.", go: { panel: "creation" } },
  { icon: "🐝", title: "The Hive", text: "GAME DEV → Hive: 6 AI minds brainstorm, vote and give you the top 3.", go: { panel: "creation" } },
  { icon: "💻", title: "fsociety terminal", text: "Press the key left of 1 for a live hacker view of agents, health and usage.", event: TERMINAL_EVENT },
  { icon: "🔴", title: "ORBIT eye", text: "The eye on the home screen glows when ORBIT listens or talks. Click it to mute." },
  { icon: "🧠", title: "CORE deep mode", text: "Start with “deep:” or say “think hard” — CORE plans, answers and double-checks.", go: { panel: "core" } },
  { icon: "📁", title: "CORE makes real files", text: "“Build me a website” saves real files. Open them in VAULT → Workspaces with ▶ preview.", go: { panel: "vault" } },
  { icon: "🏗", title: "GAME DEV Wave B", text: "Map from your reference board, asset packs, GUI scripts and before/after build history.", go: { panel: "creation" } },
  { icon: "👋", title: "Welcome back", text: "After 3+ hours away, one card shows what happened while you were gone." },
  { icon: "🎙", title: "Voice", text: "Say “let's just talk” for open mic. Try “ORBIT mic” and “Remember my voice” in voice settings." },
  { icon: "🌍", title: "Every country", text: "All countries on the globe, local news per country (Estonia: ERR, Postimees).", go: { panel: "intelligence" } },
  { icon: "💬", title: "CORE chats & projects", text: "☰ Chats to reopen old chats, ＋ New, and projects with pinned notes.", go: { panel: "core" } },
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
  const close = () => { setOpen(false); try { localStorage.setItem(KEY, "1"); } catch { /* ignore */ } };
  useEffect(() => {
    if (!open || !home) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") close(); };
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  }, [open, home]);
  if (!open || !home) return null;
  const go = (it: (typeof ITEMS)[number]) => {
    close();
    if (it.go) dispatchEvent(new CustomEvent(NAV_EVENT, { detail: it.go }));
    else if (it.event) dispatchEvent(new Event(it.event));
  };
  return (
    <>
    {/* Phones only (CSS): the card becomes a top sheet over a tap-to-dismiss backdrop. */}
    <div className="sheet-backdrop" onClick={close} aria-hidden />
    <section className="glass hud-panel whats-new absolute left-3 top-16 z-20 w-[min(22rem,calc(100vw-1.5rem))] p-4 text-sm" role="dialog" aria-labelledby="whats-new-title">
      <div className="mb-2 flex items-center justify-between">
        <h2 id="whats-new-title" className="hud-title">WHAT&apos;S NEW</h2>
        <button className="chip" onClick={close} aria-label="Dismiss what's new" autoFocus>Got it</button>
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
    </>
  );
}
