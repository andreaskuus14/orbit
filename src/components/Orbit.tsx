"use client";
import { PerfBeacon, perfCtx } from "./PerfBeacon";
import { AmbientSound, AmbientSoundMenu } from "./AmbientSound";
import { ambientEvent } from "./spatial-audio";
import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { clearProjectSession } from "@/lib/project-desk-pure";
import { createClient } from "@/lib/supabase/client";
import { PLANETS, planetById, type PanelId } from "@/lib/planets";
import { isPlanetWorld, PLANET_WORLDS } from "@/lib/planet-worlds-pure";
import { WorldPaused } from "./world-paused";
import { CALL_ACTIVE, VOICE_ASK, voiceContext } from "./voice/bus";
import { runObjectCommand } from "./voice/object-command";
import { useVoiceInput, VOICE_ASKED } from "./voice/useVoiceInput";
import { VoiceControls } from "./voice/VoiceControls";
import { finish, isSpeaking, speakChunk, speechSettings, stop as stopSpeech } from "./voice/speak";
import { linkFromHash, linkToHash, shouldPush, type DeepLink } from "@/lib/deeplink-pure";
import { viewKey } from "@/lib/planet-view-pure";
import { NAV_EVENT, parseNavCommand, type LifeView, type NavTarget } from "@/lib/nav-pure";
import { StudioNotifier } from "./StudioNotifier";
import { NotificationCenter } from "./NotificationCenter";
import { StopAll } from "./StopAll";
import { Terminal } from "./Terminal";
import { HalEye } from "./HalEye";
import { notify } from "@/lib/notify-pure";
import { taskNotice } from "@/lib/interruption-pure";
import { OPEN_MEMORY_EVENT, PALETTE_EVENT } from "@/lib/palette-pure";
import { OPEN_SOURCE_EVENT, citeTarget, type WeekCite } from "@/lib/week-pure";
import { MorningCard } from "./MorningCard";
import { MorningBrief } from "./MorningBrief";
import { Herald } from "./Herald";
import { SpeakFirst } from "./SpeakFirst";
import { WhatsNew } from "./WhatsNew";
import { GalaxyLoader } from "./GalaxyLoader";
import { HudFrame } from "./HudFrame";
import { WeeklyCard } from "./WeeklyCard";
import { EveningCapture } from "./EveningCapture";
import { MissionControl } from "./MissionControl";
import { StatusRail } from "./StatusRail";
import { Ticker } from "./Ticker";
import { WarpBurst, WarpOverlay } from "./WarpOverlay";
import { AmbientOverlay, useAmbient } from "./AmbientOverlay";
import { RealSkyToggle } from "./real-sky-toggle";
import { HoloToggle } from "./holo-toggle";
import { sfx } from "./sfx";
import { BootSequence } from "./BootSequence";
import { ShortcutsOverlay, SHORTCUTS_EVENT } from "./ShortcutsOverlay";
import { parseQualityMode, type QualityMode } from "@/lib/quality-pure";
import { runFollowCommand } from "./follow-command";
import { runWatchCommand } from "./watch-store";
import { runAgentCommand } from "./agent-command";
import { runRecipeCommand } from "./recipe-command";
import { OrbitExplore, warmWorld, WorldLoading } from "./OrbitExplore";
import { markOpen } from "./dev-mark";
import { useStageActive } from "./stage-slot";
import { ContinueWork } from "./ContinueWork";
import { WorkView } from "./WorkView";
import type { WorkTab } from "@/lib/work-vocab-pure";
import { NeedsYou } from "./NeedsYou";
import { COMMAND_REPLY_EVENT, runNavCommand } from "./nav-command";
import { TimeTravel, useLivingUniverse } from "./TimeTravel";
import type { ShipTask } from "@/lib/ships-pure";
import { CursorRing } from "./CursorRing";
import { MaskText } from "./MaskText";
import { useDragPanel } from "./useDragPanel";
import { useDialogFocus } from "./useDialogFocus";
import { TimeDilation } from "./TimeDilation";
import { parseVisits, prefetchOrder } from "@/lib/world-prefetch-pure";
import { useT } from "./i18n";
import { LIVING_EVENT } from "@/lib/living-events-pure";
import { BrandMark } from "./BrandMark";

const Galaxy = dynamic(() => import("./Galaxy"), { ssr: false, loading: () => <GalaxyLoader /> });
const PerfRun = dynamic(() => import("./PerfRun"), { ssr: false }); // only with ?perfrun=1
const NewsGlobe = dynamic(() => import("./NewsGlobe"), { ssr: false, loading: WorldLoading });
const StudioWorld = dynamic(() => import("./StudioWorld"), { ssr: false, loading: WorldLoading });
const DevWorld = dynamic(() => import("./DevWorld"), { ssr: false, loading: WorldLoading });
const AgentsStation = dynamic(() => import("./AgentsStation"), { ssr: false, loading: WorldLoading });
const ArchWorld = dynamic(() => import("./ArchWorld"), { ssr: false, loading: WorldLoading });
const TheaterWorld = dynamic(() => import("./TheaterWorld"), { ssr: false, loading: WorldLoading });
const PlanetWorld = dynamic(() => import("./PlanetWorld"), { ssr: false, loading: WorldLoading });
const MemoryWorld = dynamic(() => import("./MemoryWorld"), { ssr: false, loading: WorldLoading });
const LifePanel = dynamic(() => import("./LifePanel"), { ssr: false });
const VaultPanel = dynamic(() => import("./VaultPanel").then((m) => m.VaultPanel), { ssr: false });
const LifeReminders = dynamic(() => import("./LifeReminders"), { ssr: false });
const MarketsPanel = dynamic(() => import("./MarketsPanel"), { ssr: false });
const BusinessPanel = dynamic(() => import("./BusinessPanel"), { ssr: false });
const MarketWatcher = dynamic(() => import("./MarketWatcher"), { ssr: false });
const CommandPalette = dynamic(() => import("./CommandPalette").then((m) => m.CommandPalette), { ssr: false });
// Drawer panels load on first open (panels.tsx is preloaded at boot 3 so CORE still opens at once).
const PanelLoading = () => <p className="text-xs opacity-60" role="status">{useT().t("common.loading")}</p>;
const CorePanel = dynamic(() => import("./panels").then((m) => m.CorePanel), { ssr: false, loading: PanelLoading });
const ProfilePanel = dynamic(() => import("./panels").then((m) => m.ProfilePanel), { ssr: false, loading: PanelLoading });
const AnalyticsPanel = dynamic(() => import("./panels").then((m) => m.AnalyticsPanel), { ssr: false, loading: PanelLoading });
const MemoryPanel = dynamic(() => import("./panels").then((m) => m.MemoryPanel), { ssr: false, loading: PanelLoading });
const IntelligencePanel = dynamic(() => import("./IntelligencePanel").then((m) => m.IntelligencePanel), { ssr: false, loading: PanelLoading });
const AgentsPanel = dynamic(() => import("./AgentsPanels").then((m) => m.AgentsPanel), { ssr: false, loading: PanelLoading });
const OperationsPanel = dynamic(() => import("./AgentsPanels").then((m) => m.OperationsPanel), { ssr: false, loading: PanelLoading });
const DoctorPanel = dynamic(() => import("./DoctorPanel").then((m) => m.DoctorPanel), { ssr: false });
const RemoteCall = dynamic(() => import("./RemoteCall").then((m) => m.RemoteCall), { ssr: false });
const WORLDS: PanelId[] = ["studio", "creation", "agents", "theater", "arch", "memory", ...PLANET_WORLDS]; // full-screen worlds with their own side panel (no drawer)
const VISITS = "orbit.world.visits";
const KEEP: PanelId[] = ["intelligence", "studio", "creation", "agents", "arch", "memory"]; // kept mounted (hidden + paused) after the first visit; not THEATER: leaving must stop its video
const ORDER: PanelId[] = ["core", ...PLANETS.map((p) => p.id)];
const WAKE_GREETINGS = ["I'm here. What's on your mind?", "Hey. What can I do for you?", "Orbital is online. What are we working on?", "Good to see you. What's up?", "I'm listening. Go ahead."];

/** Boot: the HUD's secondary parts mount in idle-time batches after the first paint (1, 2, 3…), each its own short task,
 *  instead of all inside hydration and the galaxy's start-up. Server and first client render agree (0: none of them). */
function useBootBatch(max: number) {
  const [n, setN] = useState(0);
  useEffect(() => {
    if (n >= max) return;
    const next = () => setN(n + 1);
    if (typeof requestIdleCallback !== "function") { const t = setTimeout(next, 300); return () => clearTimeout(t); }
    const id = requestIdleCallback(next, { timeout: 2000 });
    return () => cancelIdleCallback(id);
  }, [n, max]);
  return n;
}

/** A visited world stays mounted while away: hidden, its canvas paused and its polls/global keys off (WorldPaused), so re-entry skips the remount hitch. */
function Kept({ on, children }: { on: boolean; children: ReactNode }) {
  return <div className="kept absolute inset-0" hidden={!on}><WorldPaused.Provider value={!on}>{children}</WorldPaused.Provider></div>;
}

export default function Orbit({ userId, email }: { userId: string; email: string }) {
  const { t, tn } = useT();
  const sb = useMemo(() => createClient(), []);
  const boot = useBootBatch(3);
  useEffect(() => { if (boot >= 3) void import("./panels"); }, [boot]); // warm the CORE drawer after first paint
  const [view, setView] = useState<"3d" | "2d" | null>(null); // null = still deciding: show the loader, never flash the 2D index
  const [reduced, setReduced] = useState(false);
  const [dilation, setDilation] = useState<{ startAt: number; endAt: number } | null>(null); // a time dilation focus block
  const [panel, setPanel] = useState<PanelId | null>(null);
  const [memoryCount, setMemoryCount] = useState(0);
  const [busy, setBusy] = useState(false);
  const [warning, setWarning] = useState(false);
  const [pulseBusy, setPulseBusy] = useState(false);
  const [pulseFailed, setPulseFailed] = useState(false);
  const [runningTasks, setRunningTasks] = useState<string[]>([]); // real: tasks agents are working on right now
  const [shipTasks, setShipTasks] = useState<ShipTask[]>([]); // running + just-finished tasks, drawn as ships in the galaxy
  const [focusTask, setFocusTask] = useState<string | null>(null);
  const [focusGoal, setFocusGoal] = useState<string | null>(null);
  const [focusClient, setFocusClient] = useState<string | null>(null); // BUSINESS row picked by a link
  const [focusReview, setFocusReview] = useState<string | null>(null); // STUDIO production record (#…&k=review&id=…)
  const [radarUrl, setRadarUrl] = useState<string | null>(null); // ?radar=<YouTube link>: shared from the phone (iOS Shortcut) → Idea Radar
  const [automationFailing, setAutomationFailing] = useState(false); // real: an enabled automation's last run failed
  const [hfWeek, setHfWeek] = useState<{ used: number; cap: number } | null>(null); // Higgsfield credits approved this week / weekly cap
  const amb = useAmbient(automationFailing, pulseFailed); // focus / alert / night look over the galaxy
  const [cmdMode, setCmdMode] = useState<"ask" | "task">("ask");
  const [cmdErr, setCmdErr] = useState("");
  const [cmdReply, setCmdReply] = useState("");
  const [workOpen, setWorkOpen] = useState<WorkTab | false>(false);
  useEffect(() => {
    const reply = (e: Event) => { setCmdErr(""); setCmdReply((e as CustomEvent<string>).detail); };
    addEventListener(COMMAND_REPLY_EVENT, reply);
    return () => removeEventListener(COMMAND_REPLY_EVENT, reply);
  }, []);
  const [focusMemory, setFocusMemory] = useState<string | null>(null);
  const [pending, setPending] = useState<string | null>(null);
  const [gameOpen, setGameOpen] = useState(false); // pause the 3D galaxy while a full-screen game runs
  const [cmd, setCmd] = useState("");
  const [live, setLive] = useState<"connecting" | "live" | "offline">("connecting");
  const pulses = useRef<Record<string, number>>({});
  const cmdRef = useRef<HTMLInputElement>(null);
  const voice = useVoiceInput();
  const [wakeGreeting, setWakeGreeting] = useState<string | null>(null);
  const [doctor, setDoctor] = useState<null | "click" | "nav">(null); // Orbital doctor; "nav" (voice/command) reads the result aloud
  const [tapToTalk, setTapToTalk] = useState(false);
  // CORE navigation: sub-targets for the worlds (new object per command), and a world we're flying to through the galaxy.
  const [newsFocus, setNewsFocus] = useState<{ country?: string; region?: string; search?: string } | null>(null);
  const [studioOpen, setStudioOpen] = useState<{ view: NonNullable<NavTarget["view"]> } | null>(null);
  const [lifeOpen, setLifeOpen] = useState<{ tab: LifeView; start?: true } | null>(null);
  const [approach, setApproach] = useState<PanelId | null>(null);
  const [sfxOn, setSfxOn] = useState(true);
  useEffect(() => setSfxOn(sfx.enabled()), []);
  useEffect(() => { if (approach) sfx.whoosh(); }, [approach]);
  // Bigger on the inside: from the galaxy a world is entered through its planet's surface (window planets on), the world
  // crossfading in as the camera crosses it. `quiet`: that world came in through the surface, so no warp burst on top.
  const [dive, setDive] = useState<PanelId | null>(null);
  perfCtx.dive = dive; // the fps meter buckets dive frames on their own
  const [quiet, setQuiet] = useState<PanelId | null>(null);
  useEffect(() => { if (dive) sfx.whoosh(); }, [dive]);
  // CORE opened from inside a world floats over it instead of leaving it; closing CORE returns to that world.
  const [behind, setBehind] = useState<PanelId | null>(null);
  // The world (or panel) actually on screen. Also while panel is briefly null after closing CORE, so the world isn't remounted.
  const shown = behind && (panel === "core" || panel === null) ? behind : panel;
  const closeWorld = useCallback(() => { setBehind(null); setPanel(null); setFocusGoal(null); setFocusMemory(null); }, []); // "← Back to galaxy" really leaves, even with CORE open over it
  const isWorld = (p: PanelId | null) => p === "intelligence" || (p !== null && WORLDS.includes(p));
  // A second question keeps the world; a running game is full-screen above everything, so CORE replaces it as before.
  const openCore = useCallback(() => { if (panel !== "core") setBehind(isWorld(panel) && !gameOpen ? panel : null); setPanel("core"); }, [panel, gameOpen]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (panel === null && behind) { setPanel(behind); setBehind(null); }
    else if (panel !== "core" && panel !== null && behind) setBehind(null);
  }, [panel, behind]);
  // Is a 3D scene on screen? The news globe is always 3D, even in "2D view"; the other worlds and the galaxy follow the toggle.
  const scene3d = !gameOpen && (shown === "intelligence" || view === "3d");
  const [kept, setKept] = useState<PanelId[]>([]);
  useEffect(() => { if (shown && KEEP.includes(shown)) setKept((k) => (k.includes(shown) ? k : [...k, shown])); }, [shown]);
  useEffect(() => { // visits per world: what the idle galaxy prefetches first
    if (!shown || !isWorld(shown)) return;
    try { const v = parseVisits(localStorage.getItem(VISITS)); v[shown] = (v[shown] ?? 0) + 1; localStorage.setItem(VISITS, JSON.stringify(v)); } catch { /* storage off */ }
  }, [shown]); // eslint-disable-line react-hooks/exhaustive-deps
  // The galaxy's shaders are all compiled: fetch the likely next worlds' code, one per idle moment (no GL work).
  const onGalaxyIdle = useCallback(() => {
    let v: Record<string, number> = {};
    try { v = parseVisits(localStorage.getItem(VISITS)); } catch { /* storage off */ }
    const next = prefetchOrder(v, ["studio", "intelligence", ...WORLDS.filter((w) => w !== "studio")]);
    const idle = (f: () => void) => (typeof requestIdleCallback === "function" ? requestIdleCallback(f, { timeout: 10_000 }) : setTimeout(f, 1000));
    const step = () => { const id = next.shift(); if (id) idle(() => { warmWorld(id as PanelId); step(); }); };
    step();
  }, []);
  const at = (id: PanelId) => shown === id && (id !== "intelligence" || !gameOpen); // on screen (a game covers the globe, not its own DevWorld)
  const has = (id: PanelId) => at(id) || kept.includes(id);
  // A full-screen world (or a game) covers the galaxy: it stays mounted but paused, so coming back is instant.
  const covered = gameOpen || isWorld(shown);
  const galaxyGone = covered && !dive; // through the surface: the galaxy keeps drawing under the world's crossfade
  const living = useLivingUniverse(view === "3d" && !covered);
  const staged = useStageActive(); // one-canvas spike: STUDIO draws in the galaxy canvas, so keep it on screen
  useEffect(() => { markOpen(gameOpen ? "game" : covered ? shown ?? "galaxy" : "galaxy"); }, [gameOpen, covered, shown]); // dev-only timing

  // Back from Google's YouTube consent screen (?studio=…): reopen STUDIO; StudioStats reads and clears the query.
  useEffect(() => { if (new URLSearchParams(location.search).has("studio")) setPanel("studio"); }, []);
  const [perfRun, setPerfRun] = useState(false);
  useEffect(() => { setPerfRun(new URLSearchParams(location.search).get("perfrun") === "1"); }, []);
  useEffect(() => {
    const q = new URLSearchParams(location.search), u = q.get("radar");
    if (!u) return;
    q.delete("radar"); history.replaceState(null, "", `${location.pathname}${q.size ? `?${q}` : ""}`); // a reload doesn't read it twice
    setRadarUrl(u); setPanel("agents");
  }, []);

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
    const onAsk = async (e: Event) => {
      const text = (e as CustomEvent<{ text?: string }>).detail?.text?.trim();
      if (!text) return;
      setCmdErr("");
      setCmdReply("");
      let nav = parseNavCommand(text, { current: shown });
      if (nav?.zoom && !scene3d) nav = null;
      if (nav) {
        stopSpeech();
        try {
          const reply = await runNavCommand(nav);
          setCmdReply(reply);
          if (speechSettings().speak) speakChunk(reply);
        } catch (e) { setCmdErr(e instanceof Error ? e.message : "Command failed. Try again."); }
        finally { dispatchEvent(new Event("orbit:core-done")); }
        return;
      }
      if (runObjectCommand(text, (msg) => { setCmdReply(msg); if (speechSettings().speak) speakChunk(msg); dispatchEvent(new Event("orbit:core-done")); })) { stopSpeech(); return; } // "open client Kask", "save this version" (asks first)
      const fr = runFollowCommand(text, (msg) => { if (speechSettings().speak) speakChunk(msg); dispatchEvent(new Event("orbit:core-done")); }); // done signal: a voice conversation listens again // "follow Estonia" / "unfollow AI": speaks the real outcome
      if (fr) { stopSpeech(); return; }
      if (runRecipeCommand(text, (msg) => { setCmdReply(msg); if (speechSettings().speak) speakChunk(msg); dispatchEvent(new Event("orbit:core-done")); })) { stopSpeech(); return; } // "run recipe daily ideas"
      const ar = runAgentCommand(text, (msg) => { if (speechSettings().speak) speakChunk(msg); dispatchEvent(new Event("orbit:core-done")); }); // "Atlas, research CS2 trends": a real task
      if (ar) { stopSpeech(); if (speechSettings().speak) speakChunk(ar); return; }
      if (runWatchCommand(text, shown, (msg) => { stopSpeech(); if (msg && speechSettings().speak) speakChunk(msg); dispatchEvent(new Event("orbit:core-done")); })) return; // "show me Jynxzi's latest videos", then "the second one"
      dispatchEvent(new CustomEvent(VOICE_ASKED));
      setPending(text); openCore();
    };
    addEventListener(VOICE_ASK, onAsk);
    return () => removeEventListener(VOICE_ASK, onAsk);
  }, [panel, scene3d, shown, openCore]);
  useEffect(() => { voiceContext.current = shown; }, [shown]); // voice prefers alternatives that are commands for this place

  // Default to the fast 2D view when WebGL is missing or the screen is small; the user can switch any time.
  useEffect(() => {
    const motion = matchMedia("(prefers-reduced-motion: reduce)");
    const updateMotion = () => setReduced(motion.matches);
    updateMotion();
    motion.addEventListener("change", updateMotion);
    let webgl = false;
    try { webgl = !!document.createElement("canvas").getContext("webgl2"); } catch { /* no webgl */ }
    let saved: string | null = null;
    try { saved = localStorage.getItem("orbit.view"); } catch { /* private mode */ }
    setView(webgl && (saved === "3d" || (saved !== "2d" && innerWidth >= 720 && !motion.matches)) ? "3d" : "2d");
    return () => motion.removeEventListener("change", updateMotion);
  }, []);
  const toggleView = () => {
    const next = view === "3d" ? "2d" : "3d";
    setView(next);
    try { localStorage.setItem("orbit.view", next); } catch { /* private mode */ }
  };

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
    if (panel && panel !== prev) { if (planetById(panel)) sfx.converge(); else sfx.open(); } else if (!panel && prev) sfx.close();
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
  const [lifeProgress, setLifeProgress] = useState<{ done: number; total: number } | null>(null); // drives the LIFE ring in the galaxy
  useEffect(() => {
    if (panel) return;
    fetch("/api/life").then((r) => (r.ok ? r.json() : null)).then((st: { habits?: { scheduledToday: boolean; doneToday: boolean }[] } | null) => {
      const today = st?.habits?.filter((h) => h.scheduledToday) ?? [];
      setLifeLine(today.length ? `${today.filter((h) => h.doneToday).length}/${today.length} habits done today` : "");
      setLifeProgress({ done: today.filter((h) => h.doneToday).length, total: today.length });
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
        dispatchEvent(new CustomEvent(LIVING_EVENT, { detail: e })); // comet / aurora / flare / sunrise in the galaxy
        ambientEvent(e.type, (payload.new as { payload?: { status?: unknown } }).payload); // a soft chime from the planet
        if (e.type.startsWith("memory.")) void refreshCount();
        if (e.type === "core.started") setBusy(true);
        if (e.type === "call.started" || e.type === "call.ended") dispatchEvent(new CustomEvent(CALL_ACTIVE, { detail: { on: e.type === "call.started" } })); // a phone call: "Hey Orbit" off at once
        if (e.type === "core.completed") { setBusy(false); setWarning(false); }
        if (e.type === "core.failed") { setBusy(false); setWarning(true); }
        if (e.type === "pulse.started") setPulseBusy(true);
        if (e.type === "pulse.completed") { setPulseBusy(false); setPulseFailed(false); dispatchEvent(new Event("orbit:news")); }
        if (e.type === "pulse.failed") { setPulseBusy(false); setPulseFailed(true); }
        const taskId = (payload.new as { payload?: { taskId?: string } }).payload?.taskId;
        if (e.type === "goal.update") { const p = (payload.new as { payload?: { title?: string; text?: string } }).payload; notify({ signal: "routine", title: `🎯 ${String(p?.title ?? "Goal")}`, body: String(p?.text ?? ""), kind: "agents", nav: { panel: "agents" } }); }
        if (e.type === "agent.started" && taskId) setRunningTasks((r) => (r.includes(taskId) ? r : [...r, taskId]));
        if ((e.type === "agent.completed" || e.type === "agent.failed") && taskId) {
          setRunningTasks((r) => r.filter((x) => x !== taskId)); refreshAutomations();
          const status = (payload.new as { payload?: { status?: string } }).payload?.status;
          notify(taskNotice(taskId, e.type, status, (payload.new as { payload?: { title?: unknown } }).payload?.title));
        }
      })
      .subscribe((s) => setLive(s === "SUBSCRIBED" ? "live" : s === "CLOSED" || s === "CHANNEL_ERROR" || s === "TIMED_OUT" ? "offline" : "connecting"));
    return () => { void sb.removeChannel(ch); };
  }, [sb, userId, refreshCount, refreshAutomations]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented) return; // a widget (e.g. a chart's arrow-key scrub) already handled it
      if (document.querySelector("dialog[open], :popover-open")) return; // Esc there closes the overlay/menu, not the panel
      // ← / → fly to the previous / next planet; Esc closes. Neither while typing (Esc in a form would lose the draft).
      const el = e.target as HTMLElement | null;
      // VIDEO/AUDIO: Chrome seeks a focused player with ←/→ after this handler sees the key.
      const typing = !!el && (/^(INPUT|TEXTAREA|SELECT|VIDEO|AUDIO)$/.test(el.tagName) || el.isContentEditable);
      const inWorld = !!el?.closest?.(".studio, [role=region]"); // arrows inside a world's panels are for its controls
      // Fast path (roadmap 37): Alt+W opens Work without the galaxy. Plain W is taken (ARCH walk, review keys); e.code so macOS Option still works.
      if (e.altKey && !e.ctrlKey && !e.metaKey && e.code === "KeyW") { e.preventDefault(); setWorkOpen("work"); return; }
      if (e.key === "Escape" && !typing) { setPanel(null); setApproach(null); setDive(null); }
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

  const select = useCallback((id: PanelId) => { warmWorld(id); setPanel(id); if (id !== "memory") setFocusMemory(null); if (id !== "operations") setFocusTask(null); if (id !== "agents") setFocusGoal(null); }, []);
  // A dive needs the galaxy's window planets: 3D view, no reduced motion (that keeps today's direct entry), quality > 0.
  const canDive = (id: PanelId | null) => isWorld(id) && view === "3d" && !reduced && !covered && Number(perfCtx.level) > 0;
  const enterWorld = useCallback((id: PanelId) => { warmWorld(id); setPanel(null); setApproach(null); setDive(id); }, []);
  const galaxySelect = useCallback((id: PanelId) => { if (canDive(id)) enterWorld(id); else select(id); }, [view, reduced, covered, enterWorld, select]); // eslint-disable-line react-hooks/exhaustive-deps
  const diveRef = useRef(dive);
  diveRef.current = dive;
  const onDiveCross = useCallback(() => { const d = diveRef.current; if (d) { setQuiet(d); select(d); } }, [select]);
  const onDiveCancel = useCallback(() => setDive(null), []);
  useEffect(() => {
    if (!dive) return;
    if (panel === dive) { const t = setTimeout(() => setDive(null), 420); return () => clearTimeout(t); } // crossfade done: the galaxy may pause
    if (panel) { setDive(null); return; } // a click or key during the dive wins
    const t = setTimeout(onDiveCross, 1200); // the galaxy never drew the crossing (hidden tab, lost context): land anyway
    return () => clearTimeout(t);
  }, [dive, panel, onDiveCross]);
  useEffect(() => { if (quiet && shown !== quiet) setQuiet(null); }, [shown, quiet]);
  const openTask = useCallback((id: string) => { setWorkOpen(false); setFocusTask(id); setFocusGoal(null); setPanel("operations"); }, []);
  const ships = useMemo(() => ({ tasks: shipTasks, onOpen: openTask }), [shipTasks, openTask]);
  useEffect(() => { // agent events change runningTasks → refresh the fleet; a slow poll catches approvals and finishes without events
    if (view !== "3d" || covered) return;
    let off = false;
    const load = () => {
      const since = new Date(Date.now() - 60_000).toISOString();
      // Live tasks and recent finishes in separate queries: newer finished tasks must never push a running one out of the
      // snapshot (a missing task reads as "done", so its ship would fly home and relaunch).
      const cols = "id,title,agent,status,request";
      void Promise.all([
        sb.from("tasks").select(cols).is("parent_id", null).in("status", ["running", "awaiting_approval"]).order("created_at", { ascending: false }).limit(12),
        sb.from("tasks").select(cols).is("parent_id", null).gte("finished_at", since).order("finished_at", { ascending: false }).limit(6),
      ]).then(([live, fin]) => { if (!off && live.data) setShipTasks([...live.data, ...(fin.data ?? [])].slice(0, 12) as ShipTask[]); });
    };
    load();
    const t = setInterval(() => { if (!document.hidden) load(); }, 20_000);
    return () => { off = true; clearInterval(t); };
  }, [sb, runningTasks, view, covered]);
  useEffect(() => { // SYSTEM rail's Higgsfield readout, only while the rail is on screen
    if (shown || view !== "3d") return;
    let off = false;
    const load = () => void fetch("/api/higgsfield", { cache: "no-store" }).then((r) => (r.ok ? r.json() : null)).then((j) => { if (!off && j && typeof j.used === "number") setHfWeek(j); }, () => {});
    load();
    const t = setInterval(() => { if (!document.hidden) load(); }, 60_000);
    return () => { off = true; clearInterval(t); };
  }, [shown, view]);
  const openGoal = useCallback((id: string) => { setWorkOpen(false); setFocusGoal(id); setPanel("agents"); }, []);
  const openMemory = useCallback((id: string) => { setFocusMemory(id); setPanel("memory"); }, []);
  useEffect(() => { // search palette picked a memory: open it in MEMORY
    const f = (e: Event) => { const id = (e as CustomEvent<{ id?: string }>).detail?.id; if (typeof id === "string" && id) openMemory(id); };
    addEventListener(OPEN_MEMORY_EVENT, f);
    return () => removeEventListener(OPEN_MEMORY_EVENT, f);
  }, [openMemory]);
  useEffect(() => { // a CORE week citation: open its goal, task or place
    const f = (e: Event) => {
      const t = citeTarget((e as CustomEvent<WeekCite>).detail ?? { id: "", kind: "" });
      if (t && "goal" in t) openGoal(t.goal); else if (t && "task" in t) openTask(t.task); else if (t) dispatchEvent(new CustomEvent(NAV_EVENT, { detail: t.nav }));
    };
    addEventListener(OPEN_SOURCE_EVENT, f);
    return () => removeEventListener(OPEN_SOURCE_EVENT, f);
  }, [openGoal, openTask]);
  const consumed = useCallback(() => setPending(null), []);

  // Deep links (G02/G20): the open planet, its view and the selected record live in the URL hash (deeplink-pure.ts),
  // so refresh restores them and Back steps out of a record before it leaves the world.
  const applyLink = useCallback((l: DeepLink | null) => {
    setWorkOpen(false); setApproach(null); setDive(null);
    if (!l) { closeWorld(); return; }
    // shortcut: a view only applies when the workspace mounts (useWorkspaceView reads it then); Back between tabs of an open workspace doesn't switch them.
    if (l.view) try { localStorage.setItem(viewKey(l.planet), l.view); } catch { /* storage off: first view */ }
    if (l.planet === "core") openCore(); else select(l.planet);
    const id = (k: DeepLink["kind"]) => (l.kind === k ? l.id! : null);
    setFocusTask(id("task")); setFocusGoal(id("goal")); setFocusMemory(id("memory")); setFocusClient(id("client")); setFocusReview(id("review"));
  }, [openCore, select]); // eslint-disable-line react-hooks/exhaustive-deps
  const [linkReady, setLinkReady] = useState(false);
  useEffect(() => { const l = linkFromHash(location.hash); if (l) applyLink(l); setLinkReady(true); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const applyRef = useRef(applyLink);
  applyRef.current = applyLink;
  useEffect(() => {
    const f = () => applyRef.current(linkFromHash(location.hash));
    addEventListener("popstate", f);
    return () => removeEventListener("popstate", f);
  }, []);
  const here = useMemo<DeepLink | null>(() => {
    if (!shown) return null;
    const rec = shown === "operations" && focusTask ? { kind: "task" as const, id: focusTask } : shown === "agents" && focusGoal ? { kind: "goal" as const, id: focusGoal }
      : shown === "memory" && focusMemory ? { kind: "memory" as const, id: focusMemory } : shown === "business" && focusClient ? { kind: "client" as const, id: focusClient } : shown === "studio" && focusReview ? { kind: "review" as const, id: focusReview } : {};
    let view: string | null = null;
    try { view = localStorage.getItem(viewKey(shown)); } catch { /* none */ }
    return { planet: shown, ...(view && { view }), ...rec };
  }, [shown, focusTask, focusGoal, focusMemory, focusClient, focusReview]);
  useEffect(() => {
    if (!linkReady) return;
    const from = linkFromHash(location.hash), h = linkToHash(here);
    if ((!here && !from) || h === location.hash) return;
    const url = location.pathname + location.search + h;
    if (shouldPush(from, here)) history.pushState(null, "", url); else history.replaceState(history.state, "", url);
  }, [here, linkReady]);

  // orbit:navigate (command bar, CORE, voice): drawers open over the galaxy as a click does; from the galaxy a world is
  // entered by a short flight to its planet, then the world's own fly-in takes over. Between worlds we switch directly.
  useEffect(() => {
    const onNav = (e: Event) => {
      const t = (e as CustomEvent<NavTarget>).detail;
      if (t.continueWork) { setWorkOpen(t.workTab ?? "work"); return; }
      if (t.open && t.panel) { applyLink({ planet: t.panel, ...t.open }); return; } // a record: straight there, selected
      setWorkOpen(false);
      if (t.zoom) return; // ZoomRig in the canvas on screen handles it
      if (t.mission) return; // MissionControl opens itself over whatever is on screen
      if (t.evening) return; // EveningCapture opens itself over whatever is on screen
      if (t.doctor) { setDoctor("nav"); return; } // opens over whatever is on screen
      if (t.country || t.region || t.search !== undefined) setNewsFocus({ country: t.country, region: t.region, search: t.search });
      if (t.view) setStudioOpen({ view: t.view });
      if (t.life) setLifeOpen({ tab: t.life, start: t.start });
      if (t.panel === (dive ?? approach ?? shown)) { if (panel === "core") setPanel(shown); return; } // already there: close CORE over it, the world flies to the sub-target // already there (or on the way): the world flies to the sub-target itself
      const world = t.panel === "intelligence" || (t.panel !== null && WORLDS.includes(t.panel));
      const inWorld = isWorld(shown);
      if (world && canDive(t.panel)) { enterWorld(t.panel!); return; }
      if (world && !inWorld && view === "3d" && !reduced) { warmWorld(t.panel!); setPanel(null); setApproach(t.panel); return; }
      setApproach(null); setDive(null);
      if (t.panel === "core") openCore(); else if (t.panel) select(t.panel); else closeWorld(); // "galaxy"/"home" really leaves the world
    };
    addEventListener(NAV_EVENT, onNav);
    return () => removeEventListener(NAV_EVENT, onNav);
  }, [panel, shown, approach, dive, view, reduced, select, openCore, closeWorld, enterWorld, applyLink]); // eslint-disable-line react-hooks/exhaustive-deps
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
    setCmdReply("");
    let nav = parseNavCommand(text, { current: shown }); // direct commands work in Ask and Task mode
    if (nav?.zoom && !scene3d) nav = null;
    if (nav) {
      setCmd(""); stopSpeech();
      try { setCmdReply(await runNavCommand(nav)); }
      catch (e) { setCmdErr(e instanceof Error ? e.message : "Command failed. Try again."); }
      return;
    }
    if (runRecipeCommand(text, (msg, ok) => { if (ok) setCmdReply(msg); else setCmdErr(msg); })) { setCmd(""); return; } // "run recipe daily ideas": no CORE call
    if (runFollowCommand(text, (msg, ok) => { if (!ok) setCmdErr(msg); })) { setCmd(""); return; } // "follow Estonia" / "unfollow AI"
    if (runWatchCommand(text, shown, (msg, ok) => { if (!ok) setCmdErr(msg); })) { setCmd(""); return; } // THEATER: find/choose/control videos
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

  async function signOut() { try { clearProjectSession(sessionStorage); } catch { /* storage off */ } await sb.auth.signOut(); location.href = "/login"; }

  const docked = !!behind && WORLDS.includes(behind);
  const drawerDrag = useDragPanel<HTMLElement>(drawer && !docked ? `drawer:${drawer}` : null);
  useDialogFocus(drawerDrag.ref, !!panel && !WORLDS.includes(panel)); // Esc is the window handler above
  const statusDrag = useDragPanel<HTMLElement>(!shown && view === "3d" ? "status" : null);
  const panelBody = (id: PanelId) => (id === "core" ? <CorePanel initial={pending} onConsumed={consumed} onOpenMemory={openMemory} greeting={wakeGreeting} onGreeted={clearGreeting} />
      : id === "profile" ? <ProfilePanel />
      : id === "analytics" ? <AnalyticsPanel />
      : id === "intelligence" ? <IntelligencePanel />
      : id === "operations" ? <OperationsPanel focusTask={focusTask} onOpen={setFocusTask} openMemory={openMemory} />
      : id === "agents" ? <AgentsPanel onOpenTask={openTask} />
      : id === "life" ? <LifePanel open={lifeOpen} />
      : id === "vault" ? <VaultPanel />
      : id === "markets" ? <MarketsPanel />
      : id === "business" ? <BusinessPanel focusId={focusClient} onFocus={setFocusClient} />
              : null);
  const title = drawer === "core" ? "CORE" : drawer === "profile" ? t("hud.profile") : drawer && planetById(drawer) ? t(`planet.${planetById(drawer)!.id}`) : "";

  return (
    <main className="orbit-shell relative h-dvh w-full overflow-hidden" data-view={view} data-dive-in={quiet ?? undefined} data-diving={dive ? "" : undefined}>
      {view === "3d" && !shown && <HudFrame />}
      {boot >= 2 && view === "3d" && !shown && !approach && <Ticker />}
      {view === "3d" && <WarpOverlay target={approach} landed={panel} reduced={reduced} />}
      {view === "3d" && <WarpBurst id={isWorld(shown) && shown !== quiet ? shown : null} reduced={reduced} />}
      {view === "3d" && !shown && <AmbientOverlay a={amb} />}
      {view === "3d" && !shown && living.open && <TimeTravel days={living.days} setDays={living.setDays} onClose={() => { living.setOpen(false); living.setDays(0); }} />}
      {view === "3d" && <BootSequence reduced={reduced} />}
      {view === "3d" && (
        <div className="galaxy-layer absolute inset-0" data-dim={(panel === "core" && !dive) || undefined} style={galaxyGone && !staged ? { visibility: "hidden" } : undefined} inert={(galaxyGone && !staged) || undefined}>
          <Galaxy selected={approach ?? panel} onSelect={galaxySelect} memoryCount={memoryCount} pulses={pulses} busy={busy} warning={warning} pulseBusy={pulseBusy} bloomScale={amb.bloomScale} pulseFailed={pulseFailed} agentsWorking={runningTasks.length} automationFailing={automationFailing} reduced={reduced} panelOpen={!!panel && !dive} fast={!!approach} quality={quality} lifeProgress={lifeProgress} paused={galaxyGone} universe={living.universe} ships={ships} dilation={dilation}
            dive={dive} onDiveCross={onDiveCross} onDiveCancel={onDiveCancel} onIdle={onGalaxyIdle} />
        </div>
      )}
      {/* Worlds stay mounted after their first visit (hidden + paused): re-entering skips the rebuild, shader compile and texture upload. */}
      {has("intelligence") && <Kept on={at("intelligence")}><NewsGlobe reduced={reduced} quality={quality} onClose={closeWorld} focus={newsFocus} paused={!at("intelligence")} /></Kept>}
      {has("studio") && <Kept on={at("studio")}><StudioWorld flat={view !== "3d"} reduced={reduced} quality={quality} onClose={closeWorld} onOpenTask={openTask} open={studioOpen} paused={!at("studio")} review={focusReview} onReview={setFocusReview} /></Kept>}
      {has("creation") && <Kept on={at("creation")}><DevWorld flat={view !== "3d"} reduced={reduced} quality={quality} onClose={closeWorld} onOpenTask={openTask} onPlaying={setGameOpen} paused={!at("creation")} /></Kept>}
      {has("agents") && <Kept on={at("agents")}><AgentsStation flat={view !== "3d"} reduced={reduced} quality={quality} onClose={closeWorld} onOpenTask={openTask} focusGoal={focusGoal} radarUrl={radarUrl} onRadarDone={() => setRadarUrl(null)} paused={!at("agents")} /></Kept>}
      {has("arch") && <Kept on={at("arch")}><ArchWorld flat={view !== "3d"} reduced={reduced} quality={quality} onClose={closeWorld} paused={!at("arch")} /></Kept>}
      {has("memory") && <Kept on={at("memory")}><MemoryWorld flat={view !== "3d"} reduced={reduced} quality={quality} onClose={closeWorld} focusId={focusMemory} onChanged={refreshCount} paused={!at("memory")} List={MemoryPanel} /></Kept>}
      {shown && KEEP.includes(shown) && at(shown) ? null : shown === "theater" ? (
        <TheaterWorld flat={view !== "3d"} reduced={reduced} quality={quality} onClose={closeWorld} />
      ) : isPlanetWorld(shown) ? (
        <PlanetWorld key={shown} id={shown} flat={view !== "3d"} reduced={reduced} quality={quality} onClose={closeWorld}>{panelBody(shown)}</PlanetWorld>
      ) : view === null ? <GalaxyLoader /> : view === "3d" ? null : (
        <nav aria-label={t("overview.aria")} className="orbit-overview absolute inset-0 overflow-y-auto px-4 pb-32 pt-24">
          <div className="overview-heading"><p>{t("overview.kicker")}</p><h1>{t("overview.title1")}<br />{t("overview.title2")}</h1><span>{t("overview.lede")}</span></div>
          {!shown && <ContinueWork onOpenTask={openTask} onOpenGoal={openGoal} />}
          <ul className="overview-worlds">
            <li><button className={`planet-card${warning ? " warn" : ""}`} onClick={() => select("core")} style={{ borderColor: "#7dd3fc" }}>
              <b>CORE</b><span className="muted text-sm">{busy ? t("overview.thinking") : warning ? t("overview.lastFailed") : t("overview.core")}</span></button></li>
            {PLANETS.map((p) => (
              <li key={p.id}><button className="planet-card" onPointerEnter={() => warmWorld(p.id)} onFocus={() => warmWorld(p.id)} onClick={() => select(p.id)} style={{ borderColor: p.color }}>
                <b style={{ color: p.color }}>{t(`planet.${p.id}`)}</b>
                <span className="muted text-sm">{p.id === "memory" ? tn("overview.memories", memoryCount) : p.id === "intelligence" && pulseBusy ? t("overview.pulseBusy") : p.id === "intelligence" && pulseFailed ? t("overview.pulseFailed") : p.id === "operations" && automationFailing ? t("overview.autoFailed") : p.id === "life" && lifeLine ? lifeLine : p.id === "agents" && runningTasks.length ? tn("overview.running", runningTasks.length) : t(`planet.${p.id}.blurb`)}</span></button></li>
            ))}
          </ul>
        </nav>
      )}

      <header className="absolute inset-x-0 top-0 flex items-center justify-between gap-3 px-4 py-3">
        <button className="logo" onClick={closeWorld} aria-label={t("hud.home")}>
          <BrandMark size={40} />
          <span><span className="brand block">Orbital</span><span className="muted block text-[10px] tracking-[0.2em]">{t("hud.tagline")}</span></span>
        </button>
        <div className="hud-bar-top">
          <span className={"pill hidden sm:inline-flex " + (live === "live" ? "ok" : live === "offline" ? "bad" : "")} title={t("hud.liveTitle")}>{t(live === "live" ? "hud.live" : live === "offline" ? "hud.offline" : "hud.connecting")}</span>
          {process.env.NODE_ENV === "development" && <span className="pill hidden lg:inline-flex" title="Running the development server (slower). Start Orbital from the desktop shortcut for the production server.">DEV</span>}
          <StopAll />
          <TimeDilation onSpan={setDilation} />
          <NotificationCenter home={!shown && !approach && !gameOpen} />
          <StudioNotifier />
          <OrbitExplore selected={shown} onSelect={select} />
          <button className="chip hud-search hud-phone-menu" onClick={() => dispatchEvent(new Event(PALETTE_EVENT))} aria-label={t("hud.search")} title={t("hud.searchTitle")}>⌕</button>
          <button className="chip hud-phone-menu" onClick={() => setWorkOpen("work")} aria-keyshortcuts="Alt+W" title={t("hud.workTitle")}>{t("hud.work")}</button>
          <button className="chip hud-phone-menu" onClick={toggleView} title={t("hud.viewTitle")}>{t(view === "3d" ? "hud.index" : "hud.galaxy")}</button>
          <button className="chip hud-more" popoverTarget="hud-menu" aria-label={t("hud.more")} title={t("hud.moreTitle")}>⋯</button>
        </div>
      </header>
      {/* Native popover: light-dismiss and Esc for free, drawn in the top layer above every panel. */}
      <div id="hud-menu" popover="auto" className="glass hud-menu" aria-label={t("hud.more")}>
        <button className="hud-menu-item" popoverTarget="hud-menu" popoverTargetAction="hide" onClick={() => dispatchEvent(new Event(PALETTE_EVENT))}>{t("menu.search")} <kbd>Ctrl+K</kbd></button>
        {/* On a phone Work and Galaxy/Index leave the top bar (it didn't fit) and live here. */}
        <button className="hud-menu-item hud-menu-phone" popoverTarget="hud-menu" popoverTargetAction="hide" onClick={() => setWorkOpen("work")}>{t("hud.work")}</button>
        <button className="hud-menu-item hud-menu-phone" popoverTarget="hud-menu" popoverTargetAction="hide" onClick={toggleView}>{t(view === "3d" ? "hud.index" : "hud.galaxy")}</button>
        <button className="hud-menu-item" popoverTarget="hud-menu" popoverTargetAction="hide" onClick={() => select("profile")}>{t("menu.profile")}</button>
        <div className="hud-menu-group" role="group" aria-label={t("menu.qualityGroup")}>
          <span className="muted">{t("menu.quality")}</span>
          {(["auto", "high", "low"] as const).map((q) => (
            <button key={q} className="chip" aria-pressed={quality === q} onClick={() => pickQuality(q)}
              title={t(`quality.${q}.title`)}>
              {t(`quality.${q}`)}
            </button>
          ))}
        </div>
        <button className="hud-menu-item" popoverTarget="hud-menu" popoverTargetAction="hide" onClick={() => living.setOpen(true)}>{t("menu.timeTravel")}</button>
        <button className="hud-menu-item" popoverTarget="hud-menu" popoverTargetAction="hide" onClick={() => dispatchEvent(new CustomEvent<NavTarget>(NAV_EVENT, { detail: { panel: null, mission: true } }))}>{t("menu.mission")}</button>
        <button className="hud-menu-item" popoverTarget="hud-menu" popoverTargetAction="hide" onClick={() => dispatchEvent(new Event(SHORTCUTS_EVENT))}>{t("menu.shortcuts")} <kbd>?</kbd></button>
        <RealSkyToggle />
        <HoloToggle />
        <button className="hud-menu-item" aria-pressed={sfxOn} onClick={() => { sfx.set(!sfxOn); setSfxOn(!sfxOn); if (!sfxOn) sfx.tick(); }}>{t("menu.sounds", { state: t(sfxOn ? "common.on" : "common.off") })}</button>
        <AmbientSoundMenu />
        <button className="hud-menu-item" onClick={signOut} title={email}>{t("menu.signOut")}</button>
      </div>
      {boot >= 2 && <CursorRing />}
      <PerfBeacon />
      <AmbientSound />
      {perfRun && <PerfRun />}
      {boot >= 3 && <><ShortcutsOverlay /><Terminal /><MissionControl /><CommandPalette /><LifeReminders /><MarketWatcher /><RemoteCall compact /></>}

      {drawer && !WORLDS.includes(drawer) && (
        <aside ref={drawerDrag.ref} tabIndex={-1} className={`glass drawer${docked ? " drawer-dock" : ""}${panel ? "" : " drawer-out"}`} role="dialog" aria-label={title}
          aria-hidden={!panel || undefined} inert={!panel || undefined}>
          <div className="drag-handle mb-3 flex items-center justify-between" {...(docked ? {} : drawerDrag.handle)}><h2 className="brand text-base"><MaskText key={title} text={title} /></h2><button className="chip" onClick={() => setPanel(null)} aria-label={t("hud.closePanel")} title={t("hud.closeEsc")}>{t("common.close")}</button></div>
          <div className="min-h-0 flex-1 overflow-y-auto">
            {drawer && panelBody(drawer)}
          </div>
        </aside>
      )}

      {boot >= 1 && <>
        <MorningCard home={!shown && !approach} onOpenTask={openTask} onOpenGoal={openGoal} />
        <WeeklyCard home={!shown && !approach} />
        <EveningCapture />
        <Herald home={!shown && !approach && !gameOpen} coreBusy={busy} />
        <SpeakFirst />
        <WhatsNew home={!shown && !approach} />
        <MorningBrief home={!shown && !approach} onOpenTask={openTask} onOpenGoal={openGoal} />
      </>}
      {boot >= 2 && !shown && !approach && view === "3d" && <NeedsYou onOpenTask={openTask} onOpenGoal={openGoal} />}{/* Continue my work: the overview, its command and NeedsYou's link */}
      {boot >= 2 && !shown && !approach && <HalEye />}
      {!shown && view === "3d" && (
        <aside ref={statusDrag.ref} className="glass hud-panel status-hud" aria-label={t("sys.aria")}>
          <div className="hud-title drag-handle" {...statusDrag.handle}>{t("sys.title")}</div>
          <StatusRail items={[
            { label: "CORE", value: busy ? t("sys.thinking") : warning ? t("overview.lastFailed") : t("sys.ready"), tone: warning ? "bad" : "ok", busy },
            { label: t("sys.agents"), value: runningTasks.length ? t("sys.working", { n: runningTasks.length }) : t("sys.idle"), tone: "ok", busy: runningTasks.length > 0 },
            { label: "Pulse", value: pulseBusy ? t("sys.writing") : pulseFailed ? t("sys.lastFailed") : t("sys.idle"), tone: pulseFailed ? "bad" : "ok", busy: pulseBusy },
            { label: t("sys.automations"), value: automationFailing ? t("sys.attention") : t("sys.ok"), tone: automationFailing ? "bad" : "ok" },
            { label: t("sys.memories"), value: String(memoryCount), tone: "ok" },
            ...(hfWeek ? [{ label: "Higgsfield", value: t("sys.hfWeek", { used: hfWeek.used, cap: hfWeek.cap }), tone: hfWeek.used >= hfWeek.cap ? "bad" as const : hfWeek.used >= hfWeek.cap * 0.8 ? "warn" as const : "ok" as const }] : []),
          ]} />
          <button className="chip mt-2" onClick={() => setDoctor("click")}>{t("sys.check")}</button>
          <p className="muted mt-2 text-[10px] tracking-wider">{t("sys.keys")}</p>
        </aside>
      )}
      {doctor && <DoctorPanel key={doctor} speak={doctor === "nav"} onClose={() => setDoctor(null)} />}
      {workOpen && <aside aria-label={t("cmd.workAria")} className="glass work-sheet fixed inset-x-4 top-24 bottom-28 z-50 mx-auto max-w-2xl overflow-y-auto p-4"
        onKeyDown={(e) => { if (e.key === "Escape") { e.stopPropagation(); setWorkOpen(false); cmdRef.current?.focus(); } }}>
        <button type="button" className="chip mb-2" autoFocus onClick={() => { setWorkOpen(false); cmdRef.current?.focus(); }}>{t("cmd.closeWork")}</button>
        <WorkView tab={workOpen} onTab={setWorkOpen} onOpenTask={openTask} onOpenGoal={openGoal} />
      </aside>}

      {tapToTalk && !voice.listening && (
        <button type="button" className="chip fixed left-1/2 top-1/2 z-50 -translate-x-1/2 -translate-y-1/2 px-10 py-6 text-xl"
          onClick={() => { setTapToTalk(false); voice.start(); }} autoFocus>
          {t("cmd.tapToTalk")}
        </button>
      )}

      <form onSubmit={runCommand} className="glass cmdbar">
        <div className="flex gap-2">
          <button type="button" className="chip shrink-0" onClick={switchMode} title={t("cmd.modeTitle")}
            aria-label={t("cmd.modeAria", { mode: t(cmdMode === "ask" ? "cmd.modeAsk" : "cmd.modeTask") })}>
            {t(cmdMode === "ask" ? "cmd.ask" : "cmd.task")}
          </button>
          <input ref={cmdRef} className={"field w-full" + (voice.listening ? " voice-live" : "")} value={voice.listening ? voice.interim : cmd} onChange={(e) => setCmd(e.target.value)} maxLength={8000}
            readOnly={voice.listening}
            placeholder={t(voice.listening ? "cmd.listening" : cmdMode === "ask" ? "cmd.askPh" : "cmd.taskPh")}
            aria-label={t(voice.listening ? "cmd.liveAria" : cmdMode === "ask" ? "cmd.askAria" : "cmd.taskAria")} />
          <VoiceControls voice={voice} />
        </div>
        {(cmdErr || voice.error) && <p className="error mt-1 px-1" role="alert">{cmdErr || voice.error}</p>}
        {cmdReply && <p className="muted mt-1 px-1" role="status">{cmdReply}</p>}
      </form>
    </main>
  );
}
