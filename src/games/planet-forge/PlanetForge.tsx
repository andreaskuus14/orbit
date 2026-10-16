"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  createInitialState, step, buyUpgrade, develop, decommission, buildGate, parseSave, serialize, minable,
  planetStatus, planetEffects, devCost, devBlocker, gateBlocker, gateRemaining, gateProgress, upgradeCost, missing, canAfford,
  capacity, nearGate, planetDef, planetPos, fmtBag, won,
  PLANETS, RESOURCES, UPGRADES, UPGRADE_IDS, OBJECTIVES, GATE_OBJECTIVE, UNSTABLE_BELOW, RECOVER_AT, WORLD, DEFAULT_SETTINGS,
  type GameState, type GameEvent, type SaveFile, type PlanetId, type Settings, type ActionResult, type Bag, type UpgradeId, type DevPath,
} from "./rules";
import { createFx, fxEvents, updateFx, draw, fitView, toWorld, RES_COLOR, STATUS_COLOR, type Fx, type View } from "./render";
import { play, isMuted, setMuted } from "./audio";
import { createSaveQueue } from "../saves";

const API = "/api/games/planet-forge";
type Overlay = "intro" | "pause" | "reset" | "won" | null;
type Toast = { id: number; text: string; tone: "info" | "good" | "warn" };
type SaveStatus = { kind: "idle" | "saving" | "saved" | "error" | "off"; text?: string };
const AUTOSAVE_MS = 30_000;

export default function PlanetForge({ onExit }: { onExit: () => void }) {
  const [phase, setPhase] = useState<{ kind: "loading" } | { kind: "error"; message: string } | { kind: "damaged"; error: string; raw: unknown } | { kind: "ready" }>({ kind: "loading" });
  const [hud, setHud] = useState<GameState | null>(null);
  const [overlay, setOverlayState] = useState<Overlay>(null);
  const [shop, setShop] = useState(false);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [notices, setNotices] = useState<string[]>([]);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>({ kind: "idle" });
  const [muted, setMutedState] = useState(false);
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const stateRef = useRef<GameState>(createInitialState());
  const fxRef = useRef<Fx>(createFx(stateRef.current));
  const settingsRef = useRef<Settings>(DEFAULT_SETTINGS);
  const overlayRef = useRef<Overlay>(null);
  const keys = useRef(new Set<string>());
  const mineHeld = useRef(false);
  const viewRef = useRef<View>(fitView(1, 1, 1));
  const hoverRef = useRef<PlanetId | "gate" | null>(null);
  const reduced = useRef(false);
  const savingEnabled = useRef(true);
  const loaded = useRef(false); // a game is in memory; only then may an unmount save over the stored one
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const throttle = useRef<Record<string, number>>({});
  const toastId = useRef(0);
  const shopRef = useRef(false);

  const setOverlay = useCallback((o: Overlay) => { overlayRef.current = o; setOverlayState(o); }, []);
  const syncHud = useCallback(() => setHud(stateRef.current), []);

  const toast = useCallback((text: string, tone: Toast["tone"] = "info", key?: string, every = 0) => {
    if (key) {
      const now = performance.now();
      if (now - (throttle.current[key] ?? -1e9) < every) return;
      throttle.current[key] = now;
    }
    const id = ++toastId.current;
    setToasts((t) => [...t.slice(-3), { id, text, tone }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 3800);
  }, []);

  // ---------- saving ----------
  // One request at a time, newest snapshot wins; a 409 (reset or written elsewhere) stops saving until the game is reopened.
  const [queue] = useState(() => createSaveQueue<SaveFile>(async (save, base, keepalive) => {
    setSaveStatus({ kind: "saving" });
    try {
      const res = await fetch(API, { method: "PUT", headers: { "Content-Type": "application/json" }, keepalive, body: JSON.stringify({ save, ...base }) });
      const json = await res.json().catch(() => ({}));
      if (res.status === 409) {
        const error = json.error || "Your save changed elsewhere. Reopen the game to keep saving.";
        setSaveStatus({ kind: "off", text: `Saving stopped: ${error}` });
        return { ok: false, conflict: true, error };
      }
      if (!res.ok) throw new Error(json.error || `Save failed (${res.status})`);
      setSaveStatus({ kind: "saved", text: `Saved ${new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}` });
      return { ok: true, rev: json.rev };
    } catch (e) {
      const error = e instanceof Error ? e.message : "Save failed";
      setSaveStatus({ kind: "error", text: error });
      return { ok: false, conflict: false, error };
    }
  }));
  const save = useCallback((opts: { keepalive?: boolean } = {}) =>
    savingEnabled.current ? queue.push(serialize(stateRef.current, settingsRef.current), !!opts.keepalive) : Promise.resolve(), [queue]);
  const saveSoon = useCallback(() => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => void save(), 1500);
  }, [save]);

  // ---------- loading ----------
  const startFresh = useCallback((msgs: string[]) => {
    stateRef.current = createInitialState();
    fxRef.current = createFx(stateRef.current);
    setNotices(msgs);
    setOverlay("intro");
    syncHud();
    loaded.current = true;
    setPhase({ kind: "ready" });
  }, [setOverlay, syncHud]);

  const load = useCallback(async () => {
    setPhase({ kind: "loading" });
    try {
      const res = await fetch(API, { cache: "no-store" });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || `Couldn't load your save (${res.status})`);
      const st: Settings = { ...DEFAULT_SETTINGS, ...(json.settings ?? {}) };
      settingsRef.current = st;
      setSettings(st);
      queue.rebase(json.gen ?? 0, json.rev ?? 0);
      savingEnabled.current = true;
      const extra = json.settingsReset ? ["Your stored settings were invalid and have been replaced by the defaults."] : [];
      if (!json.save) return startFresh(extra);
      const parsed = parseSave(json.save, st);
      const damaged = json.damaged || (!parsed.ok && parsed.error);
      if (damaged || !parsed.ok) {
        // Keep the damaged save untouched (the server refuses to overwrite it too) until the player chooses Start fresh.
        savingEnabled.current = false;
        return setPhase({ kind: "damaged", error: String(damaged), raw: json.save });
      }
      stateRef.current = parsed.state;
      fxRef.current = createFx(parsed.state);
      setNotices([...extra, ...parsed.notices]);
      setOverlay(parsed.notices.length || extra.length ? "pause" : won(parsed.state) ? "won" : null);
      syncHud();
      loaded.current = true;
      setPhase({ kind: "ready" });
    } catch (e) {
      setPhase({ kind: "error", message: e instanceof Error ? e.message : "Couldn't load the game" });
    }
  }, [setOverlay, startFresh, syncHud]);

  useEffect(() => {
    reduced.current = matchMedia("(prefers-reduced-motion: reduce)").matches;
    setMutedState(isMuted());
    void load();
  }, [load]);
  // Closed some other way than Exit (e.g. the ORBIT panel closed): keep the progress.
  useEffect(() => () => { if (loaded.current) void save({ keepalive: true }); }, [save]);

  // ---------- events → effects, sound, messages ----------
  const handleEvents = useCallback((events: GameEvent[]) => {
    const s = stateRef.current;
    fxEvents(fxRef.current, s, events, reduced.current);
    for (const e of events) {
      switch (e.type) {
        case "mined": {
          const main = RESOURCES.reduce((a, r) => (e.gains[r] > e.gains[a] ? r : a), "ore" as const);
          const now = performance.now();
          if (now - (throttle.current.sfx ?? 0) > 110) { throttle.current.sfx = now; play(main); }
          break;
        }
        case "cargoFull": toast("Cargo full. Spend resources or upgrade the Cargo Hold (U).", "warn", "cargo", 5000); play("warn"); break;
        case "noPlanet": toast("Fly closer to a planet to mine it.", "info", "noplanet", 4000); break;
        case "status": {
          const name = planetDef(e.planet).name;
          if (e.to === "unstable") { toast(`⚠ ${name} is unstable: mining yield −60% and production stopped.`, "warn"); play("warn"); }
          else if (e.to === "restored") toast(`🌱 Forests are taking root on ${name}.`, "good");
          else if (e.to === "industrialized") toast(`🏭 Factories online on ${name}.`, "good");
          else if (e.from === "unstable") toast(`${name} has stabilised.`, "good");
          else toast(`${name} is back to its natural state.`, "info");
          saveSoon();
          break;
        }
        case "objective": toast(`✓ ${OBJECTIVES[e.index].title}`, "good"); play("objective"); saveSoon(); break;
        case "upgrade": toast(`${UPGRADES[e.id].name} upgraded: ${UPGRADES[e.id].tiers[e.tier].label}`, "good"); play("upgrade"); break;
        case "gate": if (!e.done) { toast(`Delivered ${fmtBag(e.delivered)} to the gate.`, "good"); play("build"); } break;
        case "won": play("win"); setOverlay("won"); void save(); break;
      }
    }
  }, [save, saveSoon, setOverlay, toast]);

  const act = useCallback((fn: (s: GameState) => ActionResult) => {
    const r = fn(stateRef.current);
    if (!r.ok) { toast(r.reason, "warn", `act:${r.reason}`, 1500); play("click"); return; }
    stateRef.current = r.state;
    handleEvents(r.events);
    syncHud();
    saveSoon();
  }, [handleEvents, saveSoon, syncHud, toast]);

  const flyTo = useCallback((id: PlanetId) => {
    stateRef.current = { ...stateRef.current, selected: id, target: { planet: id } };
    play("click");
    syncHud();
  }, [syncHud]);

  // ---------- main loop ----------
  useEffect(() => {
    if (phase.kind !== "ready") return;
    const canvas = canvasRef.current!, wrap = wrapRef.current!;
    const ctx = canvas.getContext("2d");
    if (!ctx) { setPhase({ kind: "error", message: "This browser can't draw the game (canvas unavailable)." }); return; }
    const resize = () => {
      const r = wrap.getBoundingClientRect(), dpr = Math.min(2, devicePixelRatio || 1);
      canvas.width = Math.round(r.width * dpr); canvas.height = Math.round(r.height * dpr);
      const panelH = panelRef.current?.getBoundingClientRect().height ?? 0;
      viewRef.current = fitView(r.width, r.height, dpr, 44, panelH ? panelH + 16 : 0);
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(wrap);
    if (panelRef.current) ro.observe(panelRef.current);
    let raf = 0, last = performance.now(), lastHud = 0, lastAuto = performance.now();
    const frame = (now: number) => {
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      const k = keys.current;
      const input = {
        x: (k.has("d") || k.has("arrowright") ? 1 : 0) - (k.has("a") || k.has("arrowleft") ? 1 : 0),
        y: (k.has("s") || k.has("arrowdown") ? 1 : 0) - (k.has("w") || k.has("arrowup") ? 1 : 0),
        mine: k.has(" ") || mineHeld.current,
      };
      const paused = overlayRef.current !== null;
      if (!paused) {
        const r = step(stateRef.current, input, dt, settingsRef.current);
        stateRef.current = r.state;
        if (r.events.length) handleEvents(r.events);
      }
      const s = stateRef.current;
      updateFx(fxRef.current, s, paused ? 0 : dt, reduced.current);
      const thrust = !paused && (!!input.x || !!input.y || (Math.hypot(s.ship.vx, s.ship.vy) > 25 && !!s.target));
      draw(ctx, viewRef.current, s, fxRef.current, { reduced: reduced.current, mining: !paused && input.mine ? minable(s) : null, thrust, hover: hoverRef.current });
      if (now - lastHud > 100) { lastHud = now; setHud(s); }
      if (!paused && now - lastAuto > AUTOSAVE_MS) { lastAuto = now; void save(); }
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    const onHide = () => { if (document.visibilityState === "hidden") void save({ keepalive: true }); };
    document.addEventListener("visibilitychange", onHide);
    return () => { cancelAnimationFrame(raf); ro.disconnect(); document.removeEventListener("visibilitychange", onHide); };
  }, [phase.kind, handleEvents, save]);

  // ---------- keyboard ----------
  const toggleMute = useCallback(() => { const m = !isMuted(); setMuted(m); setMutedState(m); }, []);
  const exit = useCallback(() => { if (savingEnabled.current) void save({ keepalive: true }); onExit(); }, [onExit, save]);
  useEffect(() => {
    if (phase.kind !== "ready") return;
    const MOVE = ["w", "a", "s", "d", "arrowup", "arrowdown", "arrowleft", "arrowright", " "];
    const down = (e: KeyboardEvent) => {
      e.stopPropagation(); // the game owns the keyboard while it's open (Esc must not close ORBIT's panel)
      const k = e.key.toLowerCase();
      if (MOVE.includes(k) || k === "tab") e.preventDefault();
      if (k === "escape") {
        if (shopRef.current) setShop(false);
        else if (overlayRef.current === "intro" || overlayRef.current === "pause") { setOverlay(null); }
        else if (overlayRef.current === "reset") setOverlay("pause");
        else if (overlayRef.current === null) { setOverlay("pause"); void save(); }
        return;
      }
      if (overlayRef.current !== null) { if (k === "enter" && overlayRef.current === "intro") setOverlay(null); return; }
      if (MOVE.includes(k)) { keys.current.add(k); return; }
      if (e.repeat || e.ctrlKey || e.metaKey || e.altKey) return;
      const s = stateRef.current;
      const sel = s.selected;
      if (k === "tab") {
        const i = PLANETS.findIndex((p) => p.id === sel);
        stateRef.current = { ...s, selected: PLANETS[(i + (e.shiftKey ? PLANETS.length - 1 : 1)) % PLANETS.length].id };
        syncHud();
      } else if (k === "1" || k === "2" || k === "3") flyTo(PLANETS[Number(k) - 1].id);
      else if (k === "enter" && sel) flyTo(sel);
      else if (k === "i" && sel) act((x) => develop(x, sel, "industry"));
      else if (k === "r" && sel) act((x) => develop(x, sel, "restoration"));
      else if (k === "x" && sel) act((x) => decommission(x, sel));
      else if (k === "b") act(buildGate);
      else if (k === "g") { stateRef.current = { ...s, target: { gate: true } }; play("click"); }
      else if (k === "u") setShop((v) => !v);
      else if (k === "m") toggleMute();
    };
    const up = (e: KeyboardEvent) => { keys.current.delete(e.key.toLowerCase()); };
    const blur = () => { keys.current.clear(); mineHeld.current = false; };
    addEventListener("keydown", down, { capture: true });
    addEventListener("keyup", up, { capture: true });
    addEventListener("blur", blur);
    return () => { removeEventListener("keydown", down, { capture: true }); removeEventListener("keyup", up, { capture: true }); removeEventListener("blur", blur); };
  }, [phase.kind, act, flyTo, save, setOverlay, syncHud, toggleMute]);
  useEffect(() => { shopRef.current = shop; }, [shop]);

  // ---------- pointer ----------
  const hitTest = (clientX: number, clientY: number): PlanetId | "gate" | { x: number; y: number } => {
    const rect = canvasRef.current!.getBoundingClientRect();
    const w = toWorld(viewRef.current, clientX - rect.left, clientY - rect.top);
    const s = stateRef.current;
    for (const def of PLANETS) {
      const p = planetPos(def, s.time);
      if (Math.hypot(w.x - p.x, w.y - p.y) <= def.radius + 16) return def.id;
    }
    if (Math.hypot(w.x - WORLD.gate.x, w.y - WORLD.gate.y) <= WORLD.gate.r + 20) return "gate";
    return { x: Math.min(WORLD.w - 20, Math.max(20, w.x)), y: Math.min(WORLD.h - 20, Math.max(20, w.y)) };
  };
  const onPointerDown = (e: React.PointerEvent) => {
    if (overlayRef.current || e.button !== 0) return;
    const hit = hitTest(e.clientX, e.clientY);
    if (hit === "gate") { stateRef.current = { ...stateRef.current, target: { gate: true } }; play("click"); }
    else if (typeof hit === "string") flyTo(hit);
    else stateRef.current = { ...stateRef.current, target: hit };
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const hit = hitTest(e.clientX, e.clientY);
    hoverRef.current = typeof hit === "string" ? hit : null;
    canvasRef.current!.style.cursor = typeof hit === "string" ? "pointer" : "crosshair";
  };
  const mineDown = (e: React.PointerEvent) => { e.preventDefault(); (e.target as HTMLElement).setPointerCapture?.(e.pointerId); mineHeld.current = true; };
  const mineUp = () => { mineHeld.current = false; };

  // ---------- reset ----------
  const reset = useCallback(async (enableSaving = false) => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    try {
      // The queue waits for an in-flight save and drops queued ones, so nothing from the old game lands after the reset.
      await queue.reset(async () => {
        const res = await fetch(API, { method: "DELETE" });
        const json = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(json.error || "Reset failed");
        return json.gen;
      });
      if (enableSaving) savingEnabled.current = true;
      startFresh([]);
      toast("New game started.", "info");
      if (savingEnabled.current) setSaveStatus({ kind: "idle" });
    } catch (e) { toast(e instanceof Error ? e.message : "Reset failed", "warn"); }
  }, [queue, startFresh, toast]);

  const downloadDamaged = (raw: unknown) => {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([JSON.stringify(raw, null, 2)], { type: "application/json" }));
    a.download = `planet-forge-damaged-save-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };

  const playUnsaved = () => {
    savingEnabled.current = false;
    setSaveStatus({ kind: "off", text: "Saving off" });
    settingsRef.current = DEFAULT_SETTINGS;
    startFresh(["Saving is off for this session, so progress will be lost when you close the game."]);
  };

  // ---------- render ----------
  if (phase.kind === "loading") return <Shell onExit={onExit}><div className="grid h-full place-items-center"><p className="muted animate-pulse">Loading Planet Forge…</p></div></Shell>;
  if (phase.kind === "error") return (
    <Shell onExit={onExit}>
      <div className="grid h-full place-items-center p-6">
        <div className="glass max-w-md space-y-3 p-5" role="alert">
          <h2 className="brand">PLANET FORGE</h2>
          <p className="error">{phase.message}</p>
          <div className="flex flex-wrap gap-2">
            <button className="btn" onClick={() => void load()}>Try again</button>
            <button className="chip" onClick={playUnsaved}>Play without saving</button>
            <button className="chip" onClick={onExit}>Back to Game Lab</button>
          </div>
        </div>
      </div>
    </Shell>
  );

  if (phase.kind === "damaged") return (
    <Shell onExit={onExit}>
      <div className="grid h-full place-items-center p-6">
        <div className="glass max-w-md space-y-3 p-5" role="alert">
          <h2 className="brand">PLANET FORGE</h2>
          <p className="error">Your saved game couldn&apos;t be loaded: {phase.error}.</p>
          <p className="text-sm">It is still stored and won&apos;t be overwritten. Download a copy if you want to keep it; Start fresh deletes it and begins a new game.</p>
          <div className="flex flex-wrap gap-2">
            <button className="btn" onClick={() => downloadDamaged(phase.raw)}>Download damaged save</button>
            <button className="btn danger" onClick={() => void reset(true)}>Start fresh</button>
            <button className="chip" onClick={playUnsaved}>Play without saving</button>
            <button className="chip" onClick={onExit}>Back to Game Lab</button>
          </div>
        </div>
      </div>
    </Shell>
  );

  const s = hud ?? stateRef.current;
  return (
    <Shell>
      <div ref={wrapRef} className="absolute inset-0">
        <canvas ref={canvasRef} className="block h-full w-full touch-none" onPointerDown={onPointerDown} onPointerMove={onPointerMove}
          role="img" aria-label={`Planet Forge: ship near ${s.selected ? planetDef(s.selected).name : "open space"}. Objective: ${OBJECTIVES[s.objective]?.title ?? "complete"}.`} />
      </div>

      <ResourcePanel s={s} settings={settings} />
      <ObjectivePanel s={s} onDeliver={() => act(buildGate)} onFlyGate={() => { stateRef.current = { ...stateRef.current, target: { gate: true } }; }} />

      <div className="pointer-events-auto absolute right-3 top-3 flex items-center gap-2 text-xs">
        <span className={saveStatus.kind === "error" ? "error text-xs" : "muted"} title={saveStatus.text}>
          {saveStatus.kind === "saving" ? "Saving…" : saveStatus.kind === "error" ? "Save failed" : saveStatus.text ?? ""}
        </span>
        {saveStatus.kind === "error" && <button className="chip" onClick={() => void save()}>Retry save</button>}
        <button className="chip" onClick={() => setShop((v) => !v)} aria-expanded={shop}>Upgrades (U)</button>
        <button className="chip" onClick={toggleMute} aria-pressed={muted}>{muted ? "Sound off" : "Sound on"}</button>
        <button className="chip" onClick={() => { setOverlay("pause"); void save(); }}>Menu (Esc)</button>
        <button className="chip" onClick={exit}>Exit</button>
      </div>

      <PlanetPanel panelRef={panelRef} s={s} settings={settings} onMineDown={mineDown} onMineUp={mineUp}
        onDevelop={(id, path) => act((x) => develop(x, id, path))} onDecommission={(id) => act((x) => decommission(x, id))}
        onSelect={flyTo} />

      {shop && <ShopPanel s={s} settings={settings} onBuy={(id) => act((x) => buyUpgrade(x, id, settingsRef.current))} onClose={() => setShop(false)} />}

      <div className="pointer-events-none absolute left-1/2 top-3 flex w-[min(28rem,90vw)] -translate-x-1/2 flex-col items-center gap-2" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className="glass px-3 py-1.5 text-sm" style={{ borderColor: t.tone === "warn" ? "#f43f5e" : t.tone === "good" ? "#4ade80" : undefined }}>{t.text}</div>
        ))}
      </div>

      {overlay === "intro" && <Intro notices={notices} onStart={() => { setOverlay(null); setNotices([]); play("click"); }} />}
      {overlay === "pause" && (
        <Modal title="Paused">
          {notices.length > 0 && <Notices notices={notices} />}
          <div className="grid gap-2 sm:grid-cols-2">
            <button className="btn" autoFocus onClick={() => { setOverlay(null); setNotices([]); }}>Resume</button>
            <button className="chip" onClick={() => void save()} disabled={saveStatus.kind === "off"}>Save now</button>
            <button className="chip" onClick={() => setOverlay("intro")}>How to play</button>
            <button className="chip" onClick={exit}>Save &amp; exit to Game Lab</button>
          </div>
          <button className="chip mt-3" style={{ borderColor: "#f43f5e" }} onClick={() => setOverlay("reset")}>Reset game…</button>
        </Modal>
      )}
      {overlay === "reset" && (
        <Modal title="Reset Planet Forge?">
          <p className="text-sm">This deletes your saved game: resources, upgrades, planets and gate progress. Your settings are kept. This can&apos;t be undone.</p>
          <div className="mt-3 flex gap-2">
            <button className="btn danger" onClick={() => void reset()}>Delete save and restart</button>
            <button className="chip" autoFocus onClick={() => setOverlay("pause")}>Cancel</button>
          </div>
        </Modal>
      )}
      {overlay === "won" && (
        <Modal title="Jump gate online">
          <p className="text-sm">You built the gate in <b>{fmtTime(s.time)}</b> of play. Here is the system you leave behind:</p>
          <ul className="my-3 space-y-1 text-sm">
            {s.planets.map((p) => (
              <li key={p.id} className="flex justify-between gap-3"><span>{planetDef(p.id).name}</span>
                <span style={{ color: STATUS_COLOR[planetStatus(p)] }}>{planetStatus(p)}{p.industry ? ` · ${p.industry} factories` : p.restoration ? ` · ecosystem ${p.restoration}` : ""} · {Math.round(p.stability)}% stable</span></li>
            ))}
          </ul>
          <p className="muted text-xs">Mined in total: {fmtBag(roundBag(s.totals))}.</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <button className="btn" autoFocus onClick={() => setOverlay(null)}>Keep exploring</button>
            <button className="chip" onClick={() => setOverlay("reset")}>New game…</button>
            <button className="chip" onClick={exit}>Back to Game Lab</button>
          </div>
        </Modal>
      )}
    </Shell>
  );
}

// ---------- pieces ----------
function Shell({ children, onExit }: { children: React.ReactNode; onExit?: () => void }) {
  return (
    <div className="fixed inset-0 z-[60] overflow-hidden" style={{ background: "#03040d" }} role="dialog" aria-label="Planet Forge">
      {children}
      {onExit && <button className="chip absolute right-3 top-3 z-10" onClick={onExit}>Exit</button>}
    </div>
  );
}

function Modal({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="absolute inset-0 z-20 grid place-items-center bg-black/55 p-4">
      <div className="glass w-full max-w-md p-5" role="dialog" aria-modal="true" aria-label={title}>
        <h2 className="brand mb-3">{title.toUpperCase()}</h2>
        {children}
      </div>
    </div>
  );
}

function Notices({ notices }: { notices: string[] }) {
  return <ul className="card mb-3 space-y-1 text-xs" style={{ borderColor: "#fbbf24" }}>{notices.map((n, i) => <li key={i}>ℹ {n}</li>)}</ul>;
}

function Intro({ notices, onStart }: { notices: string[]; onStart: () => void }) {
  return (
    <Modal title="Planet Forge">
      {notices.length > 0 && <Notices notices={notices} />}
      <ul className="space-y-2 text-sm">
        <li><b style={{ color: RES_COLOR.ore }}>Mine.</b> Fly next to a planet and hold <kbd>Space</kbd> (or the Mine button). Each world gives different resources.</li>
        <li><b style={{ color: "#f43f5e" }}>Mind the planet.</b> Mining lowers stability. Below {UNSTABLE_BELOW}% a world turns unstable: quakes cut your yield.</li>
        <li><b style={{ color: "#fb923c" }}>Industry</b> adds factories and steady output, but pollution drags stability down. <b style={{ color: "#4ade80" }}>Restoration</b> grows forests and renewable energy and heals the planet. Choose one path per world.</li>
        <li><b style={{ color: "#a78bfa" }}>Goal:</b> upgrade your ship and build the jump gate (top right).</li>
      </ul>
      <p className="muted mt-3 text-xs">Fly: WASD/arrows or click · Mine: hold Space · Planets: 1–3 or Tab · Industry I · Restore R · Upgrades U · Gate B · Menu Esc · Mute M</p>
      <button className="btn mt-4 w-full" autoFocus onClick={onStart}>Start</button>
    </Modal>
  );
}

function ResourcePanel({ s, settings }: { s: GameState; settings: Settings }) {
  const cap = capacity(s);
  const rate: Bag = { ore: 0, crystal: 0, energy: 0 };
  for (const p of s.planets) { const fx = planetEffects(p, settings); for (const r of RESOURCES) rate[r] += fx.production[r]; }
  return (
    <div className="glass pointer-events-none absolute left-3 top-3 w-52 space-y-1.5 p-3 text-xs" aria-label="Cargo">
      <div className="h3">Cargo · {cap} each</div>
      {RESOURCES.map((r) => (
        <div key={r}>
          <div className="flex justify-between"><span style={{ color: RES_COLOR[r] }}>● {r}</span>
            <span><b>{Math.floor(s.inventory[r])}</b>{rate[r] > 0.005 && <span className="muted"> +{rate[r].toFixed(1)}/s</span>}</span></div>
          <div className="h-1 rounded bg-white/10"><div className="h-1 rounded" style={{ width: `${(s.inventory[r] / cap) * 100}%`, background: RES_COLOR[r] }} /></div>
        </div>
      ))}
    </div>
  );
}

function ObjectivePanel({ s, onDeliver, onFlyGate }: { s: GameState; onDeliver: () => void; onFlyGate: () => void }) {
  const o = OBJECTIVES[s.objective];
  const onGate = s.objective === GATE_OBJECTIVE;
  const rem = gateRemaining(s);
  const blocker = gateBlocker(s);
  return (
    <div className="glass pointer-events-auto absolute left-3 top-36 w-52 p-3 text-xs" aria-live="polite">
      <div className="h3">Objective {Math.min(s.objective + 1, OBJECTIVES.length)}/{OBJECTIVES.length}</div>
      {o ? (<><b className="text-sm">{o.title}</b><p className="muted mt-0.5">{o.hint}</p></>) : <b className="text-sm">All objectives complete. The system is yours.</b>}
      {onGate && (
        <div className="mt-2 space-y-1">
          <div className="h-1.5 rounded bg-white/10"><div className="h-1.5 rounded" style={{ width: `${gateProgress(s) * 100}%`, background: "#a78bfa" }} /></div>
          <div className="muted">Still needed: {fmtBag(roundBag(rem))}</div>
          <div className="flex flex-wrap gap-2">
            {nearGate(s) ? <button className="btn px-2 py-1 text-xs" onClick={onDeliver} disabled={!!blocker} title={blocker ?? ""}>Deliver cargo (B)</button>
              : <button className="chip" onClick={onFlyGate}>Fly to gate (G)</button>}
            {blocker && nearGate(s) && <span className="muted self-center">{blocker}</span>}
          </div>
        </div>
      )}
    </div>
  );
}

function PlanetPanel({ panelRef, s, settings, onMineDown, onMineUp, onDevelop, onDecommission, onSelect }: {
  panelRef: React.RefObject<HTMLDivElement | null>; s: GameState; settings: Settings; onMineDown: (e: React.PointerEvent) => void; onMineUp: () => void;
  onDevelop: (id: PlanetId, path: DevPath) => void; onDecommission: (id: PlanetId) => void; onSelect: (id: PlanetId) => void;
}) {
  const id = s.selected ?? "ferros";
  const def = planetDef(id), p = s.planets.find((x) => x.id === id)!, status = planetStatus(p), fx = planetEffects(p, settings);
  const minableNow = minable(s) !== null;
  const dev = (path: DevPath) => {
    const cost = devCost(p, path), block = devBlocker(s, id, path);
    const label = path === "industry" ? (p.industry ? `Expand industry ${p.industry + 1}` : "Build industry") : (p.restoration ? `Grow ecosystem ${p.restoration + 1}` : "Restore");
    return { cost, block, label };
  };
  const ind = dev("industry"), res = dev("restoration");
  const prod = RESOURCES.filter((r) => fx.production[r] > 0.005).map((r) => `+${fx.production[r].toFixed(1)} ${r}/s`).join(" · ");
  return (
    <div ref={panelRef} className="glass pointer-events-auto absolute bottom-3 left-1/2 w-[min(40rem,calc(100vw-1.5rem))] -translate-x-1/2 p-3 text-xs">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        {PLANETS.map((d, i) => (
          <button key={d.id} className="chip" onClick={() => onSelect(d.id)} aria-pressed={d.id === id} style={d.id === id ? { borderColor: "#7dd3fc" } : undefined}>{i + 1} · {d.name}</button>
        ))}
        <span className="ml-auto rounded-full px-2 py-0.5 font-semibold uppercase tracking-wider" style={{ color: STATUS_COLOR[status], border: `1px solid ${STATUS_COLOR[status]}` }}>{status}</span>
      </div>
      <div className="grid gap-x-3 gap-y-2 sm:grid-cols-[1fr_11rem]">
        <div className="space-y-1">
          <div className="flex justify-between"><b className="text-sm">{def.name} <span className="muted font-normal">· {def.kind}</span></b>
            <span className="muted">yields {RESOURCES.filter((r) => def.yields[r] >= 0.1).join(", ")}</span></div>
          <EvolutionMeter industry={p.industry} restoration={p.restoration} stability={p.stability} unstable={p.unstable} />
        </div>
        <button className="btn select-none text-sm" onPointerDown={onMineDown} onPointerUp={onMineUp} onPointerCancel={onMineUp} onLostPointerCapture={onMineUp}
          onContextMenu={(e) => e.preventDefault()} aria-label="Mine: hold to mine the nearest planet in range" style={!minableNow ? { opacity: 0.55 } : undefined}>
          {minableNow ? "Hold to mine (Space)" : "Mine: fly closer"}
        </button>
      </div>
      <p className="muted mt-1 leading-snug">{fx.note}{prod && <span style={{ color: "#e6ecff" }}> {prod}</span>}</p>
      <div className="mt-2 grid gap-2 sm:grid-cols-2">
        {p.restoration === 0 && <DevButton label={`${ind.label} (I)`} cost={ind.cost} block={ind.block} color="#fb923c" onClick={() => onDevelop(id, "industry")} />}
        {p.industry === 0 && <DevButton label={`${res.label} (R)`} cost={res.cost} block={res.block} color="#4ade80" onClick={() => onDevelop(id, "restoration")} />}
        {p.industry > 0 && <button className="card text-left" style={{ padding: "0.35rem 0.6rem" }} onClick={() => onDecommission(id)}><span className="font-semibold">Decommission a factory (X)</span><span className="block muted">Refunds some ore; pollution eases</span></button>}
      </div>
    </div>
  );
}

function DevButton({ label, cost, block, color, onClick }: { label: string; cost: Partial<Bag> | null; block: string | null; color: string; onClick: () => void }) {
  if (!cost) return <span className="chip text-center opacity-60">{label.replace(/ \(.\)$/, "")}: max level</span>;
  return (
    <button className="card text-left" style={{ borderColor: block ? undefined : color, padding: "0.35rem 0.6rem" }} onClick={onClick} aria-disabled={!!block} title={block ?? ""}>
      <span style={{ color }} className="font-semibold">{label}</span>
      <span className="block muted">{fmtBag(cost)}{block ? ` · ${block}` : ""}</span>
    </button>
  );
}

/** Industry ← untouched → restoration, with the stability bar underneath and its danger thresholds. */
function EvolutionMeter({ industry, restoration, stability, unstable }: { industry: number; restoration: number; stability: number; unstable: boolean }) {
  const seg = (on: boolean, color: string) => <span className="h-2 flex-1 rounded-sm" style={{ background: on ? color : "rgba(255,255,255,0.08)" }} />;
  return (
    <div aria-label={`Evolution: industry ${industry} of 3, restoration ${restoration} of 3, stability ${Math.round(stability)} percent${unstable ? ", unstable" : ""}`}>
      <div className="flex items-center gap-1">
        <span className="w-14 text-right" style={{ color: "#fb923c" }}>Industry</span>
        {seg(industry >= 3, "#fb923c")}{seg(industry >= 2, "#fb923c")}{seg(industry >= 1, "#fb923c")}
        <span className="mx-1 h-2 w-2 rounded-full" style={{ background: industry || restoration ? "rgba(255,255,255,0.2)" : "#94a3b8" }} title="Untouched" />
        {seg(restoration >= 1, "#4ade80")}{seg(restoration >= 2, "#4ade80")}{seg(restoration >= 3, "#4ade80")}
        <span className="w-16" style={{ color: "#4ade80" }}>Restored</span>
      </div>
      <div className="relative mt-1.5 h-2 rounded bg-white/10">
        <div className="h-2 rounded" style={{ width: `${stability}%`, background: unstable ? "#f43f5e" : stability < 50 ? "#fbbf24" : "#7dd3fc" }} />
        <span className="absolute top-[-2px] h-3 w-px bg-rose-400" style={{ left: `${UNSTABLE_BELOW}%` }} title={`Unstable below ${UNSTABLE_BELOW}%`} />
        <span className="absolute top-[-2px] h-3 w-px bg-white/40" style={{ left: `${RECOVER_AT}%` }} title={`Recovers at ${RECOVER_AT}%`} />
      </div>
      <div className="mt-0.5 flex justify-between muted"><span>Stability {Math.round(stability)}%</span><span>{unstable ? `unstable · recovers at ${RECOVER_AT}%` : `unstable below ${UNSTABLE_BELOW}%`}</span></div>
    </div>
  );
}

function ShopPanel({ s, settings, onBuy, onClose }: { s: GameState; settings: Settings; onBuy: (id: UpgradeId) => void; onClose: () => void }) {
  return (
    <div className="glass pointer-events-auto absolute right-3 top-14 z-10 w-72 space-y-2 p-3 text-xs" role="dialog" aria-label="Ship upgrades">
      <div className="flex items-center justify-between"><span className="h3">Ship upgrades</span><button className="chip" onClick={onClose}>Close</button></div>
      {UPGRADE_IDS.map((id) => {
        const u = UPGRADES[id], tier = s.upgrades[id], next = u.tiers[tier + 1];
        const cost = upgradeCost(id, tier + 1, settings);
        const afford = cost ? canAfford(s.inventory, cost) : false;
        return (
          <div key={id} className="card space-y-1">
            <div className="flex justify-between"><b>{u.name}</b><span className="muted">tier {tier + 1}/3</span></div>
            <div className="muted">{u.desc} Now: {u.tiers[tier].label}.</div>
            {next && cost ? (
              <button className="btn w-full px-2 py-1 text-xs" disabled={!afford} onClick={() => onBuy(id)}>
                {next.label} · {fmtBag(cost)}{!afford ? ` (need ${fmtBag(missing(s.inventory, cost))})` : ""}
              </button>
            ) : <div className="ok">Fully upgraded</div>}
          </div>
        );
      })}
      <p className="muted">Upgrades work anywhere. Prices follow the Upgrade cost setting (×{settings.upgradeCost}).</p>
    </div>
  );
}

const roundBag = (b: Bag): Bag => ({ ore: Math.ceil(b.ore), crystal: Math.ceil(b.crystal), energy: Math.ceil(b.energy) });
const fmtTime = (sec: number) => `${Math.floor(sec / 60)}:${String(Math.floor(sec % 60)).padStart(2, "0")}`;
