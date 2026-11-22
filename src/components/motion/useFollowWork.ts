"use client";
// Follow the work (feat/ui-motion): the rules live in lib/follow-pure.ts. This hook keeps the Follow toggle, notices typing and
// reading (keys in fields, scrolls in panels), and runs the choreography: camera fly (Galaxy followFly) → the focused view
// fades in over the fly's last stretch → Back: the camera returns while the view fades out (overlap, no hard cut).
import { useCallback, useEffect, useRef, useState } from "react";
import { CORE_PHASE_EVENT, type PhaseEvent } from "@/lib/core-phase-pure";
import { FOLLOW_KEY, followMove, followStored, fromHisRequest, openDelay, type FollowMove } from "@/lib/follow-pure";
import { DUR } from "@/lib/ui-motion-pure";
import type { PlanetId } from "@/lib/planets";
import { sharedTransition } from "./motion";

export type FollowJob = { id: string; planet: PlanetId; title: string };
const FIELD = "input, textarea, select, [contenteditable=''], [contenteditable='true']";
const READING = ".drawer, .kept, .needs-inbox, .home-desk, .work-sheet, [role=dialog]";

function typingNow(): boolean {
  const el = document.activeElement as HTMLInputElement | HTMLTextAreaElement | HTMLElement | null;
  if (!el || !el.matches?.(FIELD)) return false;
  return "value" in el ? !!String(el.value ?? "").trim() : !!el.textContent?.trim();
}

export function useFollowWork(o: { enabled: boolean; onHome: boolean; canFly: boolean; leave: () => void }) {
  const [follow, setFollowS] = useState(true);
  const [cam, setCam] = useState<PlanetId | null>(null);
  const [job, setJob] = useState<FollowJob | null>(null);
  const [sheet, setSheet] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [pill, setPill] = useState<FollowJob | null>(null);
  const seen = useRef(new Set<string>());
  const lastInput = useRef(0), lastScroll = useRef(0), lastRequest = useRef(0);
  const timers = useRef<number[]>([]);
  const ctx = useRef(o);
  ctx.current = o;
  const later = (f: () => void, ms: number) => { timers.current.push(window.setTimeout(f, ms)); };
  useEffect(() => () => timers.current.forEach(clearTimeout), []);
  useEffect(() => { try { setFollowS(followStored(localStorage.getItem(FOLLOW_KEY))); } catch { /* storage off */ } }, []);
  const setFollow = useCallback((on: boolean) => { setFollowS(on); try { localStorage.setItem(FOLLOW_KEY, on ? "1" : "0"); } catch { /* storage off */ } }, []);

  useEffect(() => {
    if (!o.enabled) return;
    const key = (e: Event) => { if ((e.target as Element | null)?.closest?.(FIELD)) lastInput.current = Date.now(); };
    const scroll = (e: Event) => { const t = e.target; if (t instanceof Element && t.closest(READING)) lastScroll.current = Date.now(); };
    const phase = (e: Event) => { if ((e as CustomEvent<PhaseEvent>).detail?.type === "submit") lastRequest.current = Date.now(); };
    addEventListener("keydown", key, true);
    document.addEventListener("scroll", scroll, { capture: true, passive: true });
    addEventListener(CORE_PHASE_EVENT, phase);
    return () => { removeEventListener("keydown", key, true); document.removeEventListener("scroll", scroll, true); removeEventListener(CORE_PHASE_EVENT, phase); };
  }, [o.enabled]);

  const go = useCallback((j: FollowJob, move: Exclude<FollowMove, "pill">) => {
    setPill(null); setLeaving(false);
    if (move === "fly") { setCam(j.planet); setJob(j); setSheet(false); later(() => setSheet(true), openDelay("fly")); return; }
    sharedTransition(() => { setCam(null); setJob(j); setSheet(true); }, { id: j.id, dir: "open" });
  }, []);

  /** A job started. mine: he asked for exactly this one (Task mode); otherwise it must follow a request of his. */
  const offer = useCallback((j: FollowJob, mine: boolean) => {
    const c = ctx.current, now = Date.now();
    if (!c.enabled || seen.current.has(j.id)) return;
    seen.current.add(j.id);
    if (!mine && !fromHisRequest(lastRequest.current, now)) return;
    const move = followMove({ follow, typing: mine ? false : typingNow(), lastInputMs: mine ? 0 : lastInput.current, lastScrollMs: lastScroll.current, nowMs: now, onHome: c.onHome, canFly: c.canFly });
    if (move === "pill") setPill(j); else go(j, move);
  }, [follow, go]);

  /** His click on a card: open it now (rules don't apply to a click). */
  const open = useCallback((j: FollowJob) => { seen.current.add(j.id); go(j, ctx.current.canFly && ctx.current.onHome ? "fly" : "open"); }, [go]);

  const markRequest = useCallback(() => { lastRequest.current = Date.now(); }, []);

  const jump = useCallback(() => {
    const j = pill;
    if (!j) return;
    if (ctx.current.onHome) { go(j, ctx.current.canFly ? "fly" : "open"); return; }
    ctx.current.leave(); // his click: leave the world/panel first, then fly
    later(() => go(j, ctx.current.canFly ? "fly" : "open"), 80);
  }, [pill, go]);

  const back = useCallback(() => {
    setCam(null); // the camera starts home at once while the view fades out (overlap)
    setLeaving(true);
    later(() => { setJob(null); setSheet(false); setLeaving(false); }, DUR.quick);
  }, []);

  // He went somewhere else (a planet, CORE, a world): the focus quietly ends, nothing flies.
  useEffect(() => { if (job && !o.onHome && !leaving) { setCam(null); setJob(null); setSheet(false); } }, [o.onHome]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (!pill) return; const t = setTimeout(() => setPill(null), 60_000); return () => clearTimeout(t); }, [pill]);

  return { follow, setFollow, cam, job, sheet, leaving, pill, offer, open, jump, back, markRequest, dismissPill: () => setPill(null) };
}
