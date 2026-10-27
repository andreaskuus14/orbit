"use client";
import { useEffect, useState } from "react";

// Pieces of the phone remote's home screen. Visual only: every action is passed in from RemoteApp.
export type Item = { id: string; kind: "clip" | "spend" | "send" | "nego" | "invoice"; title: string; detail: string; seen: string; credits?: number; thumb?: boolean; to?: string; message?: string; strategy?: string; buyer?: string; amount?: string; daysLate?: number };

function useReducedMotion() {
  const [reduce, setReduce] = useState(false);
  useEffect(() => {
    const m = matchMedia("(prefers-reduced-motion: reduce)");
    setReduce(m.matches);
    const on = () => setReduce(m.matches);
    m.addEventListener("change", on);
    return () => m.removeEventListener("change", on);
  }, []);
  return reduce;
}

const ORBITS = [{ rx: 62, ry: 13 }, { rx: 104, ry: 22 }, { rx: 146, ry: 31 }];
const STARS = [[18, 14], [52, 96], [96, 22], [128, 104], [214, 12], [252, 100], [300, 26], [338, 88], [330, 8], [8, 70], [176, 108], [276, 58]];
const ring = (rx: number, ry: number) => `M ${180 - rx} 60 a ${rx} ${ry} 0 1 0 ${2 * rx} 0 a ${rx} ${ry} 0 1 0 ${-2 * rx} 0`;

/** The small live galaxy: the core takes the state's colour; amber worlds = approvals waiting, cyan = studio jobs running. SVG only. */
export function RemoteGalaxy({ need, jobs, paused }: { need: number; jobs: number; paused: boolean }) {
  const reduce = useReducedMotion();
  const tone = paused ? "var(--rose)" : need ? "var(--amber)" : "var(--cyan)";
  const worlds = [...Array(Math.min(need, 5)).fill("var(--amber)"), ...Array(Math.min(jobs, 3)).fill("var(--cyan)")] as string[];
  return (
    <svg className="rm-galaxy" viewBox="0 0 360 120" role="img" aria-label={`Galaxy: ${need} waiting, ${jobs} jobs running${paused ? ", paused" : ""}`}>
      <defs>
        <radialGradient id="rm-core"><stop offset="0" stopColor="#fff" /><stop offset="0.35" stopColor={tone} /><stop offset="1" stopColor={tone} stopOpacity="0" /></radialGradient>
        <radialGradient id="rm-disc"><stop offset="0" stopColor={tone} stopOpacity="0.28" /><stop offset="1" stopColor={tone} stopOpacity="0" /></radialGradient>
      </defs>
      {STARS.map(([x, y], i) => <circle key={i} className="rm-star" cx={x} cy={y} r={i % 3 ? 0.8 : 1.3} style={{ animationDelay: `${(i * 0.7) % 4}s` }} />)}
      <ellipse cx="180" cy="60" rx="170" ry="40" fill="url(#rm-disc)" />
      {ORBITS.map((o, i) => <path key={i} d={ring(o.rx, o.ry)} fill="none" stroke="rgba(165,243,252,.22)" strokeWidth="0.8" strokeDasharray={i === 1 ? "2 5" : undefined} />)}
      <circle className="rm-core" cx="180" cy="60" r="22" fill="url(#rm-core)" />
      <circle cx="180" cy="60" r="5" fill="#fff" />
      {worlds.map((c, i) => {
        const o = ORBITS[i % 3], dur = 14 + i * 5, start = (i * 0.37) % 1;
        // Reduced motion: worlds sit still, spread around their orbit.
        const a = start * 2 * Math.PI, x = 180 + o.rx * Math.cos(a), y = 60 + o.ry * Math.sin(a);
        return reduce ? <circle key={i} cx={x} cy={y} r="3.2" fill={c} />
          : <circle key={i} r="3.2" fill={c}><animateMotion dur={`${dur}s`} repeatCount="indefinite" path={ring(o.rx, o.ry)} begin={`-${start * dur}s`} /></circle>;
      })}
    </svg>
  );
}

/** One approval in the "Needs you" stack. Same buttons, labels and disabled rules as before the redesign. */
export function NeedCard({ it, busy, blind, onThumbError, decide }: { it: Item; busy: string; blind: boolean; onThumbError: () => void; decide: (it: Item, approve: boolean) => void }) {
  const kind = it.kind === "spend" ? "Spend" : it.kind === "send" ? "Email" : it.kind === "nego" ? "Reply" : it.kind === "invoice" ? "Invoice" : "Clip";
  return (
    <article className={`rm-need rm-need-${it.kind}`}>
      <div className="flex items-baseline justify-between gap-2">
        <span className="rm-kind">{kind}</span>
        {it.kind === "spend" && <span className="rm-big">{it.credits}<small> credits</small></span>}
      </div>
      <div className="text-base font-semibold leading-snug">{it.title}</div>
      <div className="muted text-xs">{it.detail}</div>
      {it.kind === "clip" && (blind ? <p className="muted text-sm">No preview: open on PC to review.</p>
        : <img src={`/api/remote/thumb?id=${it.id}&v=${it.seen}`} alt={`Thumbnail of ${it.title}`} className="w-full rounded-lg" style={{ maxHeight: 360, objectFit: "contain", background: "#000" }} onError={onThumbError} />)}
      {it.kind === "nego" && <div className="text-xs">Plan: {it.strategy}</div>}
      {it.kind === "invoice" && <div className="text-sm">{it.buyer} owes <b>{it.amount}</b> · {it.daysLate} day{it.daysLate === 1 ? "" : "s"} overdue</div>}
      {(it.kind === "send" || it.kind === "nego" || it.kind === "invoice") && <>
        {it.to && <div className="text-sm">To: <b>{it.to}</b></div>}
        <pre className="field w-full whitespace-pre-wrap text-xs" style={{ fontFamily: "inherit", maxHeight: 260, overflow: "auto" }}>{it.message}</pre>
      </>}
      <div className="flex gap-2">
        <button className="btn flex-1" style={{ minHeight: 48 }} disabled={!!busy || blind} onClick={() => decide(it, true)}>
          {busy === it.id ? "…" : it.kind === "spend" ? `Approve ${it.credits} credits` : it.kind === "send" || ((it.kind === "nego" || it.kind === "invoice") && it.to) ? "Approve & send" : "Approve"}
        </button>
        {it.kind === "clip" && <button className="chip" style={{ minHeight: 48, minWidth: 88 }} disabled={!!busy} onClick={() => decide(it, false)}>Reject</button>}
      </div>
    </article>
  );
}
