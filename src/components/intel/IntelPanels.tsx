"use client";
// INTELLIGENCE over the one map: the ranked country list (left), the top-story card (right of the stage) and the other-stories
// strip (bottom). Live data only; the card's picture is a crop of our own map tiles at the story's place. Rules: lib/intel-rank-pure.ts.
import { displayName } from "@/lib/geo";
import { flagPath, miniMapTiles, type RankRow, type TopStory } from "@/lib/intel-rank-pure";
import { safeHref } from "../CountryDash";

function Flag({ name }: { name: string }) {
  const f = flagPath(name);
  // eslint-disable-next-line @next/next/no-img-element
  return f ? <img className="ip-flag" src={f} alt="" onError={(e) => { e.currentTarget.style.visibility = "hidden"; }} /> : <span className="ip-flag" />;
}

export function RankList({ rows, selected, onHover, onPick, title }: { rows: RankRow[]; selected: string | null; onHover: (n: string | null) => void; onPick: (n: string) => void; title: string }) {
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
      <p><Flag name={s.country} />{displayName(s.country)}{s.age ? ` · ${s.age}` : ""} · {s.outlets} {s.outlets === 1 ? "outlet" : "outlets"}</p>
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
              <span><b>{s.title}</b><em><Flag name={s.country} />{displayName(s.country)}{s.age ? ` · ${s.age}` : ""}</em></span>
            </a>
          ); })}
      </div>
    </section>
  );
}
