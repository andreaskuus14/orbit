"use client";
import { useEffect, useId, useRef, useState } from "react";
import type { HypeView } from "@/lib/clips/hype-pure";
import type { Virality } from "@/lib/clips/score-pure";
import { mmss } from "@/lib/clips/format";

// STUDIO hype + virality visuals: HypeWave (a job's stream-long hype curve with its clips marked) and ScoreRing / ScoreWhy (a clip's
// personal virality score and the factors behind it). Data comes on the job (job.hype) and the clip (clip.virality); see hype-pure.ts, score-pure.ts.

// Heat scale shared by the wave and the ring: cool plum (quiet / low) → cherry → ember gold (peak / high).
const HEAT: [number, [number, number, number]][] = [[0, [168, 85, 247]], [0.5, [255, 46, 99]], [1, [255, 179, 71]]];
export function heat(f: number): string {
  const x = Math.min(1, Math.max(0, f)), i = x <= 0.5 ? 0 : 1, [a, ca] = HEAT[i], [b, cb] = HEAT[i + 1], t = (x - a) / (b - a);
  return `rgb(${ca.map((v, k) => Math.round(v + (cb[k] - v) * t)).join(",")})`;
}

const W = 1000, H = 132, TOP = 14; // viewBox; TOP leaves room for the peak glow

/** Smooth path through points (Catmull-Rom → cubic Bézier). */
function smoothPath(pts: [number, number][]): string {
  if (pts.length < 2) return "";
  let d = `M${pts[0][0].toFixed(1)},${pts[0][1].toFixed(1)}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] ?? pts[i], p1 = pts[i], p2 = pts[i + 1], p3 = pts[i + 2] ?? p2;
    const c1 = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6], c2 = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6];
    d += ` C${c1[0].toFixed(1)},${Math.min(H, c1[1]).toFixed(1)} ${c2[0].toFixed(1)},${Math.min(H, c2[1]).toFixed(1)} ${p2[0].toFixed(1)},${p2[1].toFixed(1)}`;
  }
  return d;
}

type Mark = { id: string; start: number; end: number; title: string; score?: number };

/** The stream's hype over time, picked clips as luminous bands: hover shows the clip, click jumps to its card. */
export function HypeWave({ hype, duration, clips, reduced, onPick }: { hype: HypeView; duration: number; clips: Mark[]; reduced: boolean; onPick: (id: string) => void }) {
  const uid = useId().replace(/:/g, ""), [hover, setHover] = useState<string | null>(null);
  const total = Math.max(1, duration || hype.curve.length * hype.bucketSec);
  const x = (sec: number) => (sec / total) * W, y = (v: number) => H - v * (H - TOP);
  const pts = hype.curve.map((v, i): [number, number] => [x((i + 0.5) * hype.bucketSec), y(v)]);
  const line = smoothPath(pts), area = line && `${line} L${pts[pts.length - 1][0].toFixed(1)},${H} L${pts[0][0].toFixed(1)},${H} Z`;
  const chatMax = Math.max(1, ...(hype.chat ?? [0]));
  const chat = hype.chat && smoothPath(hype.chat.map((v, i) => [x((i + 0.5) * hype.bucketSec), y((v / chatMax) * 0.92)]));
  const audio = smoothPath(hype.audio.map((v, i) => [x((i + 0.5) * hype.bucketSec), y(v * 0.85)]));
  const top = [...hype.peaks].sort((a, b) => b.height - a.height).slice(0, 3);
  const summary = top.length
    ? `Biggest moments: ${top.map((p) => `${mmss(p.t)}${p.reasons.length ? ` (${p.reasons.join(", ")})` : ""}`).join("; ")}.`
    : "No clear hype spikes in this stream.";
  const source = hype.chatMsgs ? `${hype.chatFrom ?? "Chat replay"} · ${hype.chatMsgs.toLocaleString()} messages · chat delay ${hype.delay} s` : "Audio only";
  const hov = clips.find((c) => c.id === hover);

  return (
    <figure className="hype-wave mt-2" aria-labelledby={`${uid}-t`}>
      <figcaption className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 text-[11px]">
        <span id={`${uid}-t`} className="studio-title !tracking-[0.12em]">Hype over the stream</span>
        <span className="muted">{source}</span>
      </figcaption>
      <div className="relative mt-1">
        <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="block h-24 w-full overflow-visible sm:h-28" role="img" aria-labelledby={`${uid}-st ${uid}-sd`}>
          <title id={`${uid}-st`}>Hype curve of the stream, {mmss(total)} long</title>
          <desc id={`${uid}-sd`}>{summary}</desc>
          <defs>
            <linearGradient id={`${uid}-heat`} x1="0" y1={H} x2="0" y2={TOP} gradientUnits="userSpaceOnUse">
              <stop offset="0" stopColor={heat(0)} /><stop offset="0.55" stopColor={heat(0.5)} /><stop offset="1" stopColor={heat(1)} />
            </linearGradient>
            <linearGradient id={`${uid}-fill`} x1="0" y1={TOP} x2="0" y2={H} gradientUnits="userSpaceOnUse">
              <stop offset="0" stopColor="#ff2e63" stopOpacity="0.55" /><stop offset="0.6" stopColor="#a855f7" stopOpacity="0.14" /><stop offset="1" stopColor="#a855f7" stopOpacity="0" />
            </linearGradient>
            <filter id={`${uid}-glow`} x="-5%" y="-40%" width="110%" height="180%"><feGaussianBlur stdDeviation="3.5" /></filter>
          </defs>
          {[0.25, 0.5, 0.75].map((f) => <line key={f} x1="0" x2={W} y1={y(f)} y2={y(f)} stroke="rgba(255,214,224,0.06)" vectorEffect="non-scaling-stroke" />)}
          {clips.map((c) => (
            <rect key={c.id} x={x(c.start)} width={Math.max(2, x(c.end) - x(c.start))} y={TOP - 6} height={H - TOP + 6} rx="2"
              fill={hover === c.id ? "rgba(255,179,71,0.22)" : "rgba(255,214,224,0.08)"} className="hype-band" />
          ))}
          <g className={reduced ? "" : "hype-sweep"}>{/* draw-in: a left-to-right sweep, like a seismograph */}
          {area && <path d={area} fill={`url(#${uid}-fill)`} />}
          <path d={audio} fill="none" stroke="#c084fc" strokeOpacity="0.45" strokeWidth="1" vectorEffect="non-scaling-stroke" />
          {chat && <path d={chat} fill="none" stroke="#ffd6e0" strokeOpacity="0.5" strokeWidth="1" strokeDasharray="3 3" vectorEffect="non-scaling-stroke" />}
          {line && <path d={line} fill="none" stroke={`url(#${uid}-heat)`} strokeWidth="5" opacity="0.55" filter={`url(#${uid}-glow)`} vectorEffect="non-scaling-stroke" />}
          {line && <path d={line} fill="none" stroke={`url(#${uid}-heat)`} strokeWidth="2" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />}
          </g>
        </svg>
        {/* Clip markers: real buttons over the chart (keyboard + screen reader), placed in % so they stay round at any width. */}
        {clips.map((c, k) => {
          const mid = (c.start + c.end) / 2, v = peakValue(hype, c.start, c.end);
          return (
            <button key={c.id} type="button" className="hype-mark" aria-label={`Clip ${k + 1}: ${c.title}, ${mmss(c.start)}–${mmss(c.end)}${c.score !== undefined ? `, score ${c.score}` : ""}. Jump to the clip`}
              style={{ left: `${(mid / total) * 100}%`, top: `${(y(v) / H) * 100}%`, ["--c" as string]: heat(c.score !== undefined ? c.score / 100 : v) }}
              onMouseEnter={() => setHover(c.id)} onMouseLeave={() => setHover(null)} onFocus={() => setHover(c.id)} onBlur={() => setHover(null)} onClick={() => onPick(c.id)} />
          );
        })}
        {hov && (
          <div className="hype-tip" role="status" style={{ left: `${Math.min(82, Math.max(18, (((hov.start + hov.end) / 2) / total) * 100))}%` }}>
            <b className="block truncate">{hov.title}</b>
            <span className="num">{mmss(hov.start)}–{mmss(hov.end)}{hov.score !== undefined ? ` · ${hov.score}/100` : ""}</span>
          </div>
        )}
      </div>
      <div className="num mt-0.5 flex justify-between text-[10px]" style={{ color: "rgba(255,214,224,0.45)" }} aria-hidden>
        <span>0:00</span><span className="hype-legend"><i style={{ background: "linear-gradient(90deg,#a855f7,#ff2e63,#ffb347)" }} />hype<i className="dash" />chat<i style={{ background: "#c084fc" }} />audio</span><span>{mmss(total)}</span>
      </div>
      <p className="muted mt-1 text-[11px] leading-snug">{summary}{hype.hint ? ` ${hype.hint}.` : ""}</p>
    </figure>
  );
}

const peakValue = (h: HypeView, start: number, end: number) => {
  const a = Math.floor(start / h.bucketSec), b = Math.max(a + 1, Math.ceil(end / h.bucketSec));
  return Math.max(0, ...h.curve.slice(a, b));
};

const CONF: Record<Virality["conf"], string> = { low: "learning", medium: "medium confidence", high: "high confidence" };

/** Counts 0 → value once (instant with reduced motion). */
function useCount(value: number, reduced: boolean) {
  const [n, setN] = useState(reduced ? value : 0), from = useRef(0);
  useEffect(() => {
    if (reduced) { setN(value); return; }
    const start = performance.now(), a = from.current;
    let raf = 0;
    const step = (t: number) => { const f = Math.min(1, (t - start) / 900), e = 1 - (1 - f) ** 3; setN(Math.round(a + (value - a) * e)); if (f < 1) raf = requestAnimationFrame(step); else from.current = value; };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [value, reduced]);
  return n;
}

/** Radial 0-100 gauge, heat-coloured, with the confidence underneath. */
export function ScoreRing({ v, reduced, size = 44 }: { v: Virality; reduced: boolean; size?: number }) {
  const n = useCount(v.score, reduced), r = 17, c = 2 * Math.PI * r, col = heat(v.score / 100);
  return (
    <div className="score-ring" style={{ width: size }} role="img" aria-label={`Virality score ${v.score} of 100, ${CONF[v.conf]}`}>
      <svg viewBox="0 0 40 40" width={size} height={size} aria-hidden>
        <circle cx="20" cy="20" r={r} fill="rgba(12,2,8,0.72)" stroke="rgba(255,214,224,0.12)" strokeWidth="3" />
        <circle cx="20" cy="20" r={r} fill="none" stroke={col} strokeWidth="3" strokeLinecap="round" transform="rotate(-90 20 20)"
          strokeDasharray={`${(c * n) / 100} ${c}`} style={{ filter: `drop-shadow(0 0 3px ${col})` }} />
        <text x="20" y="21" textAnchor="middle" dominantBaseline="middle" className="score-ring-num" fill="#fff5f7">{n}</text>
      </svg>
      <span className={`score-conf ${v.learning ? "learning" : ""}`}>{v.learning ? "learning" : v.conf === "high" ? "high" : "med"}</span>
    </div>
  );
}

/** "Why this score": the expected views multiple and the top factors each way, as bars in score points. */
export function ScoreWhy({ v, open }: { v: Virality; open?: boolean }) {
  const max = Math.max(8, ...[...v.up, ...v.down].map((f) => Math.abs(f.pts)));
  const Row = ({ text, pts }: { text: string; pts: number }) => (
    <li className="score-factor">
      <span className="min-w-0 leading-snug">{text}</span>
      <span className="num text-right">{pts > 0 ? "+" : "−"}{Math.abs(Math.round(pts))}</span>
      <span className="score-bar" aria-hidden><i style={{ width: `${(Math.abs(pts) / max) * 100}%`, background: pts > 0 ? "linear-gradient(90deg,#ff2e63,#ffb347)" : "linear-gradient(90deg,#a855f7,#c084fc)" }} /></span>
    </li>
  );
  return (
    <details className="score-why" open={open}>
      <summary>Why {v.score}?</summary>
      <p className="muted mt-1 text-[11px] leading-snug">
        {v.learning ? `Rough guess while ORBIT learns your channel: about ${v.mult.toFixed(1)}× your usual views.` : `Expected about ${v.mult.toFixed(1)}× your usual views (learned from ${v.n} of your Shorts).`}
      </p>
      {v.up.length > 0 && <ul className="mt-1 space-y-1" aria-label="Helps the score">{v.up.map((f) => <Row key={f.key} text={f.text} pts={f.pts} />)}</ul>}
      {v.down.length > 0 && <ul className="mt-1.5 space-y-1" aria-label="Hurts the score">{v.down.map((f) => <Row key={f.key} text={f.text} pts={f.pts} />)}</ul>}
      {!v.up.length && !v.down.length && <p className="muted mt-1 text-[11px]">Nothing stands out either way: an average clip for your channel.</p>}
    </details>
  );
}
