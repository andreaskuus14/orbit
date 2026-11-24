"use client";
// The rich parts of the INTELLIGENCE briefing: article pictures (server-fetched og:image, /api/news/thumb, with a drawn fallback),
// source icons, a place chip with a mini map, the breaking ticker and "Near you". Pure parts: lib/intel-rich-pure.ts.
import { useMemo, useState } from "react";
import land from "world-atlas/land-110m.json";
import { useT } from "./i18n";
import { ago, breaking, hueOf, initials, miniMap, nearYou, HOME, type Place } from "@/lib/intel-rich-pure";
import css from "./IntelligencePanel.module.css";

type Art = { id: string; title: string; url: string; source: string | null; published_at: string | null };
const thumb = (url: string, kind: "image" | "icon" = "image", w?: "sm" | "lead") => `/api/news/thumb?kind=${kind}${w ? `&w=${w}` : ""}&u=${encodeURIComponent(url)}`;
const safeHref = (u: string) => (/^https?:\/\//i.test(u) ? u : "#");

/** The article's picture; while loading or when there is none, a calm gradient with the source's initials. */
export function Thumb({ url, source, size, className }: { url?: string; source: string | null; size: "lead" | "sm"; className?: string }) {
  const [state, setState] = useState<"loading" | "ok" | "none">(url ? "loading" : "none");
  const h = hueOf(source ?? "?");
  return (
    <div className={`${css.thumb} ${size === "lead" ? css.thumbLead : css.thumbSm} ${className ?? ""}`} data-state={state}
      style={{ background: `linear-gradient(135deg, hsl(${h} 35% 22%), hsl(${(h + 40) % 360} 30% 12%))` }} aria-hidden="true">
      {state !== "ok" && <span className={css.thumbInit}>{initials(source)}</span>}
      {url && state !== "none" && <img src={thumb(url, "image", size)} alt="" loading={size === "lead" ? "eager" : "lazy"} decoding="async"
        onLoad={(e) => setState((e.currentTarget.naturalWidth || 0) > 8 ? "ok" : "none")} onError={() => setState("none")} />}
    </div>
  );
}

/** The outlet's icon (its favicon, fetched and cached by ORBIT), else its initials. */
export function SourceIcon({ url, source }: { url?: string; source: string | null }) {
  const [bad, setBad] = useState(!url);
  return (
    <span className={css.favicon} aria-hidden="true">
      {bad ? initials(source).slice(0, 1) : <img src={thumb(url!, "icon")} alt="" width={14} height={14} loading="lazy" onError={() => setBad(true)} />}
    </span>
  );
}

const LAND = land as unknown as Parameters<typeof miniMap>[0];
/** A small map of the land around the story's place with a dot on it. */
export function MiniMap({ place, w, h, span }: { place: Place; w: number; h: number; span?: number }) {
  const m = useMemo(() => miniMap(LAND, place.lat, place.lon, w, h, span ?? (place.city ? 10 : 26)), [place.lat, place.lon, place.city, w, h, span]);
  return (
    <svg className={css.mini} width={w} height={h} viewBox={`0 0 ${w} ${h}`} aria-hidden="true">
      <path d={m.d} className={css.miniLand} />
      <circle cx={m.x} cy={m.y} r={w > 80 ? 7 : 4.5} className={css.miniHalo} /><circle cx={m.x} cy={m.y} r={w > 80 ? 3 : 2} className={css.miniDot} />
    </svg>
  );
}

export function PlaceChip({ place }: { place: Place }) {
  const { t } = useT();
  return (
    <span className={css.place} title={t("intel.rich.place", { p: place.label })}>
      <MiniMap place={place} w={30} h={18} />
      <span>{place.label}</span>
    </span>
  );
}

/** Breaking: the freshest reports scroll by under the status line (still and scrollable without motion). */
export function Ticker({ articles }: { articles: Art[] }) {
  const { t } = useT();
  const now = Date.now();
  const { items, fresh } = useMemo(() => breaking(articles, now), [articles]); // eslint-disable-line react-hooks/exhaustive-deps -- now: per article change is enough
  if (!items.length) return null;
  const row = (dup: boolean) => items.map((a) => (
    <a key={(dup ? "d" : "") + a.id} href={safeHref(a.url)} target="_blank" rel="noreferrer noopener" className={css.tickItem} tabIndex={dup ? -1 : undefined} aria-hidden={dup || undefined}>
      <SourceIcon url={a.url} source={a.source} /><b>{a.source ?? ""}</b> {a.title}<span className={css.tickAgo}>{ago(a.published_at, now)}</span>
    </a>));
  return (
    <div className={css.ticker} role="region" aria-label={t(fresh ? "intel.rich.breaking" : "intel.rich.latest")}>
      <span className={css.tickLabel} data-fresh={fresh ? "" : undefined}>{t(fresh ? "intel.rich.breaking" : "intel.rich.latest")}</span>
      <div className={css.tickView}><div className={css.tickTrack} style={{ ["--n" as string]: items.length }}>{row(false)}{row(true)}</div></div>
    </div>
  );
}

/** "Near you": local stories (Tallinn first, then the rest of Estonia), with pictures, like the Earth view's list. */
export function NearYou({ articles }: { articles: Art[] }) {
  const { t } = useT();
  const now = Date.now();
  const list = useMemo(() => nearYou(articles, HOME, 4), [articles]);
  if (!list.length) return null;
  return (
    <section className={css.section} aria-labelledby="intel-near">
      <h3 id="intel-near" className={css.sh}><span className={css.pin} aria-hidden="true" />{t("intel.rich.near")}</h3>
      <p className={css.nearSub}>{t("intel.rich.nearSub", { city: HOME.city, country: HOME.country })}</p>
      <ul className={css.near}>
        {list.map((a, i) => (
          <li key={a.id} className={css.reveal} style={{ ["--i" as string]: i }}>
            <a href={safeHref(a.url)} target="_blank" rel="noreferrer noopener" className={css.nearItem}>
              <Thumb url={a.url} source={a.source} size="sm" />
              <span className={css.nearText}>
                <span className={css.src2}><SourceIcon url={a.url} source={a.source} />{a.source ?? t("intel.unknownSrc")}</span>
                <span className={css.nearTitle}>{a.title}</span>
                <span className={css.src2}>{ago(a.published_at, now) && t("intel.rich.ago", { t: ago(a.published_at, now)! })} · {a.place.label}</span>
              </span>
            </a>
          </li>))}
      </ul>
    </section>
  );
}
