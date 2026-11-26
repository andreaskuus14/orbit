"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useT } from "./i18n";
import world from "world-atlas/countries-110m.json";
import { decodeCountries } from "@/lib/topo";
import { displayName, importance, type Hotspot } from "@/lib/geo";
import { dedupe } from "@/lib/dashboard";
import CountryDash, { ErrorNote, getJson, StoryCard, type Result } from "./CountryDash";
import { countryByName, findCountry } from "@/lib/countries-pure";
import { useManual } from "./planet-manual";
import EarthView from "./earth/EarthView";
import FrameMap from "./intel/FrameMap";
import IntelBar from "./intel/IntelBar";
import { OtherStories, RankList, TopStoryCard, WeatherLegend } from "./intel/IntelPanels";
import { nextSnap, parseSnap, rankRows, topStories } from "@/lib/intel-rank-pure";
import NewsWeatherLayer from "./news-weather/NewsWeatherLayer";
import { nextFrame, tabFrame, type FrameId } from "@/lib/frame-map-pure";
import { escBack, readWeather, WEATHER_KEY, type Place } from "@/lib/intel-view-pure";
import type { QualityMode } from "@/lib/quality-pure";

// INTELLIGENCE: one zoomable map, the Earth (earth/earth-scene.ts). Orbit shows today's news hotspots (and the news-weather layer when
// it is switched on), country zoom shows glowing borders and town pins with local news, close-up shows the real 3D cities. The
// IntelBar's tabs fly the camera; this file owns the tabs, the search, the country card and Esc. Data: /api/news/geo and /api/news/search.

const COUNTRIES = decodeCountries(world as never);
const INDEX = new Map(COUNTRIES.map((c, i) => [c.name, i]));

type Data = { hours: number; total: number; untagged: number; hotspots: Hotspot[] };
type Search = { q: string; results: Result[]; hotspots: Hotspot[] };
/** focus: a country or region from CORE navigation; a new object flies there with the same camera moves as a click.
 *  focus.search runs that search as if typed; "" clears search and selection (the whole world). */
export default function NewsGlobe({ reduced, focus: goTo, paused = false }: { onClose: () => void; reduced: boolean; focus?: { country?: string; region?: string; search?: string } | null; quality?: QualityMode; paused?: boolean }) {
  const { t } = useT();
  // One map, one bar. A tab flies the camera (EarthView); the news-weather layer is a switch, saved for next time.
  const [place, setPlace] = useState<Place>("orbit");
  const [shot, setShot] = useState<{ place: Place; n: number } | null>(null);
  const [wx, setWx] = useState(() => { try { return readWeather((k) => localStorage.getItem(k)); } catch { return false; } });
  const [failed, setFailed] = useState(false);
  const [brief, setBrief] = useState(false); // the spoken news-weather tour, over the map; the bar stays on top
  const noop = useCallback(() => {}, []);
  // The orbit level is the owner's frame (FrameMap); every other tab, a picked country or "Explore 3D" is the real 3D Earth.
  const [frame, setFrame] = useState<FrameId | null>("world");
  const [dive, setDive] = useState<{ lon: number; lat: number } | null>(null);
  const onTab = useCallback((id: Place) => { setFrame(tabFrame(id)); setDive(null); setPlace(id); setShot((s) => ({ place: id, n: (s?.n ?? 0) + 1 })); }, []);
  const onWeather = useCallback(() => setWx((on) => { try { localStorage.setItem(WEATHER_KEY, on ? "off" : "on"); } catch { /* this tab only */ } return !on; }), []);
  // Simple page: the globe's own search, country list and regions are tools (behind More in the INTELLIGENCE panel); the public demo has no panel, so it keeps them.
  const [chosen, setManual] = useManual("intelligence");
  const manual = chosen || (typeof location !== "undefined" && location.pathname === "/demo");
  const hours = 72;
  const [data, setData] = useState<Data | null>(null);
  const [err, setErr] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const [hover, setHover] = useState<string | null>(null); // a list row under the pointer: its country lights up on the map
  const [query, setQuery] = useState("");
  const [search, setSearch] = useState<Search | null>(null);
  const [searching, setSearching] = useState(false);
  const [liveNews, setLiveNews] = useState<{ name: string; items: Result[] | null; local?: Result[]; error?: string } | null>(null);
  // Only the latest request may update the screen (fast clicks, Clear during a search).
  const loadSeq = useRef(0);
  const searchSeq = useRef(0);
  const find = useCallback(async (q: string) => {
    const seq = ++searchSeq.current;
    setSearching(true); setErr("");
    try {
      const json = await getJson(`/api/news/search?q=${encodeURIComponent(q)}`, "Search failed");
      if (seq !== searchSeq.current) return;
      setSearch({ q, results: json.results ?? [], hotspots: json.hotspots ?? [] });
      setSelected(null);
    } catch (e2) { if (seq === searchSeq.current) setErr(e2 instanceof Error ? e2.message : "Search failed"); }
    finally { if (seq === searchSeq.current) setSearching(false); }
  }, []);
  useEffect(() => {
    if (!goTo || (!goTo.country && !goTo.region && goTo.search === undefined)) return;
    setManual(true); // CORE / a link asked for a country or a search: show the search tools
    if (goTo.search) { setQuery(goTo.search); void find(goTo.search); return; }
    searchSeq.current++; setSearching(false); setSearch(null);
    if (goTo.search === "") setQuery("");
    setSelected(goTo.country ?? null);
  }, [goTo, find]);

  const load = useCallback(async () => {
    const seq = ++loadSeq.current;
    try {
      const json = await getJson(`/api/news/geo?hours=${hours}`, "Couldn't load news");
      if (seq === loadSeq.current) { setData(json); setErr(""); }
    } catch (e) { if (seq === loadSeq.current) setErr(e instanceof Error ? e.message : "Couldn't load news"); }
  }, [hours]);
  useEffect(() => {
    if (paused) return; // kept but closed: no 5-min reads in the background; re-entry reloads at once
    void load();
    const t = setInterval(() => { if (!document.hidden) void load(); }, 5 * 60_000);
    addEventListener("orbit:news", load); // a new briefing just finished
    return () => { clearInterval(t); removeEventListener("orbit:news", load); };
  }, [load, paused]);

  // Live top headlines for the selected country (any country, even without stored stories).
  useEffect(() => {
    if (!selected) { setLiveNews(null); return; }
    let gone = false;
    setLiveNews({ name: selected, items: null });
    getJson(`/api/news/search?country=${encodeURIComponent(selected)}`, "Couldn't load headlines") // also returns its local press
      .then((j) => { if (!gone) setLiveNews({ name: selected, items: j.results ?? [], local: j.local ?? [] }); })
      .catch((e) => { if (!gone) setLiveNews({ name: selected, items: [], error: e instanceof Error ? e.message : "Couldn't load headlines" }); });
    return () => { gone = true; };
  }, [selected]);

  function runSearch(e: React.FormEvent) {
    e.preventDefault();
    const q = query.trim();
    // A country's name flies there and opens its page; 2-letter queries stay searches (findCountry reads them as ISO codes).
    const c = q.length > 2 ? findCountry(q, displayName) : null;
    if (c) { searchSeq.current++; setSearching(false); setSearch(null); setQuery(""); setSelected(c.name); return; }
    if (q.length >= 2) void find(q);
  }

  const hs = useMemo(() => (search ? search.hotspots : data?.hotspots ?? []), [search, data]);
  const stored = hs.find((h) => h.name === selected) ?? null;
  const lit = hs.find((h) => h.name === (hover ?? selected)) ?? null;
  const focusPt = useMemo(() => (lit ? { lon: lit.lon, lat: lit.lat, fly: !hover && lit.name === selected } : null), [lit, hover, selected]);
  // the panels: ranked countries (trend against a snapshot from hours ago), the top story and the next three
  const [prevCounts, setPrevCounts] = useState<Record<string, number> | null>(null);
  useEffect(() => {
    if (!data) return;
    try {
      const old = parseSnap(localStorage.getItem("orbit.intel.rank.v1")), counts = Object.fromEntries(data.hotspots.map((h) => [h.name, h.count])), keep = nextSnap(old, counts, Date.now());
      setPrevCounts(keep === old ? old!.counts : null); localStorage.setItem("orbit.intel.rank.v1", JSON.stringify(keep));
    } catch { /* no storage: no trend */ }
  }, [data]);
  // A pick on a plate: the next plate (Europe, Estonia, Tallinn, village) or, past the last one, the real 3D Earth under a dive.
  const plateSel = useRef<string | null>(null); // a country opened from a plate keeps the plate (the card opens beside it)
  const pickOn = useCallback((from: FrameId, p: { name: string; lon: number; lat: number; kind?: string }) => {
    const country = from === "world" || from === "europe", nxt = nextFrame(from, p);
    plateSel.current = country ? p.name : null; setSelected(country ? p.name : null);
    if (nxt) setFrame(nxt); else { if (!country) setShot((x) => ({ place: from === "tallinn" ? "town" : "region", n: (x?.n ?? 0) + 1 })); setDive({ lon: p.lon, lat: p.lat }); }
  }, []);
  const pick = useCallback((name: string) => { // the ranked list: same as picking the pin
    const h = hs.find((x) => x.name === name); if (!h) { setSelected(name); return; }
    if (frame === "world" || frame === "europe") pickOn(frame, { name, lon: h.lon, lat: h.lat }); else setSelected(name);
  }, [frame, hs, pickOn]);
  useEffect(() => { if (selected && frame && !dive && plateSel.current !== selected) setFrame(null); }, [selected, frame, dive]); // a country opened another way (search, CORE): the real Earth
  const rows = useMemo(() => rankRows(data?.hotspots ?? [], prevCounts, 10), [data, prevCounts]);
  const stories = useMemo(() => (data ? topStories(data.hotspots, Date.now(), 4) : []), [data]);
  const searchList = useMemo(() => (search ? dedupe(search.results).slice(0, 20) : []), [search]); // not on every hover re-render

  const selectedStories: Result[] = useMemo(() => {
    const own: Result[] = stored ? stored.stories.map((s) => ({ ...s, countries: [stored.name], live: false })) : [];
    const live = liveNews && liveNews.name === selected ? liveNews.items ?? [] : [];
    const seen = new Set(own.map((s) => s.title.toLowerCase()));
    const all = [...own, ...live.filter((s) => !seen.has(s.title.toLowerCase()))];
    return dedupe(all.sort((a, b) => (b.score ?? importance(b.title)) - (a.score ?? importance(a.title)))); // biggest stories first
  }, [stored, liveNews, selected]);

  // Esc, one step back: a country card closes; any close-up flies back to the whole Earth. From the whole Earth it falls through
  // to ORBIT's own Esc (closes the planet). Not while typing or in a dialog.
  const escRef = useRef({ selected, place, brief });
  escRef.current = { selected, place, brief };
  useEffect(() => {
    if (paused) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      const el = e.target as HTMLElement | null;
      if (el && (/^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName) || el.isContentEditable)) return;
      if (document.querySelector("dialog[open], :popover-open, [aria-modal=true], [data-news-weather][data-tour]")) return; // the tour has its own Esc
      const c = escRef.current;
      if (c.brief) { setBrief(false); } else if (c.selected) { setSelected(null); } else {
        const b = escBack(c.place);
        if (!b) return;
        onTab(b);
      }
      e.preventDefault(); e.stopImmediatePropagation();
    };
    addEventListener("keydown", onKey, true);
    return () => removeEventListener("keydown", onKey, true);
  }, [paused, onTab]);

  return (
    <div className={`absolute inset-0 globe-in earth-on intel-zoned${manual ? " intel-has-list" : ""}`} aria-label={t("ngx.aria")}>
      <div className="intel-stage" aria-hidden />
      {failed && <p role="status" className="muted pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 text-xs">{t("intel.noGl")}</p>}

      {manual && <form onSubmit={runSearch} className="earth-search" role="search">
        <input className="field w-full" value={query} onChange={(e) => setQuery(e.target.value)} maxLength={120}
          placeholder={t("ngx.searchPh")} aria-label={t("ngx.search")} />
        <button className="btn shrink-0" disabled={searching || query.trim().length < 2}>{searching ? "Searching…" : "Search"}</button>
        {search && <button type="button" className="chip shrink-0" onClick={() => { searchSeq.current++; setSearching(false); setSearch(null); setQuery(""); setSelected(null); }}>{t("ngx.clear")}</button>}
      </form>}

      {/* Simple page (INTELLIGENCE panel, not More): the map stays a calm picture; search is the tool behind More. */}
      {!selected && !search && rows.length > 0 && <RankList rows={rows} selected={selected} onHover={setHover} onPick={pick} title={t("ip.rank")} legend={wx ? <WeatherLegend title={t("ip.legend")} names={{ crisis: t("ip.lv.crisis"), rising: t("ip.lv.rising"), ongoing: t("ip.lv.ongoing"), stable: t("ip.lv.stable"), cold: t("ip.lv.cold"), warm: t("ip.lv.warm"), isobar: t("ip.lv.isobar") }} /> : undefined} />}
      {!selected && !search && stories[0] && <TopStoryCard s={stories[0]} label={t("ip.top")} more={t("ip.more")} />}
      {!selected && !search && stories.length > 1 && <OtherStories list={stories.slice(1)} title={t("ip.others")} />}

      {manual && !selected && search && <section className="earth-side panel-in" key="search">
          <div className="hud-title" style={{ color: "#e9d5ff" }}>{t("ngx.searchHead")} · {search.q.toUpperCase()}</div>
          <p className="muted text-xs">{t("ngx.searchStats", { s: search.results.length, c: search.hotspots.length })}</p>
          <ol className="mt-3 space-y-1">
            {search.hotspots.slice(0, 8).map((h) => (
              <li key={h.name}><HotRow h={h} max={search.hotspots[0]?.count || 1} on={h.name === selected} onClick={() => setSelected(h.name === selected ? null : h.name)} onHover={setHover} accent="#c084fc" /></li>
            ))}
          </ol>
          <ul className="mt-3 space-y-2">
            {searchList.map((s) => <StoryCard key={s.url} s={s} onCountry={setSelected} />)}
          </ul>
          {!search.results.length && <p className="mt-3 text-sm">{t("ngx.nothing", { q: search.q })}</p>}
        {err && <ErrorNote error={err} />}
      </section>}

      {selected && (
        <CountryDash key={selected} name={selected} id={countryByName(selected)?.id ?? COUNTRIES[INDEX.get(selected) ?? -1]?.id ?? ""} stories={selectedStories}
          local={liveNews?.name === selected ? liveNews.local : undefined}
          loading={liveNews?.name === selected && !liveNews.items} error={liveNews?.error}
          rank={stored ? { pos: hs.indexOf(stored) + 1, of: hs.length, count: stored.count } : null}
          onCountry={setSelected} onBack={() => setSelected(null)} backLabel={search ? "Results" : "All countries"} />
      )}

      {frame && <FrameMap level={frame} hotspots={hs} hover={hover} selected={selected} diveTo={dive} reduced={reduced} onPick={pickOn} onDived={() => { setFrame(null); setDive(null); }} exploreLabel={t("ip.explore")} onExplore={() => { setFrame(null); setDive(null); }} />}
      <EarthView on={!failed && (!frame || !!dive)} shot={shot} weather={wx} focus={focusPt} reduced={reduced} paused={paused || brief} onPlace={setPlace} onFail={() => setFailed(true)} />
      <NewsWeatherLayer on={brief} reduced={reduced} paused={paused} onActive={noop} />
      <IntelBar place={place} onTab={onTab} weather={wx} onWeather={onWeather} brief={brief} onBrief={() => setBrief((b) => !b)} />
    </div>
  );
}

function HotRow({ h, max, on, onClick, onHover, accent }: { h: Hotspot; max: number; on: boolean; onClick: () => void; onHover: (name: string | null) => void; accent: string }) {
  return (
    <button className={`hud-row${on ? " on" : ""}`} onClick={onClick} onMouseEnter={() => onHover(h.name)} onMouseLeave={() => onHover(null)} onFocus={() => onHover(h.name)} onBlur={() => onHover(null)} style={{ ["--accent" as string]: accent }}>
      <span className="truncate">{displayName(h.name)}</span>
      <span className="hud-bar"><i style={{ width: `${(h.count / max) * 100}%` }} /></span>
      <span className="num">{h.count}</span>
    </button>
  );
}
