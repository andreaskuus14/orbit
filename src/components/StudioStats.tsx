"use client";
import { useCallback, useEffect, useId, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent, type ReactNode } from "react";
import { coach, type Finding } from "@/lib/studio-coach-pure";
import { useT } from "./i18n";
import { channelHealth, postedThisWeek, type Health, type Light } from "@/lib/studio-health-pure";
import type { Accuracy, Forecast, Hint } from "@/lib/clips/forecast-pure";
import type { ExperimentsView } from "@/lib/clips/experiments";
import type { Key } from "@/lib/i18n-pure";
import { FEW_VIEWS, areaPath, compact, delta, linePath, mmss, niceTicks, tooFewToCompare, toPoints, type Box } from "@/lib/chart-pure";

// STUDIO stats: YouTube Analytics dashboard drawn over the left of the 3D world. Hand-written SVG charts.
// Data: GET /api/studio/analytics (OAuth, read-only). Mounted inside `.studio`, fills its container.

// Same shapes as src/lib/yt-analytics-pure.ts (declared here so this file stands alone).
type Totals = { views: number; watchMinutes: number; avgViewSec: number; subsGained: number; subsLost: number; likes: number; comments: number; shares: number };
type Daily = { day: string; views: number; watchMinutes: number; subsGained: number; subsLost: number };
type Analytics =
  | { connected: false; reason: "not_configured" | "not_connected" | "expired"; setupEnv?: string[] }
  | { connected: true; channelTitle: string; range: { days: number; start: string; end: string };
      totals: Totals; prevTotals: Totals; daily: Daily[];
      traffic: { source: string; label: string; views: number }[];
      countries: { country: string; views: number }[];
      topVideos?: { id: string; views: number; watchMinutes: number; avgViewSec: number }[];
      retention?: { t: number; ratio: number; relative: number }[];
      engaged?: { cur: number; prev: number };
      warnings: string[]; fetchedAt: string };
type Live = Extract<Analytics, { connected: true }>;

const C = { cherry: "#ff2e63", rose: "#ff8fab", blush: "#ffd6e0", wine: "#800f2f", grid: "rgba(255,214,224,0.08)", axis: "rgba(255,214,224,0.55)", surface: "#14020b" };
const RANGES = [[7, "7D"], [28, "28D"], [90, "90D"], [365, "1Y"]] as const;
const METRICS = [
  ["views", "Views", (d: Daily) => d.views, compact],
  ["watch", "Watch time", (d: Daily) => d.watchMinutes / 60, (v: number) => `${compact(v)} h`],
  ["subs", "Subscribers gained", (d: Daily) => d.subsGained, compact],
] as const;
type Metric = (typeof METRICS)[number][0];

const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));
const shortId = (id: string) => (id.length > 8 ? `${id.slice(0, 8)}…` : id);
const dayLabel = (day: string, year = false) => {
  const t = Date.parse(`${day}T00:00:00Z`);
  return Number.isFinite(t) ? new Date(t).toLocaleDateString("en", { month: "short", day: "numeric", ...(year ? { year: "numeric" } : {}), timeZone: "UTC" }) : day;
};
const regions = (() => { try { return new Intl.DisplayNames(["en"], { type: "region" }); } catch { return null; } })();
const country = (code: string) => { try { return regions?.of(code.toUpperCase()) ?? code; } catch { return code; } };

/* ---------- chart plumbing ---------- */

function useWidth() {
  const ref = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setW(Math.floor(e.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, w] as const;
}

const STEP: Record<string, number> = { ArrowLeft: -1, ArrowRight: 1, Home: -Infinity, End: Infinity };
/** Hover/keyboard scrubbing over n x-positions: pointer snaps to the nearest index, ←/→/Home/End move it. */
function useScrub(n: number, indexAt: (x: number) => number) {
  const [raw, setI] = useState<number | null>(null);
  const i = raw == null || n === 0 ? null : Math.min(raw, n - 1);
  return {
    i,
    handlers: {
      tabIndex: 0,
      onPointerMove: (e: PointerEvent<HTMLDivElement>) => {
        if (!n) return;
        // CSS zoom on world overlays: screen px → layout px, or the crosshair lags the cursor.
        const el = e.currentTarget, r = el.getBoundingClientRect(), z = el.offsetWidth ? r.width / el.offsetWidth : 1;
        setI(clamp(indexAt((e.clientX - r.left) / z), 0, n - 1));
      },
      onPointerLeave: () => setI(null),
      onBlur: () => setI(null),
      onKeyDown: (e: KeyboardEvent<HTMLDivElement>) => {
        if (!n) return;
        const k = STEP[e.key];
        if (k === undefined) return;
        e.preventDefault();
        setI((p) => clamp((p ?? (k < 0 ? n : -1)) + k, 0, n - 1));
      },
    },
  };
}

const PAD = { l: 44, r: 12, t: 10, b: 24 };
const boxFor = (w: number, h: number): Box => ({ x0: PAD.l, x1: Math.max(PAD.l + 1, w - PAD.r), y0: PAD.t, y1: h - PAD.b });
/** ~one x label per 90px, always first and last. */
const xTicks = (n: number, plotW: number) => {
  if (n <= 1) return n ? [0] : [];
  const k = clamp(Math.floor(plotW / 90), 1, n - 1);
  return [...new Set(Array.from({ length: k + 1 }, (_, j) => Math.round((j * (n - 1)) / k)))];
};
const anchor = (j: number, n: number) => (j === 0 ? "start" : j === n - 1 ? "end" : "middle");

function Tip({ x, w, children }: { x: number; w: number; children: ReactNode }) {
  return (
    <div aria-hidden className="studio-tip pointer-events-none" style={{ width: "auto", minWidth: "8rem", top: 4, transform: `translateX(${clamp(x + 12, 0, Math.max(0, w - 150))}px)` }}>
      {children}
    </div>
  );
}

type Series = { name: string; values: number[]; color: string; fill?: boolean; faint?: boolean };

/** Smooth line/area chart with a crosshair, tooltip, keyboard scrubbing and an sr-only table. */
function LineChart({ title, labels, tipLabels, series, fmtY, height = 220, max: fixedMax }: {
  title: string; labels: string[]; tipLabels?: string[]; series: Series[]; fmtY: (v: number) => string; height?: number; max?: number;
}) {
  const { t: tr } = useT();
  const [ref, w] = useWidth();
  const gid = `g${useId().replace(/[^\w-]/g, "")}`;
  const n = labels.length, box = boxFor(w, height);
  const dataMax = Math.max(0, ...series.flatMap((s) => s.values.filter(Number.isFinite)));
  const ticks = niceTicks(Math.max(dataMax, fixedMax ?? 0));
  const top = ticks[ticks.length - 1];
  const pts = series.map((s) => toPoints(s.values, box, top));
  const { i, handlers } = useScrub(n, (x) => (n > 1 ? Math.round(((x - box.x0) / (box.x1 - box.x0)) * (n - 1)) : 0));
  const tl = tipLabels ?? labels;
  const yAt = (v: number) => box.y1 - (v / top) * (box.y1 - box.y0);

  return (
    <figure className="m-0">
      <div ref={ref} className="relative outline-offset-2" style={{ height }} role="group"
        aria-label={`${title}. Use left and right arrow keys to read each value.`} {...handlers}>
        {w > 0 && (
          <svg width={w} height={height} aria-hidden className="block select-none">
            <defs>
              <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0" stopColor={C.cherry} stopOpacity="0.32" />
                <stop offset="1" stopColor={C.cherry} stopOpacity="0" />
              </linearGradient>
            </defs>
            {ticks.map((t) => (
              <g key={t}>
                <line x1={box.x0} x2={box.x1} y1={yAt(t)} y2={yAt(t)} stroke={C.grid} />
                <text x={box.x0 - 6} y={yAt(t)} dy="0.32em" textAnchor="end" fontSize="10" fill={C.axis} className="num">{fmtY(t)}</text>
              </g>
            ))}
            {xTicks(n, box.x1 - box.x0).map((j) => (
              <text key={j} x={pts[0]?.[j]?.x ?? box.x0} y={height - 6} textAnchor={anchor(j, n)} fontSize="10" fill={C.axis}>{labels[j]}</text>
            ))}
            {series.map((s, k) => s.fill && <path key={`a${k}`} d={areaPath(pts[k], box)} fill={`url(#${gid})`} />)}
            {series.map((s, k) => (
              <path key={`l${k}`} d={linePath(pts[k], box)} fill="none" stroke={s.color} strokeWidth={1.5} strokeOpacity={s.faint ? 0.45 : 1}
                strokeDasharray={s.faint ? "4 3" : undefined} strokeLinejoin="round" strokeLinecap="round" />
            ))}
            {i != null && (
              <g>
                <line x1={pts[0][i].x} x2={pts[0][i].x} y1={box.y0} y2={box.y1} stroke={C.blush} strokeOpacity={0.35} />
                {series.map((s, k) => <circle key={k} cx={pts[k][i].x} cy={pts[k][i].y} r={4} fill={s.color} stroke={C.surface} strokeWidth={2} />)}
              </g>
            )}
          </svg>
        )}
        {i != null && w > 0 && (
          <Tip x={pts[0][i].x} w={w}>
            <span>{tl[i]}</span>
            {series.map((s) => (
              <div key={s.name} className="flex items-center gap-2">
                <i className="inline-block h-0.5 w-3" style={{ background: s.color, opacity: s.faint ? 0.6 : 1 }} />
                <b className="num">{fmtY(s.values[i])}</b>{series.length > 1 && <span>{s.name}</span>}
              </div>
            ))}
          </Tip>
        )}
        <p className="sr-only" aria-live="polite">{i != null ? `${tl[i]}: ${series.map((s) => `${s.name} ${fmtY(s.values[i])}`).join(", ")}` : ""}</p>
      </div>
      <table className="sr-only">
        <caption>{title}</caption>
        <thead><tr><th scope="col">{tr("ss.point")}</th>{series.map((s) => <th key={s.name} scope="col">{s.name}</th>)}</tr></thead>
        <tbody>{tl.map((l, j) => <tr key={j}><th scope="row">{l}</th>{series.map((s) => <td key={s.name}>{fmtY(s.values[j])}</td>)}</tr>)}</tbody>
      </table>
    </figure>
  );
}

/** Bar with a rounded data end and a square baseline end; `up` grows from base toward smaller y. */
function barD(x: number, w: number, base: number, end: number) {
  const h = Math.abs(base - end), r = Math.min(4, w / 2, h), up = end < base, s = up ? 1 : -1;
  if (h < 0.5) return "";
  return `M${x},${base}V${end + s * r}Q${x},${end} ${x + r},${end}H${x + w - r}Q${x + w},${end} ${x + w},${end + s * r}V${base}Z`;
}

/** Subscribers per day: gained as rose bars up, lost as dim bars down, around a centre baseline. */
const LIGHT: Record<Light, { dot: string; word: string }> = {
  green: { dot: "#4ade80", word: "good" }, yellow: { dot: "#facc15", word: "getting there" }, red: { dot: "#f87171", word: "needs work" }, grey: { dot: "#94a3b8", word: "not enough data" },
};
/** The three numbers that matter most, each with a light, and one plain next step. Details stay below. */
function HealthCard({ h }: { h: Health }) {
  const { t: tr } = useT();
  return (
    <section className="card space-y-2" aria-labelledby="health-title">
      <h3 id="health-title" className="text-sm font-semibold">{tr("ss.health")}</h3>
      <ul className="grid gap-2 sm:grid-cols-3">{h.items.map((i) => (
        <li key={i.id} className="rounded-md border border-white/10 p-2">
          <div className="flex items-center gap-1.5 text-xs"><span aria-hidden className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: LIGHT[i.light].dot }} />
            {i.label}<span className="sr-only">: {tr(`ss.light.${i.light}`)}</span></div>
          <div className="num text-lg font-semibold">{i.value}</div>
          <div className="muted text-[11px]">{tr("ss.goal")} {i.goal}</div>
        </li>))}</ul>
      <p className="text-sm"><b>{tr("ss.doNext")}</b> {h.next}</p>
    </section>
  );
}

function SubsChart({ daily }: { daily: Daily[] }) {
  const { t: tr } = useT();
  const [ref, w] = useWidth();
  const H = 180, n = daily.length, box = boxFor(w, H);
  const ticks = niceTicks(Math.max(1, ...daily.map((d) => Math.max(d.subsGained || 0, d.subsLost || 0))), 2, true);
  const top = ticks[ticks.length - 1];
  const mid = (box.y0 + box.y1) / 2, half = (box.y1 - box.y0) / 2;
  const bw = n ? (box.x1 - box.x0) / n : 0, barW = Math.min(24, bw > 4 ? bw - 2 : Math.max(0.6, bw * 0.8));
  const { i, handlers } = useScrub(n, (x) => Math.floor((x - box.x0) / (bw || 1)));
  const y = (v: number, sign: number) => mid - sign * (clamp(v || 0, 0, top) / top) * half;
  const d = i != null ? daily[i] : null;

  return (
    <figure className="m-0">
      <div className="mb-1 flex gap-3 text-[11px]" aria-hidden>
        <span className="flex items-center gap-1"><i className="inline-block size-2.5 rounded-sm" style={{ background: C.rose }} />{tr("ss.gainedUp")}</span>
        <span className="flex items-center gap-1"><i className="inline-block size-2.5 rounded-sm" style={{ background: C.wine }} />{tr("ss.lostDown")}</span>
      </div>
      <div ref={ref} className="relative" style={{ height: H }} role="group" aria-label={tr("ss.subsAria")} {...handlers}>
        {w > 0 && (
          <svg width={w} height={H} aria-hidden className="block select-none">
            {[top, 0, -top].map((t) => (
              <g key={t}>
                <line x1={box.x0} x2={box.x1} y1={y(Math.abs(t), Math.sign(t))} y2={y(Math.abs(t), Math.sign(t))} stroke={t === 0 ? C.axis : C.grid} strokeOpacity={t === 0 ? 0.4 : 1} />
                <text x={box.x0 - 6} y={y(Math.abs(t), Math.sign(t))} dy="0.32em" textAnchor="end" fontSize="10" fill={C.axis} className="num">{t > 0 ? `+${compact(t)}` : t < 0 ? `−${compact(-t)}` : "0"}</text>
              </g>
            ))}
            {daily.map((dd, j) => {
              const x = box.x0 + j * bw + (bw - barW) / 2, on = i === j;
              return (
                <g key={dd.day} opacity={i == null || on ? 1 : 0.55}>
                  {dd.subsGained > 0 && <path d={barD(x, barW, mid - 1, y(dd.subsGained, 1))} fill={C.rose} />}
                  {dd.subsLost > 0 && <path d={barD(x, barW, mid + 1, y(dd.subsLost, -1))} fill={C.wine} stroke={on ? C.rose : undefined} />}
                </g>
              );
            })}
            {xTicks(n, box.x1 - box.x0).map((j) => (
              <text key={j} x={box.x0 + j * bw + bw / 2} y={H - 6} textAnchor={anchor(j, n)} fontSize="10" fill={C.axis}>{dayLabel(daily[j].day)}</text>
            ))}
          </svg>
        )}
        {d && w > 0 && (
          <Tip x={box.x0 + i! * bw + bw / 2} w={w}>
            <span>{dayLabel(d.day, true)}</span>
            <b className="num">{tr("ss.gainedLost", { g: d.subsGained, l: d.subsLost })}</b>
            <span>{tr("ss.net")} {d.subsGained - d.subsLost >= 0 ? "+" : "−"}{Math.abs(d.subsGained - d.subsLost)}</span>
          </Tip>
        )}
        <p className="sr-only" aria-live="polite">{d ? `${dayLabel(d.day, true)}: ${tr("ss.gainedLost", { g: d.subsGained, l: d.subsLost })}` : ""}</p>
      </div>
      <table className="sr-only">
        <caption>{tr("ss.subsPerDay")}</caption>
        <thead><tr><th scope="col">{tr("ss.day")}</th><th scope="col">{tr("ss.gained")}</th><th scope="col">{tr("ss.lost")}</th></tr></thead>
        <tbody>{daily.map((x) => <tr key={x.day}><th scope="row">{x.day}</th><td>{x.subsGained}</td><td>{x.subsLost}</td></tr>)}</tbody>
      </table>
    </figure>
  );
}

/** Horizontal bars (HTML): label, bar scaled to the largest, value and share of the total as text. */
function HBars({ rows, label }: { rows: { label: string; value: number }[]; label: string }) {
  const { t: tr } = useT();
  const total = rows.reduce((s, r) => s + (r.value || 0), 0), max = Math.max(1, ...rows.map((r) => r.value || 0));
  if (!rows.length) return <p className="muted text-xs">{tr("ss.noData")}</p>;
  return (
    <ul className="space-y-1.5" aria-label={label}>
      {rows.slice(0, 8).map((r, k) => (
        <li key={k} className="grid grid-cols-[minmax(0,8rem)_1fr_auto] items-center gap-2 text-xs">
          <span className="truncate" title={r.label}>{r.label}</span>
          <span aria-hidden className="h-2 rounded-full" style={{ background: C.grid }}>
            <span className="block h-full rounded-full" style={{ width: `${((r.value || 0) / max) * 100}%`, minWidth: r.value ? 2 : 0, background: `linear-gradient(90deg, ${C.wine}, ${C.cherry})` }} />
          </span>
          <span className="num whitespace-nowrap text-right">{compact(r.value)} <span className="muted">· {total ? Math.round(((r.value || 0) / total) * 100) : 0}%</span></span>
        </li>
      ))}
    </ul>
  );
}

function Spark({ values }: { values: number[] }) {
  if (values.length < 2) return null;
  const box = { x0: 0, x1: 100, y0: 2, y1: 26 };
  const lo = Math.min(0, ...values.filter(Number.isFinite)), hi = Math.max(lo + 1, ...values.filter(Number.isFinite));
  return (
    <svg viewBox="0 0 100 28" preserveAspectRatio="none" className="mt-1 h-6 w-full" aria-hidden>
      <path d={linePath(toPoints(values, box, hi, lo), box)} fill="none" stroke={C.rose} strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

function Kpi({ label, value, cur, prev, spark, few }: { label: string; value: string; cur: number; prev: number; spark?: number[]; few?: boolean }) {
  const { t: tr } = useT();
  const d = few ? { dir: 0, text: "—" } : delta(cur, prev); // few views: a % change would be noise
  return (
    <div className="card !p-2.5">
      <dt className="muted text-[10px] uppercase tracking-widest">{label}</dt>
      <dd className="num text-xl font-semibold">{value}</dd>
      <dd className="num text-[11px] !text-shadow-none" style={{ color: d.dir > 0 ? C.rose : "var(--muted)" }}>
        {d.text} <span className="sr-only">{tr(few ? "ss.tooFewPrev" : "ss.vsPrevLong")}</span><span aria-hidden className="muted">{tr("ss.vsPrev")}</span>
        {spark && <Spark values={spark} />}
      </dd>
    </div>
  );
}

const LEVEL = { fix: { icon: "⚠", label: "Fix" }, good: { icon: "▲", label: "Working" }, info: { icon: "ⓘ", label: "Note" } } as const;
/** What the numbers mean and the one thing to do next (studio-coach-pure.ts). */
function Coach({ findings }: { findings: Finding[] }) {
  const { t: tr } = useT();
  if (!findings.length) return <p className="card text-xs muted">{tr("ss.nothing")}</p>;
  return (
    <section className="card" aria-label={tr("ss.coach")}>
      <h3 className="hud-title studio-title mb-2 !text-[0.7rem]">{tr("ss.coachHead")}</h3>
      <ol className="space-y-2.5">
        {findings.map((f) => (
          <li key={f.title} className="grid grid-cols-[auto_1fr] gap-x-2 text-sm">
            <span aria-hidden style={{ color: f.level === "good" ? C.rose : f.level === "fix" ? C.cherry : "var(--muted)" }}>{LEVEL[f.level].icon}</span>
            <div className="min-w-0">
              <p className="font-semibold"><span className="sr-only">{tr(`ss.level.${f.level}`)}: </span>{f.title}</p>
              <p className="muted text-xs">{f.why}</p>
              <p className="text-xs"><b>{tr("ss.doThis")}</b> {f.todo}</p>
            </div>
          </li>
        ))}
      </ol>
      <p className="muted mt-2 text-[10px]">{tr("ss.rulesOfThumb")}</p>
    </section>
  );
}

function Section({ title, children, className = "" }: { title: string; children: ReactNode; className?: string }) {
  return (
    <section className={`card ${className}`} aria-label={title}>
      <h3 className="hud-title studio-title mb-2 !text-[0.7rem]">{title.toUpperCase()}</h3>
      {children}
    </section>
  );
}

const Skeleton = ({ h, reduced }: { h: number; reduced: boolean }) => (
  <div aria-hidden className={`card ${reduced ? "" : "animate-pulse"}`} style={{ height: h, opacity: 0.6 }} />
);

/* ---------- dashboard ---------- */

export function StudioStats({ videoId, videoTitle, reduced, onPickVideo, titleOf, onClose }: {
  onClose?: () => void;
  videoId: string | null; videoTitle?: string; reduced: boolean; onPickVideo?: (id: string) => void;
  titleOf?: (id: string) => string | undefined; // optional: video titles for the top-videos table
}) {
  const { t: tr } = useT();
  const [range, setRange] = useState<7 | 28 | 90 | 365>(28);
  const [scope, setScope] = useState<"channel" | "video">(videoId ? "video" : "channel");
  const [metric, setMetric] = useState<Metric>("views");
  const [data, setData] = useState<Analytics | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [flash, setFlash] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const seq = useRef(0);
  const shown = useRef(""); // which range|video the data on screen belongs to

  useEffect(() => { setScope(videoId ? "video" : "channel"); }, [videoId]);
  const vid = scope === "video" ? videoId : null;

  const load = useCallback(async (force = false) => {
    const s = ++seq.current, key = `${range}|${vid ?? ""}`;
    if (shown.current !== key) { shown.current = key; setData(null); } // never show channel numbers under "Video" (or vice versa)
    setLoading(true);
    try {
      const res = await fetch(`/api/studio/analytics?range=${range}${vid ? `&video=${encodeURIComponent(vid)}` : ""}${force ? "&refresh=1" : ""}`, { cache: "no-store" });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || `Couldn't load analytics (${res.status})`);
      if (s === seq.current) { setData(json as Analytics); setErr(""); }
    } catch (e) { if (s === seq.current) setErr(e instanceof Error ? e.message : "Couldn't load analytics"); }
    finally { if (s === seq.current) setLoading(false); }
  }, [range, vid]);
  useEffect(() => { void load(); }, [load]);

  // Back from Google's consent screen: ?studio=connected | ?studio=error&reason=…
  useEffect(() => {
    const q = new URLSearchParams(window.location.search), s = q.get("studio");
    if (!s) return;
    // Only our own codes get a message: the query is attacker-controllable, so never echo it.
    const why: Record<string, string> = {
      denied: "you cancelled on Google's screen", scope: "a permission box was unticked", no_channel: "that Google account has no YouTube channel",
      state: "the sign-in expired; try again", not_configured: "the OAuth client isn't set in .env.local", save: "the token file couldn't be saved",
      exchange: "Google rejected the sign-in", no_refresh: "Google didn't return a long-lived token", channel: "couldn't read your channel", google: "Google returned an error",
    };
    const reason = why[q.get("reason") ?? ""];
    setFlash(s === "connected" ? { ok: true, text: "YouTube connected." } : { ok: false, text: `Couldn't connect YouTube${reason ? `: ${reason}` : ""}.` });
    q.delete("studio"); q.delete("reason");
    const rest = q.toString();
    window.history.replaceState(window.history.state, "", `${window.location.pathname}${rest ? `?${rest}` : ""}${window.location.hash}`);
  }, []);

  async function disconnect() {
    setBusy(true);
    try {
      const res = await fetch("/api/studio/oauth/disconnect", { method: "POST" });
      if (!res.ok) throw new Error(`Couldn't disconnect (${res.status})`);
      setFlash({ ok: true, text: "YouTube disconnected; the token was removed." });
      await load();
    } catch (e) { setFlash({ ok: false, text: e instanceof Error ? e.message : "Couldn't disconnect" }); }
    finally { setBusy(false); }
  }

  const live: Live | null = data?.connected ? data : null;
  const few = !!live && tooFewToCompare(live.totals, live.prevTotals);
  const [full, setFull] = useState(false); // simple view first: coach + 4 numbers + the trend; everything else one tap away
  const findings = useMemo(() => (live ? coach(live, titleOf) : []), [live, titleOf]);
  const [posted, setPosted] = useState<number | null>(null); // Shorts live in the last 7 days, from ORBIT's own clip jobs
  useEffect(() => {
    fetch("/api/studio/clips", { cache: "no-store" }).then((r) => (r.ok ? r.json() : null))
      .then((j: { jobs?: { clips: Parameters<typeof postedThisWeek>[0] }[] } | null) => setPosted(j?.jobs ? postedThisWeek(j.jobs.flatMap((x) => x.clips), Date.now()) : null))
      .catch(() => setPosted(null)); // unknown stays grey, never a guessed number
  }, [live]);
  const health = useMemo(() => (live ? channelHealth({ posted, views: live.totals.views, shortsViews: live.traffic.find((t) => t.source === "SHORTS")?.views ?? 0,
    engaged: live.engaged?.cur, avgViewSec: live.totals.avgViewSec }) : null), [live, posted]);
  const daily = useMemo(() => live?.daily ?? [], [live]);
  const m = METRICS.find((x) => x[0] === metric)!;
  const labels = useMemo(() => daily.map((d) => dayLabel(d.day)), [daily]);
  const tipLabels = useMemo(() => daily.map((d) => dayLabel(d.day, true)), [daily]);
  const vName = videoTitle || (videoId ? shortId(videoId) : "");

  return (
    <div className={`studio-stats glass @container h-full w-full overflow-y-auto p-3 sm:p-4 ${reduced ? "" : "panel-in"}`} role="region" aria-label={tr("ss.region")} aria-busy={loading}>
      {/* header */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="hud-title studio-title truncate">{tr("ss.stats")}{live ? ` · ${live.channelTitle.toUpperCase()}` : ""}</h2>
        <div className="flex items-center gap-2">
          {live && <span className="muted text-[11px]">{tr("ss.updated")} {new Date(live.fetchedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>}
          <button className="chip" onClick={() => load(true)} disabled={loading} aria-label={tr("ss.refreshAria")}>{tr(loading ? "common.loading" : "cf.refresh")}</button>
          {onClose && <button className="chip" onClick={onClose} aria-label={tr("ss.close")}>×</button>}
        </div>
      </div>
      {flash && (
        <p className={`mt-1 text-xs ${flash.ok ? "ok" : "error"}`} role="status">
          {flash.text} <button className="underline" onClick={() => setFlash(null)} aria-label={tr("ss.dismissMsg")}>{tr("cf.dismiss")}</button>
        </p>
      )}

      {(!data || data.connected) && ( // keep range/scope chips when a request failed, so the user can switch back
        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1">
          <div className="flex gap-1" role="group" aria-label={tr("ss.range")}>
            {RANGES.map(([d, l]) => <button key={d} className="chip num" aria-pressed={range === d} onClick={() => setRange(d)}>{l}</button>)}
          </div>
          <div className="flex min-w-0 gap-1" role="group" aria-label={tr("ss.scope")}>
            <button className="chip" aria-pressed={scope === "channel"} onClick={() => setScope("channel")}>{tr("ss.channel")}</button>
            <button className="chip min-w-0 max-w-[16rem] truncate" aria-pressed={scope === "video"} disabled={!videoId} onClick={() => setScope("video")}
              title={videoTitle} aria-label={videoId ? tr("ss.selectedVideo", { name: videoTitle || videoId }) : tr("ss.videoPickFirst")}>
              {videoId ? `${tr("ss.video")} · ${vName}` : tr("ss.videoPick")}
            </button>
          </div>
        </div>
      )}

      {err && (
        <div className="card mt-3 text-sm" role="alert">
          <p className="error">{err}</p>
          <button className="btn mt-2" onClick={() => load()} disabled={loading}>{tr("task.retry")}</button>
        </div>
      )}

      {loading && !data && !err && (
        <div className="mt-3 space-y-3" aria-label={tr("ss.loading")}>
          <div className="grid grid-cols-[repeat(auto-fill,minmax(8.5rem,1fr))] gap-2">{Array.from({ length: 7 }, (_, k) => <Skeleton key={k} h={92} reduced={reduced} />)}</div>
          <Skeleton h={260} reduced={reduced} />
          <div className="grid gap-3 @2xl:grid-cols-2"><Skeleton h={200} reduced={reduced} /><Skeleton h={200} reduced={reduced} /></div>
        </div>
      )}

      {data && !data.connected && <NotConnected data={data} />}

      {live && (
        <div className="mt-3 space-y-3" style={{ opacity: loading ? 0.55 : 1, transition: reduced ? "none" : "opacity 0.2s" }}>
          <p className="muted text-xs">
            {dayLabel(live.range.start, true)} – {dayLabel(live.range.end, true)} · {tr("ss.through", { d: dayLabel(live.range.end, true) })}
          </p>

          {few && (
            <p className="card text-xs" role="note">
              <b>{tr("ss.collecting")}</b> {tr("ss.fewViews", { n: live.totals.views, min: FEW_VIEWS })}
            </p>
          )}

          {health && <HealthCard h={health} />}

          <Coach findings={findings} />

          <dl className="grid grid-cols-[repeat(auto-fill,minmax(8.5rem,1fr))] gap-2">
            <Kpi few={few} label={tr("ss.views")} value={compact(live.totals.views)} cur={live.totals.views} prev={live.prevTotals.views} spark={daily.map((d) => d.views)} />
            {full && <Kpi few={few} label={tr("ss.watchTime")} value={`${compact(live.totals.watchMinutes / 60)} h`} cur={live.totals.watchMinutes} prev={live.prevTotals.watchMinutes} spark={daily.map((d) => d.watchMinutes)} />}
            <Kpi few={few} label={tr("ss.avgView")} value={mmss(live.totals.avgViewSec)} cur={live.totals.avgViewSec} prev={live.prevTotals.avgViewSec}
              spark={daily.map((d) => (d.views > 0 ? (d.watchMinutes * 60) / d.views : 0))} />
            <Kpi few={few} label={tr("ss.subscribers")} value={`${live.totals.subsGained - live.totals.subsLost >= 0 ? "+" : "−"}${compact(Math.abs(live.totals.subsGained - live.totals.subsLost))}`}
              cur={live.totals.subsGained - live.totals.subsLost} prev={live.prevTotals.subsGained - live.prevTotals.subsLost} spark={daily.map((d) => d.subsGained - d.subsLost)} />
            {live.engaged && <Kpi few={few} label={tr("ss.engaged")} value={compact(live.engaged.cur)} cur={live.engaged.cur} prev={live.engaged.prev} />}
            {full && <Kpi few={few} label={tr("ss.likes")} value={compact(live.totals.likes)} cur={live.totals.likes} prev={live.prevTotals.likes} />}
            {full && <Kpi few={few} label={tr("ss.comments")} value={compact(live.totals.comments)} cur={live.totals.comments} prev={live.prevTotals.comments} />}
            {full && <Kpi few={few} label={tr("ss.shares")} value={compact(live.totals.shares)} cur={live.totals.shares} prev={live.prevTotals.shares} />}
          </dl>

          <section className="card" aria-label={tr("ss.trend")}>
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <h3 className="hud-title studio-title !text-[0.7rem]">{tr("ss.perDay", { m: tr(`ss.m.${m[0]}`) }).toUpperCase()}</h3>
              <div className="flex gap-1" role="group" aria-label={tr("ss.metric")}>
                {METRICS.map(([k]) => <button key={k} className="chip" aria-pressed={metric === k} onClick={() => setMetric(k)}>{tr(`ss.m.${k}`)}</button>)}
              </div>
            </div>
            {daily.length ? (
              <LineChart title={tr("ss.perDay", { m: tr(`ss.m.${m[0]}`) })} labels={labels} tipLabels={tipLabels}
                series={[{ name: tr(`ss.m.${m[0]}`), values: daily.map(m[2]), color: C.cherry, fill: true }]} fmtY={m[3]} />
            ) : <p className="muted text-xs">{tr("ss.noDaily")}</p>}
          </section>

          {!vid && <Forecasts />}
          {!vid && <Experiments />}

          <button className="chip" aria-expanded={full} onClick={() => setFull((f) => !f)}>{full ? `▴ ${tr("ss.simple")}` : `▾ ${tr("ss.full")}`}</button>

          {full && <div className="grid gap-3 @2xl:grid-cols-2">
            <Section title={tr("ss.subsTitle")}>
              {daily.length ? <SubsChart daily={daily} /> : <p className="muted text-xs">{tr("ss.noData")}</p>}
            </Section>
            {vid ? (
              <Section title={tr("ss.retention")}>
                {live.retention?.length ? (
                  <>
                    <div className="mb-1 flex gap-3 text-[11px]" aria-hidden>
                      <span className="flex items-center gap-1"><i className="inline-block h-0.5 w-4" style={{ background: C.cherry }} />{tr("ss.still")}</span>
                      <span className="flex items-center gap-1"><i className="inline-block h-0.5 w-4 opacity-60" style={{ background: C.blush }} />{tr("ss.relativeLong")}</span>
                    </div>
                    <LineChart title={tr("ss.retentionTitle")} height={180} max={1}
                      labels={live.retention.map((r) => `${Math.round(r.t * 100)}%`)} tipLabels={live.retention.map((r) => tr("ss.into", { pct: Math.round(r.t * 100) }))}
                      series={[
                        { name: tr("ss.still"), values: live.retention.map((r) => r.ratio), color: C.cherry, fill: true },
                        { name: tr("ss.relative"), values: live.retention.map((r) => r.relative), color: C.blush, faint: true },
                      ]}
                      fmtY={(v) => `${Math.round((Number.isFinite(v) ? v : 0) * 100)}%`} />
                  </>
                ) : <p className="muted text-xs">{tr("ss.retentionHidden")}</p>}
              </Section>
            ) : (
              <Section title={tr("ss.topVideos")}>
                <TopVideos rows={live.topVideos ?? []} titleOf={titleOf} onPick={onPickVideo} selected={videoId} />
              </Section>
            )}
            <Section title={tr("ss.traffic")}>
              <HBars label={tr("ss.traffic")} rows={live.traffic.map((t) => ({ label: t.label || t.source, value: t.views }))} />
            </Section>
            <Section title={tr("ss.countries")}>
              <HBars label={tr("ss.countries")} rows={live.countries.map((c) => ({ label: country(c.country), value: c.views }))} />
            </Section>
          </div>}

          {live.warnings.length > 0 && <p className="muted text-xs">{live.warnings.join(" · ")}</p>}
          <p className="text-right text-xs">
            <button className="muted underline" onClick={disconnect} disabled={busy}>{tr(busy ? "ss.disconnecting" : "ss.disconnect")}</button>
          </p>
        </div>
      )}
    </div>
  );
}

type ForecastData = { items: (Forecast & { hint: Hint | null })[]; accuracy: Accuracy | null; history: number };
/** 7-day forecast per recent Short (clips/forecast-pure.ts): estimate, 80% range, one "next time" hint, and how past forecasts did. */
function Forecasts() {
  const { t: tr } = useT();
  const [d, setD] = useState<ForecastData | null>(null);
  useEffect(() => {
    let on = true;
    fetch("/api/studio/analytics?forecast=1", { cache: "no-store" }).then((r) => (r.ok ? r.json() : null))
      .then((j: ForecastData | null) => { if (on && Array.isArray(j?.items)) setD(j); }).catch(() => {}); // optional extra: quiet on failure
    return () => { on = false; };
  }, []);
  if (!d) return null;
  const lab = (dim: string, l: string) => (dim === "hookStyle" ? tr(`fc.hs.${l}` as Key) : l);
  const hint = (h: Hint) => h.key === "keep" ? tr("fc.hint.keep", { dim: tr(`fc.dim.${h.vars.dim}` as Key), label: lab(String(h.vars.dim), String(h.vars.label)) })
    : tr(`fc.hint.${h.key}`, h.key.startsWith("hook") && h.key !== "hookLen" ? { now: lab("hookStyle", String(h.vars.now)), to: lab("hookStyle", String(h.vars.to)) } : h.vars);
  return (
    <Section title={tr("fc.title")}>
      {d.items.length ? <ul className="space-y-2 text-xs">{d.items.map((f) => (
        <li key={f.videoId}>
          <a className="line-clamp-1 underline" href={`https://youtube.com/shorts/${f.videoId}`} target="_blank" rel="noreferrer">{f.title}</a>
          <p className="num"><b>{tr("fc.line", { p50: compact(f.p50), lo: compact(f.lo), hi: compact(f.hi) })}</b>{" "}
            <span className="muted">{tr("fc.from", { views: compact(f.views), h: f.ageH })}{f.method === "nn" ? ` · ${tr("fc.rough")}` : ""}</span></p>
          {f.hint && <p><b>{tr("fc.next")}</b> {hint(f.hint)}</p>}
        </li>))}</ul>
        : <p className="muted text-xs">{tr(d.history ? "fc.none" : "fc.needHistory")}</p>}
      <p className="muted mt-2 text-[11px]">{d.accuracy ? tr("fc.acc", { n: d.accuracy.n, err: d.accuracy.medianErrPct, inside: d.accuracy.inRange }) : tr("fc.accNone")}</p>
    </Section>
  );
}

type ExpData = ExperimentsView;
/** Shorts experiments (clips/experiments-pure.ts): hypothesis on one published Short, verdict vs comparable Shorts, baseline shown. */
function Experiments() {
  const { t: tr } = useT();
  const [d, setD] = useState<ExpData | null>(null);
  const [f, setF] = useState({ key: "", hypothesis: "", lesson: "", variant: "", window: "72h" });
  const [err, setErr] = useState("");
  const load = useCallback(() => {
    fetch("/api/studio/experiments", { cache: "no-store" }).then((r) => (r.ok ? r.json() : null)).then((j: ExpData | null) => { if (Array.isArray(j?.items)) setD(j); }).catch(() => {});
  }, []);
  useEffect(load, [load]);
  const send = async (init: RequestInit, q = "") => {
    setErr("");
    const r = await fetch(`/api/studio/experiments${q}`, init).catch(() => null), j = await r?.json().catch(() => null);
    if (!r?.ok) return setErr(j?.error ?? tr("common.failed"));
    setF({ key: "", hypothesis: "", lesson: "", variant: "", window: "72h" }); load();
  };
  if (!d) return null;
  const [jobId, clipId] = f.key.split("/"), [vJob, vClip] = f.variant.split("/");
  const titleOf = (a: { jobId: string; clipId: string }) => d.clips.find((c) => c.jobId === a.jobId && c.clipId === a.clipId)?.title ?? d.items.find((e) => e.jobId === a.jobId && e.clipId === a.clipId)?.title ?? a.clipId;
  return (
    <Section title={tr("exp.title")}>
      {d.items.length ? <ul className="space-y-2 text-xs">{d.items.map((e) => (
        <li key={e.id}>
          <p><b>{e.hypothesis}</b> <span className="muted">· {e.title}</span></p>
          <p>{tr(e.key as Key, e.vars)}</p>
          {e.baseline !== undefined && <p className="muted num">{tr("exp.base", { views: compact(e.views ?? 0), base: compact(e.baseline), n: e.n ?? 0, kind: tr(e.likeForLike ? "exp.like" : "exp.any") })}</p>}
          {e.compare && <div className="muted num">
            <p>{tr(`exp.cmp.${e.compare.status}` as const, { window: e.compare.window, ratio: e.compare.ratio ?? "" })}</p>
            <ul>{e.compare.arms.map((a, i) => <li key={`${a.jobId}/${a.clipId}`}>{a.views === undefined ? tr("exp.cmp.armWaiting", { title: i ? titleOf(a) : e.title, window: e.compare!.window })
              : tr("exp.cmp.arm", { title: i ? titleOf(a) : e.title, views: compact(a.views), at: (a.readAt ?? "").slice(0, 10) })}</li>)}</ul></div>}
          {e.verdict === "not-supported" && <p className="muted text-[11px]">{tr("exp.kept")}</p>}
          {e.forecast && <p className="muted num">{tr("fc.line", { p50: compact(e.forecast.p50), lo: compact(e.forecast.lo), hi: compact(e.forecast.hi) })}</p>}
          <p className="muted text-[11px]">{tr("exp.lessonIs", { lesson: e.lesson })}{e.version ? ` · ${e.version.videoId} · ${e.version.mediaHash.slice(0, 10)}` : ""}{" "}
            <button className="underline" onClick={() => void send({ method: "DELETE" }, `?id=${e.id}`)}>{tr("exp.remove")}</button></p>
        </li>))}</ul> : <p className="muted text-xs">{tr("exp.none")}</p>}
      {d.clips.length > 0 && <form className="mt-2 space-y-1 text-xs" onSubmit={(ev) => { ev.preventDefault(); void send({ method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jobId, clipId, hypothesis: f.hypothesis, lesson: f.lesson, window: f.window, ...(f.variant && { variants: [{ jobId: vJob, clipId: vClip }] }) }) }); }}>
        <select className="field w-full" aria-label={tr("exp.pick")} value={f.key} onChange={(ev) => setF({ ...f, key: ev.target.value })}>
          <option value="">{tr("exp.pick")}</option>
          {d.clips.map((c) => <option key={`${c.jobId}/${c.clipId}`} value={`${c.jobId}/${c.clipId}`}>{c.title}</option>)}
        </select>
        <select className="field w-full" aria-label={tr("exp.variant")} value={f.variant} onChange={(ev) => setF({ ...f, variant: ev.target.value })}>
          <option value="">{tr("exp.variant")}</option>
          {d.clips.filter((c) => `${c.jobId}/${c.clipId}` !== f.key).map((c) => <option key={`${c.jobId}/${c.clipId}`} value={`${c.jobId}/${c.clipId}`}>{c.title}</option>)}
        </select>
        <label className="flex items-center gap-1.5">{tr("exp.window")} <select className="field" value={f.window} onChange={(ev) => setF({ ...f, window: ev.target.value })}>
          {["24h", "48h", "72h", "7d"].map((w) => <option key={w} value={w}>{w}</option>)}</select></label>
        <input className="field w-full" maxLength={180} placeholder={tr("exp.hypothesis")} aria-label={tr("exp.hypothesis")} value={f.hypothesis} onChange={(ev) => setF({ ...f, hypothesis: ev.target.value })} />
        <input className="field w-full" maxLength={180} placeholder={tr("exp.lesson")} aria-label={tr("exp.lesson")} value={f.lesson} onChange={(ev) => setF({ ...f, lesson: ev.target.value })} />
        <button className="chip" disabled={!f.key || !f.hypothesis.trim() || !f.lesson.trim()}>{tr("exp.add")}</button>
      </form>}
      {err && <p className="text-xs text-red-400" role="alert">{err}</p>}
      <p className="muted mt-2 text-[11px]">{tr("exp.rule")}</p>
    </Section>
  );
}

function TopVideos({ rows, titleOf, onPick, selected }: { rows: NonNullable<Live["topVideos"]>; titleOf?: (id: string) => string | undefined; onPick?: (id: string) => void; selected: string | null }) {
  const { t: tr } = useT();
  if (!rows.length) return <p className="muted text-xs">{tr("ss.noVideoViews")}</p>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead className="muted text-[10px] uppercase tracking-widest">
          <tr><th scope="col" className="w-6 text-left">#</th><th scope="col" className="text-left">{tr("ss.video")}</th><th scope="col" className="text-right">{tr("ss.views")}</th><th scope="col" className="text-right">{tr("ss.watchH")}</th><th scope="col" className="text-right">{tr("ss.avg")}</th></tr>
        </thead>
        <tbody>
          {rows.slice(0, 10).map((r, k) => {
            const name = titleOf?.(r.id) || shortId(r.id);
            return (
              <tr key={r.id} className={`hud-row !table-row cursor-pointer${r.id === selected ? " on" : ""}`} onClick={() => onPick?.(r.id)}>
                <td className="num muted py-1">{k + 1}</td>
                <td className="max-w-0 truncate py-1 pr-2">
                  {onPick ? <button className="max-w-full truncate text-left hover:underline" onClick={(e) => { e.stopPropagation(); onPick(r.id); }} title={name} aria-label={tr("ss.showFor", { name })}>{name}</button> : name}
                </td>
                <td className="num text-right">{compact(r.views)}</td>
                <td className="num text-right">{compact(r.watchMinutes / 60)}</td>
                <td className="num text-right">{mmss(r.avgViewSec)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function NotConnected({ data }: { data: Extract<Analytics, { connected: false }> }) {
  const { t: tr } = useT();
  const connect = <a className="btn inline-block px-6 py-2.5 text-base" href="/api/studio/oauth/start">{tr("cf.connectYt")}</a>;
  const privacy = <p className="muted mt-2 text-xs">{tr("ss.readOnly")}</p>;
  if (data.reason === "not_connected") return (
    <div className="card mt-4 py-6 text-center">
      <p className="mb-3 text-sm">{tr("ss.connectIntro")}</p>
      {connect}{privacy}
    </div>
  );
  if (data.reason === "expired") return (
    <div className="card mt-4 py-6 text-center">
      <p className="mb-3 text-sm">{tr("ss.expired")}</p>
      <a className="btn inline-block px-6 py-2.5 text-base" href="/api/studio/oauth/start">{tr("ss.reconnect")}</a>{privacy}
    </div>
  );
  const env = data.setupEnv?.length ? data.setupEnv : null;
  return (
    <div className="card mt-4 text-sm">
      <b>{tr("ss.setup")}</b>
      <ol className="mt-2 list-decimal space-y-1 pl-5">
        <li>{tr("ss.step1")} <b>{"YouTube Analytics API"}</b> {tr("ss.and")} <b>{"YouTube Data API v3"}</b>.</li>
        <li>{tr("ss.step2a")} <b>{"External"}</b>{tr("ss.step2b")}</li>
        <li>{tr("ss.step3a")} <b>{"OAuth client ID"}</b> {tr("ss.step3b")} <b>{"Desktop app"}</b>.</li>
        <li>{tr("ss.step4")} <code>{".env.local"}</code>{env ? ":" : "."}
          {env && <pre className="mt-1 overflow-x-auto rounded bg-black/40 p-2 text-xs">{env.map((e) => `${e}=…`).join("\n")}</pre>}
        </li>
        <li>{tr("ss.step5a")} <code>{"npm run app:rebuild"}</code>{tr("ss.step5b")}</li>
      </ol>
    </div>
  );
}

export default StudioStats;
