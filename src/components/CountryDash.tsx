"use client";
import { useEffect, useId, useMemo, useState, type CSSProperties } from "react";
import world from "world-atlas/countries-110m.json";
import { COUNTRIES, displayName, importance, regionOf, type Story } from "@/lib/geo";
import { compact, linkedCountries, severity, topSources } from "@/lib/dashboard";
import { decodeCountries, unwrapRing } from "@/lib/topo";
import { countryByName } from "@/lib/countries-pure";

// Country dashboard for the news globe: real facts and World Bank series (/api/news/country)
// plus statistics computed from the country's own headlines. Pure SVG, no chart library.

export type Result = Story & { countries: string[]; live: boolean; score?: number };
type Point = { y: number; v: number };
type Stats = {
  facts: { name: string | null; iso2: string | null; capital: string | null; region: string | null; population: number | null; area: number | null; income: string | null };
  series: Partial<Record<"gdp" | "growth" | "inflation" | "unemployment" | "population", Point[]>>;
  partial?: boolean; // some World Bank calls failed: not cached, reopening asks again
};

export const safeHref = (u: string) => (/^https?:\/\//i.test(u) ? u : "#");
export const ago = (iso: string | null) => {
  if (!iso) return "";
  const m = Math.round((Date.now() - Date.parse(iso)) / 60000);
  if (!Number.isFinite(m)) return "";
  return m < 60 ? `${Math.max(1, m)} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} d ago`;
};

export const SIGNED_OUT = "signed-out";
/** GET JSON from ORBIT's API. One 401 is retried: parallel requests can race the session-cookie refresh.
 *  Still 401 → Error(SIGNED_OUT), which ErrorNote shows as a quiet sign-in link instead of a red error. */
export async function getJson(url: string, fallback: string) {
  for (let attempt = 0; ; attempt++) {
    const r = await fetch(url, { cache: "no-store" });
    if (r.status === 401 && attempt === 0) { await new Promise((ok) => setTimeout(ok, 800)); continue; }
    if (r.status === 401) throw new Error(SIGNED_OUT);
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || fallback);
    return j;
  }
}
export function ErrorNote({ error }: { error: string }) {
  return error === SIGNED_OUT
    ? <p className="muted mt-2 text-xs">Signed out · <a className="link" href="/login">Sign in</a> to load live headlines</p>
    : <p className="error mt-2">{error}</p>;
}

const statCache = new Map<string, Stats | { error: string }>();
const ACCENT: Record<string, string> = { Americas: "#fbbf24", Europe: "#4ade80", "Middle East": "#f87171", Africa: "#facc15", Asia: "#fb923c", Oceania: "#22d3ee" };
const pct1 = (v: number) => `${v.toFixed(1)}%`;
const svgPath = (xy: (readonly [number, number])[]) => xy.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(1)},${y.toFixed(1)}`).join("");
// useId output contains characters that break url(#id) references.
const useSvgId = () => useId().replace(/[^\w-]/g, "");
const isMajor = (s: Result) => (s.score ?? importance(s.title)) >= 3;

// World land as one equirectangular path (x = lon + 180, y = 90 - lat), built once from the same atlas the globe uses.
let landPath = "";
const land = () => (landPath ||= decodeCountries(world as never).flatMap((c) => c.rings)
  .map((r) => `${svgPath(unwrapRing(r).map(([lon, lat]) => [lon + 180, 90 - lat] as const))}Z`).join(""));

export default function CountryDash({ name, id, stories, local = [], loading, error, rank, onCountry, onBack, backLabel }: {
  name: string; id: string; stories: Result[]; local?: Result[]; loading: boolean; error?: string;
  rank: { pos: number; of: number; count: number } | null;
  onCountry: (n: string) => void; onBack: () => void; backLabel: string;
}) {
  const [stats, setStats] = useState<Stats | { error: string } | null>(statCache.get(id) ?? null);
  useEffect(() => {
    if (statCache.has(id)) { setStats(statCache.get(id)!); return; }
    let gone = false;
    setStats(null);
    getJson(`/api/news/country?id=${encodeURIComponent(id)}`, "Statistics unavailable")
      .then((j: Stats) => { if (!j.partial) statCache.set(id, j); if (!gone) setStats(j); }) // partial: some World Bank calls failed, ask again next time
      .catch((e) => { if (!gone) setStats({ error: e instanceof Error && e.message !== SIGNED_OUT ? e.message : "Statistics unavailable" }); });
    return () => { gone = true; };
  }, [id]);

  const linked = useMemo(() => linkedCountries(stories, name), [stories, name]);
  const week = useMemo(() => {
    const counts = new Array<number>(7).fill(0), now = Date.now();
    const inWeek = stories.filter((st) => {
      const d = Math.floor((now - Date.parse(st.published_at ?? "")) / 864e5);
      if (d >= 0 && d < 7) { counts[6 - d]++; return true; }
      return false;
    });
    return { counts, n: inWeek.length, major: severity(inWeek).major, top: topSources(inWeek, 1)[0]?.name };
  }, [stories]);
  const ok = stats && "facts" in stats ? stats : null;
  const f = ok?.facts;
  const s = ok?.series ?? {};
  const pop = s.population?.at(-1)?.v ?? f?.population ?? null;
  const year = Math.max(0, ...[s.gdp, s.growth, s.inflation, s.unemployment].map((p) => p?.at(-1)?.y ?? 0));
  const region = regionOf(name) ?? f?.region;
  const accent = ACCENT[regionOf(name) ?? ""] ?? "#67e8f9";

  return (
    <section className="glass hud-panel globe-country dash panel-in" aria-live="polite" style={{ "--accent": accent } as CSSProperties}>
      <header className="dash-head">
        <div className="min-w-0">
          <div className="dash-kicker">COUNTRY BRIEF{region ? ` · ${region.toUpperCase()}` : ""}</div>
          <h2 className="dash-name">{f?.iso2 && <img className="dash-flag" src={`https://flagcdn.com/w40/${f.iso2.toLowerCase()}.png`} alt="" width={28} height={20} />}{displayName(name)}</h2>
          <div className="dash-chips">
            {f?.capital && <span>{f.capital}</span>}
            {pop !== null && <span>{compact(pop)} people</span>}
            {rank ? <><span>#{rank.pos}/{rank.of}</span><span>{rank.count} stories</span></> : <span>not on your feeds</span>}
          </div>
        </div>
        <button className="dash-back" onClick={onBack}>← {backLabel}</button>
      </header>

      <div className="dash-grid">
        {ok ? (
          <>
            <Kpi label="GDP" pts={s.gdp} fmt={(v) => `$${compact(v)}`} rel />
            <Kpi label="GDP GROWTH" pts={s.growth} fmt={pct1} signed />
            <Kpi label="INFLATION" pts={s.inflation} fmt={pct1} invert />
            <Kpi label="UNEMPLOYMENT" pts={s.unemployment} fmt={pct1} invert />
            {year > 0 && <p className="dash-caption dash-wide">World Bank · {year}</p>}
            {ok.partial && <p className="dash-caption dash-wide">World Bank didn&apos;t answer every request · reopen the country to try again</p>}
          </>
        ) : stats && "error" in stats ? (
          <p className="dash-tile dash-wide text-xs muted">{stats.error}. News statistics below still work.</p>
        ) : (
          Array.from({ length: 4 }, (_, i) => <div key={i} className="dash-tile dash-kpi skeleton h-[5.6rem]" aria-hidden />)
        )}
      </div>

      <div className="dash-panels">
        {stories.length > 0 && (
          <div className="dash-tile">
            <div className="dash-label">TOP STORIES</div>
            <ol className="dash-top">
              {stories.slice(0, 3).map((st) => (
                <li key={st.url}>
                  {isMajor(st) && <i className="dash-major" role="img" aria-label="Major story" />}
                  <a href={safeHref(st.url)} target="_blank" rel="noreferrer noopener">{st.title}</a>
                  <span>{st.source ?? "unknown source"}{st.published_at ? ` · ${ago(st.published_at)}` : ""}</span>
                </li>
              ))}
            </ol>
          </div>
        )}

        {local.length > 0 && (
          <div className="dash-tile">
            <div className="dash-label">LOCAL <span className="muted">· {displayName(name)}&apos;s own press</span></div>
            <ol className="dash-top" lang={countryByName(name)?.lang}>
              {local.slice(0, 8).map((st) => (
                <li key={st.url}>
                  <a href={safeHref(st.url)} target="_blank" rel="noreferrer noopener">{st.title}</a>
                  <span>{st.source ?? "unknown source"}{st.published_at ? ` · ${ago(st.published_at)}` : ""}</span>
                </li>
              ))}
            </ol>
          </div>
        )}

        {ok && (s.gdp?.length || s.growth?.length) ? (
          <div className="dash-tile">
            <div className="dash-label">ECONOMY</div>
            <Economy gdp={s.gdp} growth={s.growth} />
          </div>
        ) : null}

        {linked.length > 0 && (
          <div className="dash-tile">
            <div className="dash-label">CONNECTIONS <span className="muted">· named in the same headlines</span></div>
            <LinkMap self={name} linked={linked} />
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {linked.map((x) => <button key={x.name} className="dash-link" onClick={() => onCountry(x.name)}>{displayName(x.name)} <b>{x.n}</b></button>)}
            </div>
          </div>
        )}

        {week.n > 0 && (
          <div className="dash-tile dash-cov">
            <div className="min-w-0">
              <div className="dash-label">COVERAGE <span className="muted">· last 7 days</span></div>
              <div className="dash-sub"><b>{week.n}</b> stories · <b>{week.major}</b> major{week.top ? <> · mostly {week.top}</> : null}</div>
            </div>
            <WeekBars counts={week.counts} />
          </div>
        )}
      </div>

      <div className="dash-label mt-3 px-1">MORE HEADLINES</div>
      <ul className="mt-1.5 space-y-1.5">
        {stories.slice(3, 17).map((st) => <StoryCard key={st.url} s={st} />)}
        {loading && [0, 1, 2].map((i) => <li key={i} className="card skeleton h-14" aria-hidden />)}
      </ul>
      {error && <ErrorNote error={error} />}
      {!loading && !stories.length && !local.length && error !== SIGNED_OUT && <p className="mt-2 text-sm">No recent headlines found.</p>}
      <p className="dash-foot">Data: World Bank Open Data · Natural Earth · news stats from the headlines shown</p>
    </section>
  );
}

function Kpi({ label, pts, fmt, signed = false, invert = false, rel = false }: {
  label: string; pts?: Point[]; fmt: (v: number) => string; signed?: boolean; invert?: boolean; rel?: boolean;
}) {
  const last = pts?.at(-1), prev = pts?.at(-2);
  const value = last?.v ?? null;
  // GDP changes as a relative %, rates as percentage points.
  const delta = last && prev ? (rel ? (prev.v ? ((last.v - prev.v) / Math.abs(prev.v)) * 100 : null) : last.v - prev.v) : null;
  const moved = delta !== null && Math.abs(delta) >= 0.05;
  // Up is good for GDP/growth, bad for inflation/unemployment.
  const tone = !moved ? "" : (invert ? delta! < 0 : delta! > 0) ? "good" : "bad";
  return (
    <div className="dash-tile dash-kpi">
      <div className="dash-label">{label}</div>
      <div className="dash-value">{value === null ? "—" : `${signed && value > 0 ? "+" : ""}${fmt(value)}`}</div>
      {moved && <div className={`dash-delta ${tone}`}>{delta! > 0 ? "▲" : "▼"} {delta! > 0 ? "+" : ""}{delta!.toFixed(1)}{rel ? "%" : " pp"}</div>}
      {pts && pts.length > 1 ? <Spark pts={pts} /> : <div className="dash-sub">{value === null ? "no data" : "latest figure"}</div>}
    </div>
  );
}

function Spark({ pts }: { pts: Point[] }) {
  const W = 100, H = 22;
  const vs = pts.map((p) => p.v), lo = Math.min(...vs), hi = Math.max(...vs), span = hi - lo || 1;
  const xy = pts.map((p, i) => [(i / (pts.length - 1)) * W, H - 2 - ((p.v - lo) / span) * (H - 6)] as const);
  const line = svgPath(xy);
  return (
    <svg className="spark" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" aria-hidden>
      <path d={`${line}L${W},${H}L0,${H}Z`} className="spark-area" />
      <path d={line} className="spark-line" pathLength={1} />
    </svg>
  );
}

/** GDP line with min/max on a right axis; growth % in its own band below around a zero baseline. */
function Economy({ gdp = [], growth = [] }: { gdp?: Point[]; growth?: Point[] }) {
  const uid = useSvgId();
  const years = [...new Set([...gdp, ...growth].map((p) => p.y))].sort((a, b) => a - b).slice(-15);
  if (!years.length) return <p className="dash-sub dash-empty">No World Bank data</p>;
  const L = 4, R = 256, n = years.length, T = 8, B = 62, Z = 96;
  const x = (y: number) => (n === 1 ? (L + R) / 2 : L + (years.indexOf(y) / (n - 1)) * (R - L));
  const g = gdp.filter((p) => years.includes(p.y)), gr = growth.filter((p) => years.includes(p.y));
  const vs = g.map((p) => p.v), lo = Math.min(...vs), hi = Math.max(...vs);
  const gy = (v: number) => (hi === lo ? (T + B) / 2 : B - ((v - lo) / (hi - lo)) * (B - T));
  const xy = g.map((p) => [x(p.y), gy(p.v)] as const);
  const line = svgPath(xy);
  const gm = Math.max(0.1, ...gr.map((p) => Math.abs(p.v))), bw = n > 1 ? ((R - L) / (n - 1)) * 0.45 : 6;
  const lastG = g.at(-1), lastGr = gr.at(-1);
  return (
    <>
      <div className="dash-eco-legend">
        <span><i className="sw" />GDP {lastG ? <b>${compact(lastG.v)}</b> : "n/a"}</span>
        <span><i className="sw bar" />GROWTH {lastGr ? <b className={lastGr.v >= 0 ? "good" : "bad"}>{lastGr.v > 0 ? "+" : ""}{pct1(lastGr.v)}</b> : "n/a"}</span>
      </div>
      <svg className="dash-eco" viewBox="0 0 300 128" role="img"
        aria-label={`GDP ${years[0]}–${years[n - 1]}${lastG ? `, latest $${compact(lastG.v)}` : ""}${lastGr ? `, growth ${pct1(lastGr.v)}` : ""}`}>
        <defs>
          <linearGradient id={`${uid}a`} x1="0" x2="0" y1="0" y2="1">
            <stop offset="0" className="dash-stop" stopOpacity={0.14} />
            <stop offset="1" className="dash-stop" stopOpacity={0} />
          </linearGradient>
        </defs>
        {xy.length > 0 && <>
          <line x1={L} x2={R} y1={gy(hi)} y2={gy(hi)} className="dash-eco-guide" />
          {hi !== lo && <line x1={L} x2={R} y1={gy(lo)} y2={gy(lo)} className="dash-eco-guide" />}
          <text x={R + 6} y={gy(hi) + 3} className="dash-eco-val">${compact(hi)}</text>
          {hi !== lo && <text x={R + 6} y={gy(lo) + 3} className="dash-eco-val dim">${compact(lo)}</text>}
        </>}
        {xy.length > 1 && <path d={`${line}L${xy[xy.length - 1][0]},${B}L${xy[0][0]},${B}Z`} fill={`url(#${uid}a)`} />}
        {xy.length > 1 && <path d={line} className="dash-eco-line" />}
        {xy.map(([px, py], i) => <circle key={g[i].y} cx={px} cy={py} r={i === xy.length - 1 ? 2.6 : 1.6} className="dash-eco-dot" />)}
        {gr.length > 0 && <>
          <line x1={L} x2={R} y1={Z} y2={Z} className="dash-eco-zero" />
          {gr.map((p) => {
            const h = Math.max(0.6, (Math.abs(p.v) / gm) * 15);
            return <rect key={p.y} x={x(p.y) - bw / 2} width={bw} y={p.v >= 0 ? Z - h : Z} height={h} rx={0.8} className={`dash-eco-bar ${p.v >= 0 ? "pos" : "neg"}`} />;
          })}
          <text x={R + 6} y={Z + 3} className="dash-eco-val dim">0%</text>
        </>}
        <text x={n > 1 ? L : 130} y={125} className="bars-label" textAnchor={n > 1 ? "start" : "middle"}>{years[0]}</text>
        {n > 1 && <text x={R} y={125} className="bars-label" textAnchor="end">{years[n - 1]}</text>}
      </svg>
    </>
  );
}

/** Seven slim daily bars, oldest → today. */
function WeekBars({ counts }: { counts: number[] }) {
  const max = Math.max(1, ...counts);
  return (
    <svg className="dash-week" viewBox="0 0 70 24" role="img" aria-label={`Stories per day, last 7 days: ${counts.join(", ")}`}>
      {counts.map((c, i) => { const h = Math.max(1, (c / max) * 22); return <rect key={i} x={i * 10 + 2} width={6} y={24 - h} height={h} rx={1} className={i === 6 ? "on" : ""} />; })}
    </svg>
  );
}

/** Real-land equirectangular map cropped to the home + linked countries, with soft arcs between them. */
function LinkMap({ self, linked }: { self: string; linked: { name: string; n: number }[] }) {
  const home = COUNTRIES.find((c) => c.name === self);
  const P = (c: { lat: number; lon: number }) => [c.lon + 180, 90 - c.lat] as const;
  const ends = linked.flatMap((l) => {
    const c = COUNTRIES.find((x) => x.name === l.name);
    return c ? [{ ...l, xy: P(c) }] : [];
  });
  if (!home || !ends.length) return null;
  const [hx, hy] = P(home);
  const xs = [hx, ...ends.map((e) => e.xy[0])], ys = [hy, ...ends.map((e) => e.xy[1])];
  // Crop to the points with padding at a fixed 2.4:1 aspect; fall back to the whole world when that is wider.
  const A = 2.4, pad = 14;
  let w = Math.max(Math.max(...xs) - Math.min(...xs) + pad * 2, (Math.max(...ys) - Math.min(...ys) + pad * 2) * A, 72);
  let vx = (Math.max(...xs) + Math.min(...xs)) / 2 - w / 2, vy = (Math.max(...ys) + Math.min(...ys)) / 2 - w / A / 2;
  if (w >= 360) { w = 360; vx = 0; vy = 12; }
  const h = w / A, k = w / 420; // user units per CSS pixel at the panel's ~420px width
  const max = Math.max(1, ...ends.map((l) => l.n));
  const right = vx + w * 0.72;
  return (
    <svg className="dash-map" viewBox={`${vx.toFixed(1)} ${vy.toFixed(1)} ${w.toFixed(1)} ${h.toFixed(1)}`} role="img"
      aria-label={`Map: ${displayName(self)} linked to ${ends.map((e) => displayName(e.name)).join(", ")}`}>
      <path d={land()} className="dash-map-land" />
      {ends.map(({ name, n, xy: [x, y] }) => {
        const lift = Math.hypot(x - hx, y - hy) * 0.3;
        return <path key={name} d={`M${hx},${hy}Q${(hx + x) / 2},${(hy + y) / 2 - lift} ${x},${y}`} className="dash-map-arc" style={{ opacity: 0.45 + (n / max) * 0.45 }} />;
      })}
      {ends.map(({ name, xy: [x, y] }) => (
        <g key={name}>
          <circle cx={x} cy={y} r={2.6 * k} className="dash-map-dot" />
          <text x={x + (x > right ? -5 : 5) * k} y={y + 3 * k} fontSize={9 * k} textAnchor={x > right ? "end" : "start"} className="dash-map-label">{displayName(name)}</text>
        </g>
      ))}
      <circle cx={hx} cy={hy} r={3.4 * k} className="dash-map-pulse" />
      <circle cx={hx} cy={hy} r={3.4 * k} className="dash-map-home" />
      <text x={hx + 6 * k} y={hy - 5 * k} fontSize={9 * k} className="dash-map-label home">{displayName(self)}</text>
    </svg>
  );
}

export function StoryCard({ s, onCountry, lead = false }: { s: Result; onCountry?: (n: string) => void; lead?: boolean }) {
  const score = s.score ?? importance(s.title);
  const level = score >= 3 ? "major" : score >= 2 ? "key" : "";
  return (
    <li className={`card story ${level}${lead ? " lead" : ""}`}>
      <div className="story-meta">
        {level && <span className={`badge ${level}`}>{level === "major" ? "MAJOR" : "KEY"}</span>}
        <span className="truncate">{s.source ?? "unknown source"}</span>
        {s.published_at && <span>· {ago(s.published_at)}</span>}
        {s.live && <span className="live-tag">LIVE</span>}
      </div>
      <a className="link" href={safeHref(s.url)} target="_blank" rel="noreferrer noopener">{s.title}</a>
      {onCountry && s.countries.length > 0 && (
        <div className="mt-1 flex flex-wrap gap-1">{s.countries.slice(0, 2).map((c) => <button key={c} className="tag" onClick={() => onCountry(c)}>{displayName(c)}</button>)}</div>
      )}
    </li>
  );
}
