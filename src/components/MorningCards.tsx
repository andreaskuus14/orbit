"use client";
// The morning's 5 ranked cards as a stack: swipe or ←/→ to move, 👍/👎 teach the ranking (POST /api/morning → ledger "morning.thumb").
import { useRef, useState } from "react";
import type { Card, Hero } from "@/lib/morning-rank-pure";

const LABEL: Record<Card["kind"], string> = { task: "TOP TASK", goal: "GOAL", news: "WORTH KNOWING", business: "BUSINESS", idea: "RESURFACED" };

/** Ledger "morning.click" / "morning.done" for a hero or card (POST /api/morning). Resolves false on failure. */
export const trackCard = (event: "click" | "done", c: Card) => !c.source ? Promise.resolve(true)
  : fetch("/api/morning", { method: "POST", keepalive: true, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ event, source: c.source, key: c.key }) })
    .then((r) => r.ok, () => false);

/** "Do this first": one action, at most four lines (label, title, why, buttons). Done records completion and hides it until tomorrow. */
export function MorningHero({ hero, onOpen }: { hero: Hero; onOpen: (c: Card) => void }) {
  const [done, setDone] = useState(false);
  const [err, setErr] = useState("");
  const markDone = async () => {
    setDone(true); setErr("");
    if (!(await trackCard("done", hero))) { setDone(false); setErr("Couldn't save that, try again."); }
  };
  return (
    <section className={`mhero mcards-${hero.kind}`} aria-labelledby="mhero-t">
      <span className="mcards-k">DO THIS FIRST</span>
      <h3 id="mhero-t" className={`mhero-t${done ? " mhero-done" : ""}`} title={hero.title}>{hero.title}</h3>
      <p className="mhero-why muted text-xs">{done ? "Done. The next pick waits in the cards below." : hero.why}</p>
      <div className="mcards-row">
        <button type="button" className="btn" disabled={done} onClick={() => onOpen(hero)}>{hero.action ?? "Open"} <span aria-hidden>→</span></button>
        <button type="button" className="chip" aria-pressed={done} disabled={done} onClick={markDone}>{done ? "✓ Done" : "Done"}</button>
        {err && <span className="error text-xs" role="alert">{err}</span>}
      </div>
    </section>
  );
}

/** problems: sources that failed to load, shown so a failure never reads as "nothing to do". */
export function MorningCards({ cards, problems = [], onOpen }: { cards: Card[]; problems?: string[]; onOpen: (c: Card) => void }) {
  const [at, setAt] = useState(0);
  const [votes, setVotes] = useState<Record<string, boolean>>({});
  const [err, setErr] = useState("");
  const startX = useRef<number | null>(null);
  const warn = problems.map((p) => <p key={p} className="warn text-xs">{p}</p>);
  if (!cards.length) return <>{warn}{!problems.length && <p className="muted">Nothing needs you this morning.</p>}</>;
  const i = Math.min(at, cards.length - 1), c = cards[i];
  const go = (d: number) => setAt((k) => Math.max(0, Math.min(cards.length - 1, k + d)));
  const vote = async (up: boolean) => {
    setVotes((v) => ({ ...v, [c.key]: up })); setErr("");
    try {
      const r = await fetch("/api/morning", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ kind: c.kind, key: c.key, up }) });
      if (!r.ok) throw new Error();
      go(1);
    } catch { setVotes((v) => { const n = { ...v }; delete n[c.key]; return n; }); setErr("Couldn't save that, try again."); }
  };
  const v = votes[c.key];

  return (
    <div className="mcards" role="group" aria-roledescription="carousel" aria-label="Morning cards" tabIndex={0}
      onKeyDown={(e) => { // stopPropagation: arrows here move cards, not the galaxy
        const d = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
        if (d) { e.preventDefault(); e.stopPropagation(); go(d); }
      }}>
      <div className="mcards-stack" onPointerDown={(e) => { startX.current = e.clientX; }}
        onPointerUp={(e) => { const s = startX.current; startX.current = null; if (s !== null && Math.abs(e.clientX - s) > 50) go(e.clientX < s ? 1 : -1); }}>
        {cards.slice(i + 1, i + 3).map((b, k) => <div key={b.key} className="mcards-under" style={{ ["--d" as string]: k + 1 }} aria-hidden />)}
        <article className={`mcards-card mcards-${c.kind}`} aria-roledescription="slide" aria-label={`${i + 1} of ${cards.length}`} aria-live="polite">
          <span className="mcards-k">{LABEL[c.kind]}</span>
          <button type="button" className="mcards-t" onClick={() => onOpen(c)}>{c.title} <span aria-hidden>→</span></button>
          {c.detail && <p className="muted text-xs">{c.detail}</p>}
          <div className="mcards-row">
            <button type="button" className="chip" aria-pressed={v === true} aria-label="Thumbs up: more like this" disabled={v !== undefined} onClick={() => vote(true)}>👍</button>
            <button type="button" className="chip" aria-pressed={v === false} aria-label="Thumbs down: less like this" disabled={v !== undefined} onClick={() => vote(false)}>👎</button>
            <span className="mcards-nav">
              <button type="button" className="chip" aria-label="Previous card" disabled={i === 0} onClick={() => go(-1)}>←</button>
              <span className="num muted text-xs">{i + 1}/{cards.length}</span>
              <button type="button" className="chip" aria-label="Next card" disabled={i === cards.length - 1} onClick={() => go(1)}>→</button>
            </span>
          </div>
        </article>
      </div>
      {err && <p className="error text-xs" role="alert">{err}</p>}
      {warn}
    </div>
  );
}
