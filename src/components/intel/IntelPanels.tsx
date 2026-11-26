"use client";
// INTELLIGENCE over the one map: the ranked country list (left), the top-story card (right of the stage) and the other-stories
// strip (bottom). Live data only; the card's picture is a crop of our own map tiles at the story's place. Rules: lib/intel-rank-pure.ts.
import { displayName } from "@/lib/geo";
import { flagPath, miniMapTiles, type Category, type RankRow, type TopStory } from "@/lib/intel-rank-pure";
import { LEVELS } from "@/lib/earth-layers-pure";
import { safeHref } from "../CountryDash";

function Flag({ name }: { name: string }) {
  const f = flagPath(name);
  // eslint-disable-next-line @next/next/no-img-element
  return f ? <img className="ip-flag" src={f} alt="" onError={(e) => { e.currentTarget.style.visibility = "hidden"; }} /> : <span className="ip-flag" />;
}

const ICON: Record<Category, string> = {
  conflict: "M12 3 2.5 20h19L12 3Zm0 6v5m0 3v.5", politics: "M3 9l9-5 9 5M5 10v8m4-8v8m6-8v8m4-8v8M3 20h18", economy: "M4 20V10m6 10V4m6 16v-7m4 7H3",
  climate: "M7 18a4 4 0 0 1-.5-8A6 6 0 0 1 18 9a4.5 4.5 0 0 1-.5 9H7Z", health: "M10 3h4v7h7v4h-7v7h-4v-7H3v-4h7V3Z", tech: "M7 7h10v10H7V7Zm3-4v4m4-4v4m-4 10v4m4-4v4M3 10h4m-4 4h4m10-4h4m-4 4h4",
  sport: "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Zm0 0v18M3 12h18", world: "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Zm-9 9h18M12 3c3 3 3 15 0 18M12 3c-3 3-3 15 0 18",
};
export function CategoryIcon({ c }: { c: Category }) {
  return <svg className="ip-cat" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d={ICON[c]} /></svg>;
}

/** The map's colours and lines, in the order of the frame's legend. */
export function WeatherLegend({ title, names }: { title: string; names: Record<string, string> }) {
  return (
    <div className="ip-legend" role="group" aria-label={title}>
      <div className="ip-head"><span>{title}</span></div>
      <ul>
        {LEVELS.map((l) => <li key={l.key}><i className="dot" style={{ background: l.color, boxShadow: `0 0 8px ${l.color}` }} />{names[l.key]}</li>)}
        <li><i className="line" style={{ background: "#5aa9ff" }} />{names.cold}</li>
        <li><i className="line" style={{ background: "#ff7a5c" }} />{names.warm}</li>
        <li><i className="line" style={{ background: "#dbe7f5", height: 1 }} />{names.isobar}</li>
      </ul>
    </div>
  );
}

export function RankList({ rows, selected, onHover, onPick, title, legend }: { rows: RankRow[]; selected: string | null; onHover: (n: string | null) => void; onPick: (n: string) => void; title: string; legend?: React.ReactNode }) {
  return (
    <section className="earth-side ip-rank panel-in" aria-label={title}>
      <div className="ip-head"><span>{title}</span></div>
      <ol>
        {rows.map((r, i) => (
          <li key={r.name}>
            <button type="button" className={selected === r.name ? "on" : ""} onClick={() => onPick(r.name)} onMouseEnter={() => onHover(r.name)} onMouseLeave={() => onHover(null)} onFocus={() => onHover(r.name)} onBlur={() => onHover(null)}>
              <span className="ip-n">{i + 1}</span><Flag name={r.name} /><span className="ip-name">{displayName(r.name)}</span>
              <span className="ip-bar"><i style={{ width: `${r.score}%` }} /></span>
              <b>{r.score}</b>
              <em className={r.delta > 0 ? "up" : r.delta < 0 ? "down" : ""}>{r.delta > 0 ? `▲${r.delta}` : r.delta < 0 ? `▼${-r.delta}` : "–"}</em>
            </button>
          </li>
        ))}
      </ol>
      {legend}
    </section>
  );
}

/** A crop of the world map around a place, from the app's own tiles, with a pin in the middle. */
export function MiniMap({ lat, lon, z, w, h }: { lat: number; lon: number; z: number; w: number; h: number }) {
  return (
    <span className="ip-map" style={{ width: w, height: h }} aria-hidden>
      {miniMapTiles(lon, lat, z, w, h).map((t) => (
        // eslint-disable-next-line @next/next/no-img-element
        <img key={`${t.x}/${t.y}`} src={`/api/earth/tile?k=day&z=${z}&x=${t.x}&y=${t.y}`} alt="" width={256} height={256} style={{ left: t.left, top: t.top }} draggable={false} />
      ))}
      <i />
    </span>
  );
}

export function TopStoryCard({ s, label, more }: { s: TopStory; label: string; more: string }) {
  const href = safeHref(s.url);
  return (
    <article className="ip-top panel-in" aria-label={label}>
      <div className="ip-head"><span>{label}</span><span className="ip-live"><i />LIVE</span></div>
      <MiniMap lat={s.lat} lon={s.lon} z={4} w={300} h={118} />
      <h3>{s.title}</h3>
      <p><CategoryIcon c={s.category} /><Flag name={s.country} />{displayName(s.country)}{s.age ? ` · ${s.age}` : ""} · {s.outlets} {s.outlets === 1 ? "outlet" : "outlets"}</p>
      {href && <a className="ip-more" href={href} target="_blank" rel="noopener noreferrer">{more} →</a>}
    </article>
  );
}

export function OtherStories({ list, title }: { list: TopStory[]; title: string }) {
  if (!list.length) return null;
  return (
    <section className="ip-strip panel-in" aria-label={title}>
      <div className="ip-head"><span>{title}</span></div>
      <div>
        {list.map((s) => { const href = safeHref(s.url);
          return (
            <a key={s.url || s.title} href={href ?? undefined} target="_blank" rel="noopener noreferrer">
              <MiniMap lat={s.lat} lon={s.lon} z={3} w={64} h={48} />
              <span><b>{s.title}</b><em><CategoryIcon c={s.category} /><Flag name={s.country} />{displayName(s.country)}{s.age ? ` · ${s.age}` : ""}</em></span>
            </a>
          ); })}
      </div>
    </section>
  );
}
