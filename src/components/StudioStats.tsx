"use client";
import { useCallback, useEffect, useId, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent, type ReactNode } from "react";
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
        <thead><tr><th scope="col">Point</th>{series.map((s) => <th key={s.name} scope="col">{s.name}</th>)}</tr></thead>
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
function SubsChart({ daily }: { daily: Daily[] }) {
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
        <span className="flex items-center gap-1"><i className="inline-block size-2.5 rounded-sm" style={{ background: C.rose }} />Gained (up)</span>
        <span className="flex items-center gap-1"><i className="inline-block size-2.5 rounded-sm" style={{ background: C.wine }} />Lost (down)</span>
      </div>
      <div ref={ref} className="relative" style={{ height: H }} role="group" aria-label="Subscribers gained and lost per day. Use left and right arrow keys to read each day." {...handlers}>
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
            <b className="num">+{d.subsGained} gained · −{d.subsLost} lost</b>
            <span>net {d.subsGained - d.subsLost >= 0 ? "+" : "−"}{Math.abs(d.subsGained - d.subsLost)}</span>
          </Tip>
        )}
        <p className="sr-only" aria-live="polite">{d ? `${dayLabel(d.day, true)}: ${d.subsGained} gained, ${d.subsLost} lost` : ""}</p>
      </div>
      <table className="sr-only">
        <caption>Subscribers per day</caption>
        <thead><tr><th scope="col">Day</th><th scope="col">Gained</th><th scope="col">Lost</th></tr></thead>
        <tbody>{daily.map((x) => <tr key={x.day}><th scope="row">{x.day}</th><td>{x.subsGained}</td><td>{x.subsLost}</td></tr>)}</tbody>
      </table>
    </figure>
  );
}

/** Horizontal bars (HTML): label, bar scaled to the largest, value and share of the total as text. */
function HBars({ rows, label }: { rows: { label: string; value: number }[]; label: string }) {
  const total = rows.reduce((s, r) => s + (r.value || 0), 0), max = Math.max(1, ...rows.map((r) => r.value || 0));
  if (!rows.length) return <p className="muted text-xs">No data for this range.</p>;
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
  const d = few ? { dir: 0, text: "—" } : delta(cur, prev); // few views: a % change would be noise
  return (
    <div className="card !p-2.5">
      <dt className="muted text-[10px] uppercase tracking-widest">{label}</dt>
      <dd className="num text-xl font-semibold">{value}</dd>
      <dd className="num text-[11px] !text-shadow-none" style={{ color: d.dir > 0 ? C.rose : "var(--muted)" }}>
        {d.text} <span className="sr-only">{few ? "too few views to compare with" : "versus"} the previous period</span><span aria-hidden className="muted"> vs prev</span>
        {spark && <Spark values={spark} />}
      </dd>
    </div>
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
  const daily = useMemo(() => live?.daily ?? [], [live]);
  const m = METRICS.find((x) => x[0] === metric)!;
  const labels = useMemo(() => daily.map((d) => dayLabel(d.day)), [daily]);
  const tipLabels = useMemo(() => daily.map((d) => dayLabel(d.day, true)), [daily]);
  const vName = videoTitle || (videoId ? shortId(videoId) : "");

  return (
    <div className={`studio-stats glass @container h-full w-full overflow-y-auto p-3 sm:p-4 ${reduced ? "" : "panel-in"}`} role="region" aria-label="YouTube statistics" aria-busy={loading}>
      {/* header */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="hud-title studio-title truncate">STATS{live ? ` · ${live.channelTitle.toUpperCase()}` : ""}</h2>
        <div className="flex items-center gap-2">
          {live && <span className="muted text-[11px]">Updated {new Date(live.fetchedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>}
          <button className="chip" onClick={() => load(true)} disabled={loading} aria-label="Refresh statistics">{loading ? "Loading…" : "Refresh"}</button>
          {onClose && <button className="chip" onClick={onClose} aria-label="Close statistics">×</button>}
        </div>
      </div>
      {flash && (
        <p className={`mt-1 text-xs ${flash.ok ? "ok" : "error"}`} role="status">
          {flash.text} <button className="underline" onClick={() => setFlash(null)} aria-label="Dismiss message">Dismiss</button>
        </p>
      )}

      {(!data || data.connected) && ( // keep range/scope chips when a request failed, so the user can switch back
        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1">
          <div className="flex gap-1" role="group" aria-label="Date range">
            {RANGES.map(([d, l]) => <button key={d} className="chip num" aria-pressed={range === d} onClick={() => setRange(d)}>{l}</button>)}
          </div>
          <div className="flex min-w-0 gap-1" role="group" aria-label="Scope">
            <button className="chip" aria-pressed={scope === "channel"} onClick={() => setScope("channel")}>Channel</button>
            <button className="chip min-w-0 max-w-[16rem] truncate" aria-pressed={scope === "video"} disabled={!videoId} onClick={() => setScope("video")}
              title={videoTitle} aria-label={videoId ? `Selected video: ${videoTitle || videoId}` : "Video (pick a video first)"}>
              {videoId ? `Video · ${vName}` : "Video (pick one)"}
            </button>
          </div>
        </div>
      )}

      {err && (
        <div className="card mt-3 text-sm" role="alert">
          <p className="error">{err}</p>
          <button className="btn mt-2" onClick={() => load()} disabled={loading}>Try again</button>
        </div>
      )}

      {loading && !data && !err && (
        <div className="mt-3 space-y-3" aria-label="Loading statistics">
          <div className="grid grid-cols-[repeat(auto-fill,minmax(8.5rem,1fr))] gap-2">{Array.from({ length: 7 }, (_, k) => <Skeleton key={k} h={92} reduced={reduced} />)}</div>
          <Skeleton h={260} reduced={reduced} />
          <div className="grid gap-3 @2xl:grid-cols-2"><Skeleton h={200} reduced={reduced} /><Skeleton h={200} reduced={reduced} /></div>
        </div>
      )}

      {data && !data.connected && <NotConnected data={data} />}

      {live && (
        <div className="mt-3 space-y-3" style={{ opacity: loading ? 0.55 : 1, transition: reduced ? "none" : "opacity 0.2s" }}>
          <p className="muted text-xs">
            {dayLabel(live.range.start, true)} – {dayLabel(live.range.end, true)} · Data through {dayLabel(live.range.end, true)} (YouTube Analytics lags about 2 days)
          </p>

          {few && (
            <p className="card text-xs" role="note">
              <b>Collecting data.</b> Only {live.totals.views} views in this range, so changes vs the previous period are hidden until a range has {FEW_VIEWS}+ views.
              YouTube first shows each Short to a small test audience; posting regularly with your own take on each clip matters more than these numbers right now.
            </p>
          )}

          <dl className="grid grid-cols-[repeat(auto-fill,minmax(8.5rem,1fr))] gap-2">
            <Kpi few={few} label="Views" value={compact(live.totals.views)} cur={live.totals.views} prev={live.prevTotals.views} spark={daily.map((d) => d.views)} />
            <Kpi few={few} label="Watch time" value={`${compact(live.totals.watchMinutes / 60)} h`} cur={live.totals.watchMinutes} prev={live.prevTotals.watchMinutes} spark={daily.map((d) => d.watchMinutes)} />
            <Kpi few={few} label="Avg view" value={mmss(live.totals.avgViewSec)} cur={live.totals.avgViewSec} prev={live.prevTotals.avgViewSec}
              spark={daily.map((d) => (d.views > 0 ? (d.watchMinutes * 60) / d.views : 0))} />
            <Kpi few={few} label="Subscribers" value={`${live.totals.subsGained - live.totals.subsLost >= 0 ? "+" : "−"}${compact(Math.abs(live.totals.subsGained - live.totals.subsLost))}`}
              cur={live.totals.subsGained - live.totals.subsLost} prev={live.prevTotals.subsGained - live.prevTotals.subsLost} spark={daily.map((d) => d.subsGained - d.subsLost)} />
            {live.engaged && <Kpi few={few} label="Engaged views" value={compact(live.engaged.cur)} cur={live.engaged.cur} prev={live.engaged.prev} />}
            <Kpi few={few} label="Likes" value={compact(live.totals.likes)} cur={live.totals.likes} prev={live.prevTotals.likes} />
            <Kpi few={few} label="Comments" value={compact(live.totals.comments)} cur={live.totals.comments} prev={live.prevTotals.comments} />
            <Kpi few={few} label="Shares" value={compact(live.totals.shares)} cur={live.totals.shares} prev={live.prevTotals.shares} />
          </dl>

          <section className="card" aria-label="Daily trend">
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <h3 className="hud-title studio-title !text-[0.7rem]">{m[1].toUpperCase()} PER DAY</h3>
              <div className="flex gap-1" role="group" aria-label="Chart metric">
                {METRICS.map(([k, l]) => <button key={k} className="chip" aria-pressed={metric === k} onClick={() => setMetric(k)}>{l}</button>)}
              </div>
            </div>
            {daily.length ? (
              <LineChart title={`${m[1]} per day`} labels={labels} tipLabels={tipLabels}
                series={[{ name: m[1], values: daily.map(m[2]), color: C.cherry, fill: true }]} fmtY={m[3]} />
            ) : <p className="muted text-xs">No daily data for this range yet.</p>}
          </section>

          <div className="grid gap-3 @2xl:grid-cols-2">
            <Section title="Subscribers gained vs lost">
              {daily.length ? <SubsChart daily={daily} /> : <p className="muted text-xs">No data for this range.</p>}
            </Section>
            {vid ? (
              <Section title="Audience retention">
                {live.retention?.length ? (
                  <>
                    <div className="mb-1 flex gap-3 text-[11px]" aria-hidden>
                      <span className="flex items-center gap-1"><i className="inline-block h-0.5 w-4" style={{ background: C.cherry }} />Still watching</span>
                      <span className="flex items-center gap-1"><i className="inline-block h-0.5 w-4 opacity-60" style={{ background: C.blush }} />Relative to similar videos</span>
                    </div>
                    <LineChart title="Audience retention (% of viewers still watching)" height={180} max={1}
                      labels={live.retention.map((r) => `${Math.round(r.t * 100)}%`)} tipLabels={live.retention.map((r) => `${Math.round(r.t * 100)}% into the video`)}
                      series={[
                        { name: "Still watching", values: live.retention.map((r) => r.ratio), color: C.cherry, fill: true },
                        { name: "Relative", values: live.retention.map((r) => r.relative), color: C.blush, faint: true },
                      ]}
                      fmtY={(v) => `${Math.round((Number.isFinite(v) ? v : 0) * 100)}%`} />
                  </>
                ) : <p className="muted text-xs">Retention needs enough views; YouTube hides it for small videos.</p>}
              </Section>
            ) : (
              <Section title="Top videos">
                <TopVideos rows={live.topVideos ?? []} titleOf={titleOf} onPick={onPickVideo} selected={videoId} />
              </Section>
            )}
            <Section title="Traffic sources">
              <HBars label="Traffic sources" rows={live.traffic.map((t) => ({ label: t.label || t.source, value: t.views }))} />
            </Section>
            <Section title="Top countries">
              <HBars label="Top countries" rows={live.countries.map((c) => ({ label: country(c.country), value: c.views }))} />
            </Section>
          </div>

          {live.warnings.length > 0 && <p className="muted text-xs">{live.warnings.join(" · ")}</p>}
          <p className="text-right text-xs">
            <button className="muted underline" onClick={disconnect} disabled={busy}>{busy ? "Disconnecting…" : "Disconnect YouTube"}</button>
          </p>
        </div>
      )}
    </div>
  );
}

function TopVideos({ rows, titleOf, onPick, selected }: { rows: NonNullable<Live["topVideos"]>; titleOf?: (id: string) => string | undefined; onPick?: (id: string) => void; selected: string | null }) {
  if (!rows.length) return <p className="muted text-xs">No video views in this range.</p>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead className="muted text-[10px] uppercase tracking-widest">
          <tr><th scope="col" className="w-6 text-left">#</th><th scope="col" className="text-left">Video</th><th scope="col" className="text-right">Views</th><th scope="col" className="text-right">Watch h</th><th scope="col" className="text-right">Avg</th></tr>
        </thead>
        <tbody>
          {rows.slice(0, 10).map((r, k) => {
            const name = titleOf?.(r.id) || shortId(r.id);
            return (
              <tr key={r.id} className={`hud-row !table-row cursor-pointer${r.id === selected ? " on" : ""}`} onClick={() => onPick?.(r.id)}>
                <td className="num muted py-1">{k + 1}</td>
                <td className="max-w-0 truncate py-1 pr-2">
                  {onPick ? <button className="max-w-full truncate text-left hover:underline" onClick={(e) => { e.stopPropagation(); onPick(r.id); }} title={name} aria-label={`Show stats for ${name}`}>{name}</button> : name}
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
  const connect = <a className="btn inline-block px-6 py-2.5 text-base" href="/api/studio/oauth/start">Connect YouTube</a>;
  const privacy = <p className="muted mt-2 text-xs">Read-only access; the token stays on this PC.</p>;
  if (data.reason === "not_connected") return (
    <div className="card mt-4 py-6 text-center">
      <p className="mb-3 text-sm">Connect your channel to see views, watch time, subscribers, traffic and retention.</p>
      {connect}{privacy}
    </div>
  );
  if (data.reason === "expired") return (
    <div className="card mt-4 py-6 text-center">
      <p className="mb-3 text-sm">Google ended this connection (the token expired or was revoked). Test-mode Google apps expire tokens after 7 days; publishing the OAuth app avoids that.</p>
      <a className="btn inline-block px-6 py-2.5 text-base" href="/api/studio/oauth/start">Reconnect YouTube</a>{privacy}
    </div>
  );
  const env = data.setupEnv?.length ? data.setupEnv : null;
  return (
    <div className="card mt-4 text-sm">
      <b>Set up YouTube Analytics</b>
      <ol className="mt-2 list-decimal space-y-1 pl-5">
        <li>Google Cloud Console → APIs &amp; Services → enable <b>YouTube Analytics API</b> and <b>YouTube Data API v3</b>.</li>
        <li>OAuth consent screen: <b>External</b>, add yourself as a test user (or publish the app to avoid the 7-day token expiry).</li>
        <li>Credentials → Create credentials → <b>OAuth client ID</b> → application type <b>Desktop app</b>.</li>
        <li>Put the client id and secret in <code>.env.local</code>{env ? ":" : "."}
          {env && <pre className="mt-1 overflow-x-auto rounded bg-black/40 p-2 text-xs">{env.map((e) => `${e}=…`).join("\n")}</pre>}
        </li>
        <li>Run <code>npm run app:rebuild</code>, then come back and press Connect.</li>
      </ol>
    </div>
  );
}

export default StudioStats;
