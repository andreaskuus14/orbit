"use client";
// Living universe data + the "Time travel" scrubber: the galaxy shows the ledger at any day in the last 180.
import { useEffect, useMemo, useRef, useState } from "react";
import type { Snapshot } from "@/lib/ledger-pure";
import { scrubAt, SCRUB_DAYS, universeFrom } from "@/lib/universe-pure";
import { LIVING_EVENT } from "@/lib/living-events-pure";

type Got = { at: string; snapshot: Snapshot };

export function useLivingUniverse(active = true) {
  const [open, setOpen] = useState(false);
  const [days, setDays] = useState(0); // 0 = live
  const [got, setGot] = useState<Got | null>(null);
  const cache = useRef(new Map<string, Got>()); // past days never change; live is refetched
  useEffect(() => {
    const at = scrubAt(days, Date.now());
    if (at && cache.current.has(at)) { setGot(cache.current.get(at)!); return; }
    let dead = false;
    const load = () => fetch(`/api/ledger${at ? `?at=${encodeURIComponent(at)}` : ""}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((j: Got | null) => {
        if (dead || !j?.snapshot) return;
        if (at) cache.current.set(at, j);
        setGot(j);
      })
      .catch(() => {}); // no ledger yet / offline: the galaxy just stays as it is
    if (!active) return; // galaxy hidden (2D index / a world covers it): no ledger polling
    const t = setTimeout(load, at ? 250 : 0); // debounce dragging
    const live = at ? undefined : setInterval(load, 5 * 60_000);
    // live: a BUSINESS event (a lead added or moved) refetches soon, so its moon arrives while the owner watches
    let soon: ReturnType<typeof setTimeout> | undefined;
    const onEv = (e: Event) => { if ((e as CustomEvent<{ planet?: string }>).detail?.planet === "business") { clearTimeout(soon); soon = setTimeout(load, 1500); } };
    if (!at) addEventListener(LIVING_EVENT, onEv);
    return () => { dead = true; clearTimeout(t); clearTimeout(soon); clearInterval(live); removeEventListener(LIVING_EVENT, onEv); };
  }, [days, active]);
  const universe = useMemo(() => (got ? universeFrom(got.snapshot, Date.parse(got.at)) : null), [got]);
  return { open, setOpen, days, setDays, universe };
}

export function TimeTravel({ days, setDays, onClose }: { days: number; setDays: (d: number) => void; onClose: () => void }) {
  const at = scrubAt(days, Date.now());
  const label = at ? new Date(at).toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short", year: "numeric" }) : "Now · live";
  return (
    <div role="group" aria-label="Time travel" className="glass fixed inset-x-4 bottom-24 z-40 mx-auto flex max-w-xl items-center gap-3 px-4 py-2 text-xs">
      <span className="w-36 shrink-0 tabular-nums" aria-live="polite">{label}</span>
      <input type="range" min={0} max={SCRUB_DAYS} step={1} value={SCRUB_DAYS - days} aria-label="Day in the last 180 days" aria-valuetext={label}
        onChange={(e) => setDays(SCRUB_DAYS - Number(e.target.value))} className="h-1 min-w-0 flex-1 accent-sky-300" />
      <button className="chip" onClick={() => setDays(0)} disabled={days === 0}>Now</button>
      <button className="chip" onClick={onClose} aria-label="Close time travel">✕</button>
    </div>
  );
}
