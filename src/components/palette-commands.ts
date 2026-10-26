// Warp palette command registry: the one place to add a place or quick action (CommandPalette.tsx reads COMMANDS).
// Rule: a command only navigates or opens a screen. Anything that approves, sends, spends or deletes opens where the
// owner decides it; it never does it from here. (Stop-all ON is the exception: it only pauses work, after the same confirm as the HUD button.)
import { PLANETS } from "@/lib/planets";
import { NAV_EVENT, type NavTarget, type LifeView } from "@/lib/nav-pure";
import { notify } from "@/lib/notify-pure";
import { VOICE_ASK } from "./voice/bus";
import { SHORTCUTS_EVENT } from "./ShortcutsOverlay";
import { TERMINAL_EVENT } from "@/lib/terminal-pure";
import { ACTIVE_CHAT_KEY, CORE_NEW_CHAT } from "@/lib/core-chats-pure";
import { changeStopAll } from "./nav-command";

export type Command = { id: string; group: "Go to" | "Actions"; label: string; hint?: string; keywords?: string; run: () => void };

export const nav = (t: NavTarget) => dispatchEvent(new CustomEvent(NAV_EVENT, { detail: t }));
const go = (id: string, label: string, t: NavTarget, hint?: string, keywords?: string): Command => ({ id: `go:${id}`, group: "Go to", label, hint, keywords, run: () => nav(t) });
const act = (id: string, label: string, run: () => void, hint?: string, keywords?: string): Command => ({ id: `act:${id}`, group: "Actions", label, hint, keywords, run });
const lifeTab = (tab: LifeView, label: string, keywords: string) => go(`life-${tab}`, label, { panel: "life", life: tab }, "LIFE tab", keywords);

export const COMMANDS: Command[] = [
  go("core", "CORE", { panel: "core" }, "AI chat", "chat ai"),
  ...PLANETS.map((p) => go(p.id, p.name, { panel: p.id }, p.blurb, `${p.id} planet world`)),
  go("home", "Galaxy home", { panel: null }, "Back to the galaxy", "home overview"),
  go("profile", "Profile", { panel: "profile" }),
  lifeTab("today", "LIFE · Today", "day agenda"),
  lifeTab("habits", "LIFE · Habits", "streaks"),
  lifeTab("focus", "LIFE · Focus timer", "pomodoro"),
  lifeTab("reminders", "LIFE · Reminders", "remind"),
  lifeTab("journal", "LIFE · Journal", "diary write"),
  go("stats", "STUDIO · Stats", { panel: "studio", view: "stats" }, "Channel analytics", "youtube"),
  go("clips", "STUDIO · Clips", { panel: "studio", view: "clips" }, "Clip factory", "shorts youtube"),
  go("review", "STUDIO · Review queue", { panel: "studio", view: "review" }, "Review new clips", "youtube"),
  go("mission", "Mission control", { panel: null, mission: true }, "The bridge", "bridge overview status"),
  go("work", "Continue my work", { panel: null, continueWork: true }, "Unfinished tasks", "resume unfinished"),

  act("newchat", "New chat", () => {
    try { localStorage.removeItem(ACTIVE_CHAT_KEY); } catch { /* private mode */ } // a CORE panel that mounts now starts empty
    nav({ panel: "core" }); dispatchEvent(new Event(CORE_NEW_CHAT)); // an already-open panel resets
  }, "CORE", "core new conversation start fresh"),
  act("newmemory", "New memory", () => nav({ panel: "memory" }), "Type text first to save it straight away", "capture note add remember"),
  act("focus", "Start focus timer", () => nav({ panel: "life", life: "focus", start: true }), "LIFE", "pomodoro focus mode"),
  // Opens where approvals are decided; the palette never approves.
  act("approvals", "Open approvals", () => nav({ panel: null, mission: true }), "Mission control: what waits for you", "approve pending waiting proposals"),
  act("stopall", "Stop all (pause agents and automations)", () => {
    // Same confirm as the HUD button (StopAll.tsx).
    if (!confirm("Stop everything?\n\nRunning agent tasks, agent teams and goal steps are cancelled, and no automation, scout, autopilot, briefing or suggestion starts until you press Resume. Clip renders already running finish. CORE chat keeps answering.")) return;
    changeStopAll(true).catch((e) => notify({ kind: "system", title: "Stop-all failed", body: e instanceof Error ? e.message : String(e) }));
  }, "Kill switch ON. Resume from the HUD", "kill switch pause halt emergency"),
  act("doctor", "Check ORBIT health", () => nav({ panel: null, doctor: true }), "Run the ORBIT doctor", "doctor diagnostics"),
  act("keys", "Keyboard shortcuts", () => dispatchEvent(new Event(SHORTCUTS_EVENT)), undefined, "keys help"),
  act("terminal", "fsociety terminal", () => dispatchEvent(new Event(TERMINAL_EVENT)), "Live read-only feed ( ` )", "hacker console log mr robot"),
  act("week", "Your week", () => dispatchEvent(new CustomEvent(VOICE_ASK, { detail: { text: "How did my week go?" } })), "What got done, what slipped (CORE)", "week review recap slipped done late wins ask my week"),
  act("morning", "Good morning briefing", () => nav({ panel: null, morning: true }), undefined, "brief daily"),
  act("beliefs", "What ORBIT believes about me", () => nav({ panel: "memory", beliefs: true }), undefined, "beliefs memory"),
  act("evening", "Today in a minute", () => nav({ panel: null, evening: true }), "Evening note (Ctrl/⌘ Shift E)", "evening capture journal log my day diary"),
  act("reminder", "New reminder", () => nav({ panel: "life", life: "reminders" }), "LIFE", "remind me add"),
];
