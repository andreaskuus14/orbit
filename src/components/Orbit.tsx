"use client";
import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { PLANETS, planetById, type PanelId, type PlanetId } from "@/lib/planets";
import { AnalyticsPanel, CorePanel, LaterPanel, MemoryPanel, ProfilePanel } from "./panels";
import { IntelligencePanel } from "./IntelligencePanel";
import { AgentsPanel, OperationsPanel } from "./AgentsPanels";
import { VOICE_ASK, voiceContext } from "./voice/bus";
import { useVoiceInput, VOICE_ASKED } from "./voice/useVoiceInput";
import { VoiceControls } from "./voice/VoiceControls";
import { finish, isSpeaking, speakChunk, speechSettings, stop as stopSpeech } from "./voice/speak";
import { NAV_EVENT, navReply, parseNavCommand, type LifeView, type NavTarget } from "@/lib/nav-pure";
import { StudioNotifier } from "./StudioNotifier";
import { NotificationCenter } from "./NotificationCenter";
import { notify } from "@/lib/notify-pure";
import { OPEN_MEMORY_EVENT, PALETTE_EVENT } from "@/lib/palette-pure";
import { MorningCard } from "./MorningCard";
import { WhatsNew } from "./WhatsNew";
import { DoctorPanel } from "./DoctorPanel";
import { GalaxyLoader } from "./GalaxyLoader";
import { ShortcutsOverlay, SHORTCUTS_EVENT } from "./ShortcutsOverlay";
import { parseQualityMode, type QualityMode } from "@/lib/quality-pure";
import { runFollowCommand } from "./follow-command";
import { runWatchCommand } from "./watch-store";

const Galaxy = dynamic(() => import("./Galaxy"), { ssr: false, loading: () => <GalaxyLoader /> });
const NewsGlobe = dynamic(() => import("./NewsGlobe"), { ssr: false });
const StudioWorld = dynamic(() => import("./StudioWorld"), { ssr: false });
const DevWorld = dynamic(() => import("./DevWorld"), { ssr: false });
const AgentsStation = dynamic(() => import("./AgentsStation"), { ssr: false });
const TheaterWorld = dynamic(() => import("./TheaterWorld"), { ssr: false });
const LifePanel = dynamic(() => import("./LifePanel"), { ssr: false });
const VaultPanel = dynamic(() => import("./VaultPanel").then((m) => m.VaultPanel), { ssr: false });
const LifeReminders = dynamic(() => import("./LifeReminders"), { ssr: false });
const CommandPalette = dynamic(() => import("./CommandPalette").then((m) => m.CommandPalette), { ssr: false });
const WORLDS: PanelId[] = ["studio", "creation", "agents", "theater"]; // full-screen worlds with their own side panel (no drawer)
const ORDER: PanelId[] = ["core", ...PLANETS.map((p) => p.id)];
const WAKE_GREETINGS = ["I'm here. What's on your mind?", "Hey. What can I do for you?", "ORBIT is online. What are we working on?", "Good to see you. What's up?", "I'm listening. Go ahead."];

export default function Orbit({ userId, email }: { userId: string; email: string }) {
  const sb = useMemo(() => createClient(), []);
  const [view, setView] = useState<"3d" | "2d">("2d");
  const [reduced, setReduced] = useState(false);
  const [panel, setPanel] = useState<PanelId | null>(null);
  const [memoryCount, setMemoryCount] = useState(0);
  const [busy, setBusy] = useState(false);
  const [warning, setWarning] = useState(false);
  const [pulseBusy, setPulseBusy] = useState(false);
  const [pulseFailed, setPulseFailed] = useState(false);
  const [runningTasks, setRunningTasks] = useState<string[]>([]); // real: tasks agents are working on right now
  const [focusTask, setFocusTask] = useState<string | null>(null);
  const [automationFailing, setAutomationFailing] = useState(false); // real: an enabled automation's last run failed
  const [cmdMode, setCmdMode] = useState<"ask" | "task">("ask");
  const [cmdErr, setCmdErr] = useState("");
  const [focusMemory, setFocusMemory] = useState<string | null>(null);
  const [pending, setPending] = useState<string | null>(null);
  const [gameOpen, setGameOpen] = useState(false); // pause the 3D galaxy while a full-screen game runs
  const [cmd, setCmd] = useState("");
  const [live, setLive] = useState<"connecting" | "live" | "offline">("connecting");
  const pulses = useRef<Record<string, number>>({});
  const cmdRef = useRef<HTMLInputElement>(null);
  const voice = useVoiceInput();
  const [wakeGreeting, setWakeGreeting] = useState<string | null>(null);
  const [doctor, setDoctor] = useState<null | "click" | "nav">(null); // ORBIT doctor; "nav" (voice/command) reads the result aloud
  const [tapToTalk, setTapToTalk] = useState(false);
  // CORE navigation: sub-targets for the worlds (new object per command), and a world we're flying to through the galaxy.
  const [newsFocus, setNewsFocus] = useState<{ country?: string; region?: string; search?: string } | null>(null);
  const [studioOpen, setStudioOpen] = useState<{ view: "stats" | "clips" | "review" | "none" } | null>(null);
  const [lifeOpen, setLifeOpen] = useState<{ tab: LifeView; start?: true } | null>(null);
  const [approach, setApproach] = useState<PanelId | null>(null);
  // CORE opened from inside a world floats over it instead of leaving it; closing CORE returns to that world.
  const [behind, setBehind] = useState<PanelId | null>(null);
  // The world (or panel) actually on screen. Also while panel is briefly null after closing CORE, so the world isn't remounted.
  const shown = behind && (panel === "core" || panel === null) ? behind : panel;
  const closeWorld = useCallback(() => { setBehind(null); setPanel(null); }, []); // "← Back to galaxy" really leaves, even with CORE open over it
  const isWorld = (p: PanelId | null) => p === "intelligence" || (p !== null && WORLDS.includes(p));
  // A second question keeps the world; a running game is full-screen above everything, so CORE replaces it as before.
  const openCore = useCallback(() => { if (panel !== "core") setBehind(isWorld(panel) && !gameOpen ? panel : null); setPanel("core"); }, [panel, gameOpen]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (panel === null && behind) { setPanel(behind); setBehind(null); }
    else if (panel !== "core" && panel !== null && behind) setBehind(null);
  }, [panel, behind]);
  // Is a 3D scene on screen? The news globe is always 3D, even in "2D view"; the other worlds and the galaxy follow the toggle.
  const scene3d = !gameOpen && (shown === "intelligence" || view === "3d");

  // Fetch the world chunks while idle, so entering a world never waits on a JS download (next/dynamic reuses them).
  useEffect(() => {
    const load = () => { for (const p of [import("./NewsGlobe"), import("./StudioWorld"), import("./DevWorld"), import("./AgentsStation"), import("./TheaterWorld")]) p.catch(() => {}); }; // best-effort warm-up
    if ("requestIdleCallback" in window) requestIdleCallback(load, { timeout: 5000 }); else setTimeout(load, 1500);
  }, []);

  // Back from Google's YouTube consent screen (?studio=…): reopen STUDIO; StudioStats reads and clears the query.
  useEffect(() => { if (new URLSearchParams(location.search).has("studio")) setPanel("studio"); }, []);

  // Opened by scripts/wake ("orbital wake up") as /?wake=1: CORE greets you aloud, then listens for your question.
  // No cleanup on purpose: dev mode re-runs this effect, and the URL is already cleaned so the second run is a no-op.
  const { start: startVoice } = voice;
  useEffect(() => {
    const url = new URL(location.href);
    if (url.searchParams.get("wake") !== "1") return;
    url.searchParams.delete("wake");
    history.replaceState(history.state, "", url.pathname + url.search + url.hash);
    const text = WAKE_GREETINGS[Math.floor(Math.random() * WAKE_GREETINGS.length)];
    setWakeGreeting(text);
    setPanel("core");
    void (async () => {
      if (speechSettings().speak && "speechSynthesis" in window) {
        speakChunk(text);
        // Without a user gesture Chrome rejects speech (unless launched with --autoplay-policy=no-user-gesture-required):
        // it either errors at once or never starts. Not speaking within 1.5 s = blocked.
        const t0 = performance.now();
        let started = false;
        while (!started && isSpeaking() && performance.now() - t0 < 1500) {
          await new Promise((r) => setTimeout(r, 100));
          started = speechSynthesis.speaking;
        }
        if (!started) { stopSpeech(); setTapToTalk(true); return; }
        await finish();
      }
      startVoice();
    })();
  }, [startVoice]);

  // Voice questions (mic or "Hey Orbit") go to CORE whatever the bar's mode; navigation commands fly straight there.
  useEffect(() => {
    const onAsk = (e: Event) => {
      const text = (e as CustomEvent<{ text?: string }>).detail?.text?.trim();
      if (!text) return;
      setCmdErr("");
      const fr = runFollowCommand(text, (msg) => { if (speechSettings().speak) speakChunk(msg); dispatchEvent(new Event("orbit:core-done")); }); // done signal: a voice conversation listens again // "follow Estonia" / "unfollow AI": speaks the real outcome
      if (fr) { stopSpeech(); return; }
      if (runWatchCommand(text, shown, (msg) => { stopSpeech(); if (msg && speechSettings().speak) speakChunk(msg); dispatchEvent(new Event("orbit:core-done")); })) return; // "show me Jynxzi's latest videos", then "the second one"
      let nav = parseNavCommand(text, { current: shown }); // "go to local news"
      if (nav?.zoom && !scene3d) nav = null; // no 3D scene on screen: zooming would do nothing
      if (nav) {
        stopSpeech();
        if (speechSettings().speak) speakChunk(navReply(nav));
        dispatchEvent(new CustomEvent(NAV_EVENT, { detail: nav }));
        dispatchEvent(new Event("orbit:core-done")); // handled here, no CORE stream: a voice conversation listens again
        return;
      }
      dispatchEvent(new CustomEvent(VOICE_ASKED));
      setPending(text); openCore();
    };
    addEventListener(VOICE_ASK, onAsk);
    return () => removeEventListener(VOICE_ASK, onAsk);
  }, [panel, scene3d, shown, openCore]);
  useEffect(() => { voiceContext.current = shown; }, [shown]); // voice prefers alternatives that are commands for this place

  // Default to the fast 2D view when WebGL is missing or the screen is small; the user can switch any time.
  useEffect(() => {
    setReduced(matchMedia("(prefers-reduced-motion: reduce)").matches);
    let webgl = false;
    try { webgl = !!document.createElement("canvas").getContext("webgl2"); } catch { /* no webgl */ }
    if (webgl && innerWidth >= 720) setView("3d");
  }, []);

  useEffect(() => {
    try { if (localStorage.getItem("orbit.cmdMode") === "task") setCmdMode("task"); } catch { /* storage unavailable */ }
    try { setQuality(parseQualityMode(localStorage.getItem("orbit.quality"))); } catch { /* storage unavailable */ }
  }, []);
  const [quality, setQuality] = useState<QualityMode>("auto"); // 3D quality: auto adapts to the frame rate
  const pickQuality = (q: QualityMode) => { setQuality(q); try { localStorage.setItem("orbit.quality", q); } catch { /* storage unavailable */ } };
  // Drawer exit: keep the closed panel on screen for its slide-out, then unmount.
  const [exiting, setExiting] = useState<PanelId | null>(null);
  const prevPanel = useRef(panel);
  useEffect(() => {
    const prev = prevPanel.current;
    prevPanel.current = panel;
    if (panel || !prev || WORLDS.includes(prev) || reduced) { setExiting(null); return; }
    setExiting(prev);
    const t = setTimeout(() => setExiting(null), 200);
    return () => clearTimeout(t);
  }, [panel, reduced]);
  const drawer = panel ?? exiting;
  const switchMode = () => {
    const next = cmdMode === "ask" ? "task" : "ask";
    setCmdMode(next);
    try { localStorage.setItem("orbit.cmdMode", next); } catch { /* storage unavailable */ }
  };

  const refreshAutomations = useCallback(() => {
    fetch("/api/automations").then((r) => (r.ok ? r.json() : null)).then((j) => j && setAutomationFailing(!!j.failing)).catch(() => {});
  }, []);
  useEffect(() => { refreshAutomations(); }, [refreshAutomations]);

  // 2D cards: today's LIFE progress, refreshed whenever a panel closes (habits may have changed).
  const [lifeLine, setLifeLine] = useState("");
  useEffect(() => {
    if (panel) return;
    fetch("/api/life").then((r) => (r.ok ? r.json() : null)).then((st: { habits?: { scheduledToday: boolean; doneToday: boolean }[] } | null) => {
      const today = st?.habits?.filter((h) => h.scheduledToday) ?? [];
      setLifeLine(today.length ? `${today.filter((h) => h.doneToday).length}/${today.length} habits done today` : "");
    }).catch(() => {});
  }, [panel]);
  const refreshCount = useCallback(async () => {
    const { count } = await sb.from("memories").select("id", { count: "exact", head: true });
    setMemoryCount(count ?? 0);
  }, [sb]);

  // The galaxy reacts to real backend events (rows in the `events` table via Supabase Realtime).
  useEffect(() => {
    void refreshCount();
    const ch = sb.channel("orbit-events")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "events", filter: `user_id=eq.${userId}` }, (payload) => {
        const e = payload.new as { type: string; planet: string };
        pulses.current[e.planet] = Date.now();
        if (e.type.startsWith("memory.")) void refreshCount();
        if (e.type === "core.started") setBusy(true);
        if (e.type === "core.completed") { setBusy(false); setWarning(false); }
        if (e.type === "core.failed") { setBusy(false); setWarning(true); }
        if (e.type === "pulse.started") setPulseBusy(true);
        if (e.type === "pulse.completed") { setPulseBusy(false); setPulseFailed(false); dispatchEvent(new Event("orbit:news")); }
        if (e.type === "pulse.failed") { setPulseBusy(false); setPulseFailed(true); }
        const taskId = (payload.new as { payload?: { taskId?: string } }).payload?.taskId;
        if (e.type === "agent.started" && taskId) setRunningTasks((r) => (r.includes(taskId) ? r : [...r, taskId]));
        if ((e.type === "agent.completed" || e.type === "agent.failed") && taskId) { setRunningTasks((r) => r.filter((x) => x !== taskId)); refreshAutomations(); notify({ title: e.type === "agent.completed" ? "Agent task finished" : "Agent task failed", body: `Task ${taskId.slice(0, 8)}`, kind: "agents", nav: { panel: "operations" } }); }
      })
      .subscribe((s) => setLive(s === "SUBSCRIBED" ? "live" : s === "CLOSED" || s === "CHANNEL_ERROR" || s === "TIMED_OUT" ? "offline" : "connecting"));
    return () => { void sb.removeChannel(ch); };
  }, [sb, userId, refreshCount, refreshAutomations]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented) return; // a widget (e.g. a chart's arrow-key scrub) already handled it
      if (document.querySelector("dialog[open], :popover-open")) return; // Esc there closes the overlay/menu, not the panel
      if ((e.metaKey || e.ctrlKey) && !e.shiftKey && e.key.toLowerCase() === "k") { e.preventDefault(); cmdRef.current?.focus(); }
      // ← / → fly to the previous / next planet; Esc closes. Neither while typing (Esc in a form would lose the draft).
      const el = e.target as HTMLElement | null;
      // VIDEO/AUDIO: Chrome seeks a focused player with ←/→ after this handler sees the key.
      const typing = !!el && (/^(INPUT|TEXTAREA|SELECT|VIDEO|AUDIO)$/.test(el.tagName) || el.isContentEditable);
      const inWorld = !!el?.closest?.(".studio, [role=region]"); // arrows inside a world's panels are for its controls
      if (e.key === "Escape" && !typing) { setPanel(null); setApproach(null); }
      if (!typing && !inWorld && !e.altKey && !e.ctrlKey && !e.metaKey && (e.key === "ArrowRight" || e.key === "ArrowLeft")) {
        setPanel((cur) => {
          const i = cur ? ORDER.indexOf(cur) : -1;
          const next = e.key === "ArrowRight" ? (i + 1) % ORDER.length : (i <= 0 ? ORDER.length : i) - 1;
          return ORDER[next];
        });
      }
    };
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  }, []);

  const select = useCallback((id: PanelId) => { setPanel(id); if (id !== "memory") setFocusMemory(null); if (id !== "operations") setFocusTask(null); }, []);
  const openTask = useCallback((id: string) => { setFocusTask(id); setPanel("operations"); }, []);
  const openMemory = useCallback((id: string) => { setFocusMemory(id); setPanel("memory"); }, []);
  useEffect(() => { // search palette picked a memory: open it in MEMORY
    const f = (e: Event) => { const id = (e as CustomEvent<{ id?: string }>).detail?.id; if (typeof id === "string" && id) openMemory(id); };
    addEventListener(OPEN_MEMORY_EVENT, f);
    return () => removeEventListener(OPEN_MEMORY_EVENT, f);
  }, [openMemory]);
  const consumed = useCallback(() => setPending(null), []);

  // orbit:navigate (command bar, CORE, voice): drawers open over the galaxy as a click does; from the galaxy a world is
  // entered by a short flight to its planet, then the world's own fly-in takes over. Between worlds we switch directly.
  useEffect(() => {
    const onNav = (e: Event) => {
      const t = (e as CustomEvent<NavTarget>).detail;
      if (t.zoom) return; // ZoomRig in the canvas on screen handles it
      if (t.doctor) { setDoctor("nav"); return; } // opens over whatever is on screen
      if (t.country || t.region || t.search !== undefined) setNewsFocus({ country: t.country, region: t.region, search: t.search });
      if (t.view) setStudioOpen({ view: t.view });
      if (t.life) setLifeOpen({ tab: t.life, start: t.start });
      if (t.panel === (approach ?? shown)) { if (panel === "core") setPanel(shown); return; } // already there: close CORE over it, the world flies to the sub-target // already there (or on the way): the world flies to the sub-target itself
      const world = t.panel === "intelligence" || (t.panel !== null && WORLDS.includes(t.panel));
      const inWorld = isWorld(shown);
      if (world && !inWorld && view === "3d" && !reduced) { setPanel(null); setApproach(t.panel); return; }
      setApproach(null);
      if (t.panel === "core") openCore(); else if (t.panel) select(t.panel); else closeWorld(); // "galaxy"/"home" really leaves the world
    };
    addEventListener(NAV_EVENT, onNav);
    return () => removeEventListener(NAV_EVENT, onNav);
  }, [panel, shown, approach, view, reduced, select, openCore, closeWorld]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!approach) return;
    const t = setTimeout(() => { setPanel(approach); setApproach(null); }, 1200); // the galaxy's longest fast flight
    return () => clearTimeout(t);
  }, [approach]);
  useEffect(() => { if (panel) setApproach(null); }, [panel]); // a click or arrow key during the flight wins
  // Sub-targets apply to one visit only: drop them once we've left that world.
  useEffect(() => { if (shown !== "intelligence" && approach !== "intelligence") setNewsFocus(null); }, [shown, approach]);
  useEffect(() => { if (shown !== "studio" && approach !== "studio") setStudioOpen(null); }, [shown, approach]);
  useEffect(() => { if (panel !== "life") setLifeOpen(null); }, [panel]); // so reopening LIFE later doesn't replay a start
  const clearGreeting = useCallback(() => setWakeGreeting(null), []);

  async function runCommand(e: React.FormEvent) {
    e.preventDefault();
    if (voice.listening) { voice.stop(); return; } // Enter while talking = done talking
    const text = cmd.trim();
    if (!text) return;
    voice.clearError();
    setCmdErr("");
    if (runFollowCommand(text, (msg, ok) => { if (!ok) setCmdErr(msg); })) { setCmd(""); return; } // "follow Estonia" / "unfollow AI"
    if (runWatchCommand(text, shown, (msg, ok) => { if (!ok) setCmdErr(msg); })) { setCmd(""); return; } // THEATER: find/choose/control videos
    let nav = parseNavCommand(text, { current: shown }); // in either mode
    if (nav?.zoom && !scene3d) nav = null; // no 3D scene on screen: zooming would do nothing ("open game dev" is a place, not a question or a task)
    if (nav) { setCmd(""); dispatchEvent(new CustomEvent(NAV_EVENT, { detail: nav })); return; }
    if (cmdMode === "ask") { setCmd(""); setPending(text); openCore(); return; }
    // Task mode: Nova interprets the request, delegates to the right agents and reports back.
    try {
      const res = await fetch("/api/tasks", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ request: text }) });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Could not create the task");
      setCmd("");
      openTask(json.task.id);
    } catch (err) { setCmdErr(err instanceof Error ? err.message : "Could not create the task"); }
  }

  async function signOut() { await sb.auth.signOut(); location.href = "/login"; }

  const title = drawer === "core" ? "CORE" : drawer === "profile" ? "Your profile" : drawer ? planetById(drawer)!.name : "";

  return (
    <main className="relative h-dvh w-full overflow-hidden">
      {shown === "intelligence" && !gameOpen ? (
        <NewsGlobe reduced={reduced} onClose={closeWorld} focus={newsFocus} />
      ) : shown === "studio" ? (
        <StudioWorld flat={view !== "3d"} reduced={reduced} onClose={closeWorld} onOpenTask={openTask} open={studioOpen} />
      ) : shown === "creation" ? (
        <DevWorld flat={view !== "3d"} reduced={reduced} onClose={closeWorld} onOpenTask={openTask} onPlaying={setGameOpen} />
      ) : shown === "agents" ? (
        <AgentsStation flat={view !== "3d"} reduced={reduced} quality={quality} onClose={closeWorld} onOpenTask={openTask} />
      ) : shown === "theater" ? (
        <TheaterWorld flat={view !== "3d"} reduced={reduced} quality={quality} onClose={closeWorld} />
      ) : view === "3d" && gameOpen ? null : view === "3d" ? (
        <div className="absolute inset-0">
          <Galaxy selected={approach ?? panel} onSelect={select} memoryCount={memoryCount} pulses={pulses} busy={busy} warning={warning} pulseBusy={pulseBusy} pulseFailed={pulseFailed} agentsWorking={runningTasks.length} automationFailing={automationFailing} reduced={reduced} panelOpen={!!panel} fast={!!approach} quality={quality} />
        </div>
      ) : (
        <nav aria-label="Planets" className="absolute inset-0 overflow-y-auto px-4 pb-32 pt-24">
          <ul className="mx-auto grid max-w-3xl gap-3 sm:grid-cols-2">
            <li><button className={`planet-card${warning ? " warn" : ""}`} onClick={() => select("core")} style={{ borderColor: "#7dd3fc" }}>
              <b>CORE</b><span className="muted text-sm">{busy ? "Thinking…" : warning ? "Last request failed" : "Your central AI. Ask anything."}</span></button></li>
            {PLANETS.map((p) => (
              <li key={p.id}><button className="planet-card" onClick={() => select(p.id)} style={{ borderColor: p.color }}>
                <b style={{ color: p.color }}>{p.name}</b>
                <span className="muted text-sm">{p.id === "memory" ? `${memoryCount} memories` : p.id === "intelligence" && pulseBusy ? "Pulse is writing a briefing…" : p.id === "intelligence" && pulseFailed ? "Last briefing failed" : p.id === "operations" && automationFailing ? "An automation's last run failed" : p.id === "life" && lifeLine ? lifeLine : p.id === "agents" && runningTasks.length ? `${runningTasks.length} agent task${runningTasks.length > 1 ? "s" : ""} running…` : p.live ? p.blurb : `${p.blurb} · Phase ${p.phase}`}</span></button></li>
            ))}
          </ul>
        </nav>
      )}

      <header className="absolute inset-x-0 top-0 flex items-center justify-between gap-3 px-4 py-3">
        <button className="logo" onClick={closeWorld} aria-label="ORBIT home">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/brand/orbit-mark.png" alt="" width={40} height={40} onError={(e) => { e.currentTarget.style.display = "none"; }} />
          <span><span className="brand block">ORBIT</span><span className="muted block text-[10px] tracking-[0.2em]">YOUR MIND HAS A UNIVERSE</span></span>
        </button>
        <div className="hud-bar-top">
          <span className={"pill hidden sm:inline-flex " + (live === "live" ? "ok" : live === "offline" ? "bad" : "")} title="Realtime link to the backend that animates the galaxy">{live === "live" ? "LIVE" : live === "offline" ? "OFFLINE" : "CONNECTING"}</span>
          {process.env.NODE_ENV === "development" && <span className="pill hidden lg:inline-flex" title="Running the development server (slower). Start ORBIT from the desktop shortcut for the production server.">DEV</span>}
          <NotificationCenter />
          <StudioNotifier />
          <button className="chip" onClick={() => dispatchEvent(new Event(PALETTE_EVENT))} aria-label="Search everything (Ctrl+P)" title="Search everything: planets, actions, memories, files (Ctrl+P)">⌕</button>
          <button className="chip" onClick={() => setView(view === "3d" ? "2d" : "3d")} title="Switch between the 3D galaxy and the fast 2D list">{view === "3d" ? "2D view" : "3D view"}</button>
          <button className="chip hud-more" popoverTarget="hud-menu" aria-label="More options" title="More: profile, 3D quality, shortcuts, sign out">⋯</button>
        </div>
      </header>
      {/* Native popover: light-dismiss and Esc for free, drawn in the top layer above every panel. */}
      <div id="hud-menu" popover="auto" className="glass hud-menu" aria-label="More options">
        <button className="hud-menu-item" popoverTarget="hud-menu" popoverTargetAction="hide" onClick={() => select("profile")}>Profile</button>
        <div className="hud-menu-group" role="group" aria-label="3D quality">
          <span className="muted">Quality</span>
          {(["auto", "high", "low"] as const).map((q) => (
            <button key={q} className="chip" aria-pressed={quality === q} onClick={() => pickQuality(q)}
              title={q === "auto" ? "Lowers detail when the galaxy stutters, raises it when there's headroom" : q === "high" ? "Always full detail and glow" : "Fewest stars, no glow: smoothest on slow GPUs"}>
              {q[0].toUpperCase() + q.slice(1)}
            </button>
          ))}
        </div>
        <button className="hud-menu-item" popoverTarget="hud-menu" popoverTargetAction="hide" onClick={() => dispatchEvent(new Event(SHORTCUTS_EVENT))}>Keyboard shortcuts <kbd>?</kbd></button>
        <button className="hud-menu-item" onClick={signOut} title={email}>Sign out</button>
      </div>
      <ShortcutsOverlay />
      <CommandPalette />
      <LifeReminders />

      {drawer && !WORLDS.includes(drawer) && (
        <aside className={`glass drawer${behind && WORLDS.includes(behind) ? " drawer-dock" : ""}${panel ? "" : " drawer-out"}`} role="dialog" aria-label={title}
          aria-hidden={!panel || undefined} inert={!panel || undefined}>
          <div className="mb-3 flex items-center justify-between"><h2 className="brand text-base">{title}</h2><button className="chip" onClick={() => setPanel(null)} aria-label="Close panel" title="Close (Esc)">Close</button></div>
          <div className="min-h-0 flex-1 overflow-y-auto">
            {drawer === "core" ? <CorePanel initial={pending} onConsumed={consumed} onOpenMemory={openMemory} greeting={wakeGreeting} onGreeted={clearGreeting} />
              : drawer === "memory" ? <MemoryPanel focusId={focusMemory} onChanged={refreshCount} />
              : drawer === "profile" ? <ProfilePanel />
              : drawer === "analytics" ? <AnalyticsPanel />
              : drawer === "intelligence" ? <IntelligencePanel />
              : drawer === "operations" ? <OperationsPanel focusTask={focusTask} openMemory={openMemory} />
              : drawer === "agents" ? <AgentsPanel onOpenTask={openTask} />
              : drawer === "life" ? <LifePanel open={lifeOpen} />
              : drawer === "vault" ? <VaultPanel />
              : <LaterPanel id={drawer as PlanetId} />}
          </div>
        </aside>
      )}

      <MorningCard home={!shown && !approach} />
      <WhatsNew home={!shown && !approach} />
      {!shown && (
        <aside className="glass hud-panel status-hud" aria-label="System status">
          <div className="hud-title">SYSTEM</div>
          <dl>
            <div><dt>Memories</dt><dd className="num">{memoryCount}</dd></div>
            <div><dt>Agents working</dt><dd className="num">{runningTasks.length}</dd></div>
            <div><dt>CORE</dt><dd className={warning ? "bad" : busy ? "warn" : "ok"}>{busy ? "Thinking" : warning ? "Last request failed" : "Ready"}</dd></div>
            <div><dt>Pulse</dt><dd className={pulseFailed ? "bad" : pulseBusy ? "warn" : "ok"}>{pulseBusy ? "Writing" : pulseFailed ? "Last failed" : "Idle"}</dd></div>
            <div><dt>Automations</dt><dd className={automationFailing ? "bad" : "ok"}>{automationFailing ? "Needs attention" : "OK"}</dd></div>
          </dl>
          <button className="chip mt-2" onClick={() => setDoctor("click")}>🩺 Check ORBIT</button>
          <p className="muted mt-2 text-[10px] tracking-wider">← → FLY BETWEEN PLANETS · ? SHORTCUTS</p>
        </aside>
      )}
      {doctor && <DoctorPanel key={doctor} speak={doctor === "nav"} onClose={() => setDoctor(null)} />}

      {tapToTalk && !voice.listening && (
        <button type="button" className="chip fixed left-1/2 top-1/2 z-50 -translate-x-1/2 -translate-y-1/2 px-10 py-6 text-xl"
          onClick={() => { setTapToTalk(false); voice.start(); }} autoFocus>
          Tap to talk
        </button>
      )}

      <form onSubmit={runCommand} className="glass cmdbar">
        <div className="flex gap-2">
          <button type="button" className="chip shrink-0" onClick={switchMode} title="Switch between asking CORE and giving the agents a task"
            aria-label={`Mode: ${cmdMode === "ask" ? "ask CORE" : "agent task"}. Click to switch.`}>
            {cmdMode === "ask" ? "Ask" : "Task"}
          </button>
          <input ref={cmdRef} className={"field w-full" + (voice.listening ? " voice-live" : "")} value={voice.listening ? voice.interim : cmd} onChange={(e) => setCmd(e.target.value)} maxLength={8000}
            readOnly={voice.listening}
            placeholder={voice.listening ? "Listening… speak your question" : cmdMode === "ask" ? "Ask CORE…  (Ctrl/⌘ K · mic Ctrl+M)" : "Give your agents a task, e.g. research X and save a report"}
            aria-label={voice.listening ? "Live voice transcript" : cmdMode === "ask" ? "Command bar: ask CORE" : "Command bar: give the agents a task"} />
          <VoiceControls voice={voice} />
        </div>
        {(cmdErr || voice.error) && <p className="error mt-1 px-1" role="alert">{cmdErr || voice.error}</p>}
      </form>
    </main>
  );
}
