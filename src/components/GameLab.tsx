"use client";
import dynamic from "next/dynamic";
import { Fragment, useCallback, useEffect, useState, type ComponentType } from "react";
import { createPortal } from "react-dom";
import { GAMES, type GameMeta } from "@/games/registry";

// CREATION → Game Lab: playable projects that live inside ORBIT. Each game is reviewed source code registered in
// src/games/registry.ts; the lab only edits that game's validated settings. No AI call is needed to play.
const Loading = () => <div className="fixed inset-0 z-[60] grid place-items-center" style={{ background: "#03040d" }}><p className="muted animate-pulse">Loading game…</p></div>;
export const GAME_COMPONENTS: Record<string, ComponentType<{ onExit: () => void }>> = {
  "planet-forge": dynamic(() => import("@/games/planet-forge/PlanetForge"), { ssr: false, loading: Loading }),
};

type Info = { settings: Record<string, number>; hasSave: boolean; updatedAt: string | null };

export function GameLabPanel({ onPlaying }: { onPlaying?: (playing: boolean) => void }) {
  const [playing, setPlaying] = useState<string | null>(null);
  useEffect(() => { onPlaying?.(!!playing); }, [playing, onPlaying]);
  useEffect(() => () => onPlaying?.(false), [onPlaying]);
  const Game = playing ? GAME_COMPONENTS[playing] : null;
  return (
    <div className="space-y-3">
      <p className="text-sm">Game Lab: playable projects built into ORBIT. Saves and settings are stored privately on your account.</p>
      {GAMES.map((g) => <GameCard key={g.id} game={g} onPlay={() => setPlaying(g.id)} active={playing === g.id} />)}
      <p className="muted text-xs">New games are added as reviewed source code. Agents can't run generated code here; they can only suggest settings, which are validated like any manual change.</p>
      {/* Portal: the drawer's backdrop-filter would otherwise trap the full-screen game inside it. */}
      {Game && createPortal(<Game onExit={() => setPlaying(null)} />, document.body)}
    </div>
  );
}

function GameCard({ game, onPlay, active }: { game: GameMeta; onPlay: () => void; active: boolean }) {
  const [info, setInfo] = useState<Info | null>(null);
  const [err, setErr] = useState("");
  const [showSettings, setShowSettings] = useState(false);

  const refresh = useCallback(async () => {
    setErr("");
    try {
      const res = await fetch(`/api/games/${game.id}`, { cache: "no-store" });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || `Couldn't load (${res.status})`);
      setInfo({ settings: json.settings, hasSave: !!json.save, updatedAt: json.updatedAt });
    } catch (e) { setErr(e instanceof Error ? e.message : "Couldn't load"); }
  }, [game.id]);
  useEffect(() => { if (!active) void refresh(); }, [active, refresh]); // refresh after returning from the game

  return (
    <article className="card space-y-3" style={{ borderColor: game.accent }}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-base font-semibold" style={{ color: game.accent }}>{game.name}</h3>
          <p className="text-sm">{game.tagline}</p>
        </div>
        <button className="btn shrink-0 px-5 py-2 text-base" onClick={onPlay} aria-label={`Play ${game.name}`}>▶ {info?.hasSave ? "Continue" : "Play"}</button>
      </div>
      <p className="muted text-sm">{game.description}</p>
      {info?.hasSave && info.updatedAt && <p className="muted text-xs">Saved game · last saved {new Date(info.updatedAt).toLocaleString()}</p>}
      {err && <p className="error">{err}</p>}
      <details>
        <summary className="cursor-pointer text-sm">Controls</summary>
        <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
          {game.controls.map(([k, v]) => <Fragment key={k}><dt className="font-mono">{k}</dt><dd className="muted">{v}</dd></Fragment>)}
        </dl>
      </details>
      <div>
        <button className="chip" onClick={() => setShowSettings((v) => !v)} aria-expanded={showSettings}>{showSettings ? "Hide settings" : "Settings"}</button>
        {showSettings && info && <SettingsForm game={game} initial={info.settings} hasSave={info.hasSave} onSaved={(settings) => setInfo({ ...info, settings })} />}
        {showSettings && !info && !err && <p className="muted mt-2 text-xs">Loading settings…</p>}
      </div>
    </article>
  );
}

function SettingsForm({ game, initial, hasSave, onSaved }: { game: GameMeta; initial: Record<string, number>; hasSave: boolean; onSaved: (s: Record<string, number>) => void }) {
  const [values, setValues] = useState<Record<string, string>>(() => Object.fromEntries(Object.entries(initial).map(([k, v]) => [k, String(v)])));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const isDefault = Object.entries(game.defaults).every(([k, v]) => Number(values[k]) === v);

  async function submit(next: Record<string, string>) {
    setStatus(null);
    const v = game.validateSettings(next);
    if (!v.ok) { setErrors(v.errors); return; }
    setErrors({});
    setBusy(true);
    try {
      const res = await fetch(`/api/games/${game.id}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ settings: v.settings }) });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) { if (json.errors) setErrors(json.errors); throw new Error(json.error || "Couldn't save settings"); }
      onSaved(v.settings);
      setValues(Object.fromEntries(Object.entries(v.settings).map(([k, n]) => [k, String(n)])));
      setStatus({ ok: true, text: hasSave ? "Saved. Your current game keeps its progress and uses the new values from the next time you open it; the game lists what changed." : "Saved." });
    } catch (e) { setStatus({ ok: false, text: e instanceof Error ? e.message : "Couldn't save settings" }); }
    finally { setBusy(false); }
  }

  return (
    <form className="mt-2 space-y-3" onSubmit={(e) => { e.preventDefault(); void submit(values); }}>
      {Object.entries(game.settingsSpec).map(([k, spec]) => (
        <div key={k}>
          <label className="flex items-center justify-between text-sm" htmlFor={`gs-${k}`}><span>{spec.label}</span><span className="muted text-xs">default ×{spec.def}</span></label>
          <div className="flex items-center gap-2">
            <input type="range" min={spec.min} max={spec.max} step={spec.step} value={Number(values[k]) || spec.def} aria-label={`${spec.label} slider`}
              onChange={(e) => setValues({ ...values, [k]: e.target.value })} className="flex-1 accent-pink-400" />
            <input id={`gs-${k}`} className="field w-20 py-1 text-right" inputMode="decimal" value={values[k] ?? ""} aria-invalid={!!errors[k]} aria-describedby={`gs-${k}-help`}
              onChange={(e) => setValues({ ...values, [k]: e.target.value })} />
          </div>
          <p id={`gs-${k}-help`} className={errors[k] ? "error text-xs" : "muted text-xs"}>{errors[k] ?? `${spec.help} Range ${spec.min}–${spec.max}.`}</p>
        </div>
      ))}
      {errors._ && <p className="error">{errors._}</p>}
      <div className="flex flex-wrap gap-2">
        <button className="btn" disabled={busy}>{busy ? "Saving…" : "Save settings"}</button>
        <button type="button" className="chip" disabled={busy || isDefault}
          onClick={() => { const d = Object.fromEntries(Object.entries(game.defaults).map(([k, v]) => [k, String(v)])); setValues(d); void submit(d); }}>Restore defaults</button>
      </div>
      {status && <p className={status.ok ? "ok" : "error"}>{status.text}</p>}
    </form>
  );
}
