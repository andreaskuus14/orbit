"use client";
// The focused "Working on it" view (feat/ui-motion): the same Progress as the shared card, shown big for the one job he is
// following. A ring fills with the steps done, the time left counts down every second between updates, the doing-now line
// ticks over, steps change ✓ ● ○ with a small pop, and a finished job gets one soft settle (ring turns mint, a check draws).
// One button at most, and it only opens where the item's own Approve lives (AGENTS.md rule 6), like the card.
import { useEffect, useRef, useState } from "react";
import { doneShare, fromTask, leftText, type Progress, type TaskLike } from "@/lib/progress-pure";
import { countdown, ringOffset } from "@/lib/ui-motion-pure";
import type { PlanetId } from "@/lib/planets";
import { openProgress } from "../ProgressCard";
import { useT } from "../i18n";

const MARK = { done: "✓", now: "●", next: "○", failed: "✕" } as const;
const R = 48;

/** Live progress for one task: polls its row every 2.5 s while followed (and once more when it changes phase). */
export function useFocusProgress(id: string | null, stopAll = false): { p: Progress | null; task: (TaskLike & { agent?: string; request?: string | null }) | null; at: number } {
  const { lang } = useT();
  const [st, setSt] = useState<{ p: Progress | null; task: (TaskLike & { agent?: string; request?: string | null }) | null; at: number }>({ p: null, task: null, at: 0 });
  useEffect(() => {
    if (!id) { setSt({ p: null, task: null, at: 0 }); return; }
    let off = false, timer = 0;
    const load = async () => {
      const t = await fetch(`/api/tasks?id=${encodeURIComponent(id)}`, { cache: "no-store" }).then((r) => (r.ok ? r.json() : null), () => null)
        .then((j) => (j?.tasks as (TaskLike & { agent?: string })[] | undefined)?.[0] ?? null, () => null);
      if (off) return;
      if (t) { const at = Date.now(); setSt({ p: fromTask(t, lang, { nowMs: at, typicalMs: null, stopAll }), task: t, at }); }
      const done = t && ["done", "failed", "cancelled", "interrupted"].includes(t.status);
      if (!done) timer = window.setTimeout(() => { if (!document.hidden) void load(); else timer = window.setTimeout(load, 5000); }, 2500);
    };
    void load();
    return () => { off = true; clearTimeout(timer); };
  }, [id, lang, stopAll]);
  return st;
}

export function FocusWork({ p, planet, at, onBack, follow, onFollow, leaving = false }: {
  p: Progress | null; planet: PlanetId | "core"; at: number; // at: when p.leftMin was read (the countdown runs from there)
  onBack: () => void; follow: boolean; onFollow: (on: boolean) => void; leaving?: boolean;
}) {
  const { t, lang } = useT();
  const et = lang === "et";
  const [now, setNow] = useState(() => Date.now());
  const working = p?.phase === "working";
  useEffect(() => { if (!working) return; const id = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(id); }, [working]);
  const share = !p ? 0 : p.phase === "done" ? 1 : doneShare(p);
  const ring = ringOffset(share, R);
  const left = working ? countdown(p!.leftMin, at, now) : null;
  const back = useRef<HTMLButtonElement>(null);
  useEffect(() => { back.current?.focus({ preventScroll: true }); }, []);
  useEffect(() => { // Esc goes back (not while typing in a field)
    const k = (e: KeyboardEvent) => { if (e.key === "Escape" && !(e.target as HTMLElement | null)?.closest?.("input, textarea, [contenteditable]")) { e.stopPropagation(); onBack(); } };
    addEventListener("keydown", k, true);
    return () => removeEventListener("keydown", k, true);
  }, [onBack]);
  const planetName = planet === "core" ? "CORE" : t(`planet.${planet}`);
  const title = p?.title ?? (et ? "Alustan…" : "Starting…");
  return (
    <section className="focus-work" data-phase={p?.phase ?? "waiting"} data-leaving={leaving || undefined} style={{ ["--planet" as string]: `var(--planet-${planet})` }}
      role="region" aria-label={`${title}: ${p ? t(`prog.phase.${p.phase}`) : ""}`}>
      <div className="focus-top">
        <button ref={back} type="button" className="chip" onClick={onBack}>← {et ? "Tagasi" : "Back"}</button>
        <span className="focus-planet">{planetName}</span>
        <label className="chip follow-toggle" title={et ? "Kui töö algab, viib ORBIT sind sinna" : "When work starts, ORBIT takes you there"}>
          <input type="checkbox" checked={follow} onChange={(e) => onFollow(e.target.checked)} /> {et ? "Jälgi" : "Follow"}
        </label>
      </div>
      <h2 className="focus-title">{title}</h2>
      <div className="focus-hero">
        <div className="focus-ring">
          <svg viewBox="0 0 112 112" aria-hidden="true">
            <circle className="ring-track" cx="56" cy="56" r={R} fill="none" strokeWidth="6" />
            <circle className="ring-fill" cx="56" cy="56" r={R} fill="none" strokeWidth="6" strokeLinecap="round" strokeDasharray={ring.len} strokeDashoffset={ring.offset} />
            {working && <g className="ring-head"><circle cx="56" cy={56 - R} r="3.2" /></g>}
          </svg>
          <div className="focus-ring-center">
            {p?.phase === "done"
              ? <svg width="34" height="34" viewBox="0 0 34 34" aria-hidden="true"><path className="focus-check" d="M8 18 l6 6 l12 -13" fill="none" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
              : <b>{Math.round(share * 100)}%</b>}
            <small>{p ? t(`prog.phase.${p.phase}`) : ""}</small>
          </div>
        </div>
        <div className="min-w-0 flex-1">
          <div className="focus-now" aria-live="polite">
            {p?.now ? <p key={p.now}>{p.now}…</p> : p?.phase === "done" ? <p key="done">{et ? "Valmis." : "All done."}</p> : <p key="none" className="muted">{p ? t(`prog.phase.${p.phase}`) : et ? "Alustan" : "Getting started"}</p>}
          </div>
          {left ? <p className="muted text-xs num" aria-label={leftText(p!.leftMin, lang)}>{et ? "Aega jäänud" : "Time left"} {left.text}</p>
            : working ? <p className="muted text-xs">{et ? "Aega ei oska veel öelda" : "Time left: not sure yet"}</p> : null}
        </div>
      </div>
      {p && p.steps.length > 0 && (
        <ol className="focus-steps" aria-label={t("prog.steps")}>
          {p.steps.map((s, i) => (
            <li key={i} data-state={s.state} style={{ animationDelay: `${140 + i * 45}ms` }}>
              {/* key on the state: a changed step remounts its mark, so only that one pops */}
              <span className="pmark" key={s.state} aria-hidden="true">{MARK[s.state]}</span>
              <span className="plabel">{s.label}</span><span className="sr-only"> ({t(`prog.step.${s.state}`)})</span>
            </li>
          ))}
        </ol>
      )}
      {p?.result && <p className="focus-result">{p.phase === "done" ? "→ " : ""}{p.result.text}</p>}
      {(p?.action || p?.result?.open) && (
        <div className="mt-3 flex justify-end">
          <button type="button" className="btn px-4 py-1.5 text-sm" onClick={() => openProgress(p!.action?.open || p!.result?.open || "")}>{p!.action?.label ?? (et ? "Vaata tulemust" : "See result")}</button>
        </div>
      )}
    </section>
  );
}

/** "Jump to it": work started while he was typing, reading or inside a world. Never moves anything by itself. */
export function JumpPill({ title, planet, onJump, onDismiss }: { title: string; planet: PlanetId | "core"; onJump: () => void; onDismiss: () => void }) {
  const { lang } = useT();
  const et = lang === "et";
  return (
    <div className="jump-pill" role="status" style={{ ["--planet" as string]: `var(--planet-${planet})` }}>
      <span className="dot" aria-hidden="true" />
      <span className="max-w-[16rem] truncate">{et ? "Töö algas" : "Started"}: {title}</span>
      <button type="button" className="go" onClick={onJump}>{et ? "Vaata" : "Jump to it"}</button>
      <button type="button" className="x" onClick={onDismiss} aria-label={et ? "Sulge" : "Dismiss"}>×</button>
    </div>
  );
}
