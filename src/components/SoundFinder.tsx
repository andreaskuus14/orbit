"use client";
import { useEffect, useState } from "react";
import { fmtSeconds, type Sound } from "@/lib/devtools-pure";
import { useT } from "./i18n";

// DevWorld → Sound Finder: free sounds from Openverse (freesound, Jamendo, Wikimedia) with clear licences, previews and favourites.
const PINK = "#f472b6";
// The search term stays English (Openverse tags are English); only the chip label is translated.
const CHIPS = [["footsteps", "sndf.cFootsteps"], ["forest ambience", "sndf.cForest"], ["sword swing", "sndf.cSword"], ["UI click", "sndf.cClick"], ["coin pickup", "sndf.cCoin"], ["explosion", "sndf.cExplosion"], ["rain", "sndf.cRain"], ["lobby music", "sndf.cLobby"]] as const;

export default function SoundFinder() {
  const { t } = useT();
  const [q, setQ] = useState("");
  const [sounds, setSounds] = useState<Sound[] | null>(null);
  const [favs, setFavs] = useState<Sound[]>([]);
  const [tab, setTab] = useState<"search" | "favs">("search");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  useEffect(() => {
    fetch("/api/devtools?favs=1", { cache: "no-store" }).then((r) => r.json()).then((j) => Array.isArray(j.favourites) && setFavs(j.favourites)).catch(() => {});
  }, []);

  async function search(term: string) {
    const s = term.trim();
    if (!s) return;
    setQ(s); setTab("search"); setBusy(true); setErr("");
    try {
      const r = await fetch(`/api/devtools?sounds=${encodeURIComponent(s)}`, { cache: "no-store" });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || t("sndf.failedN", { n: r.status }));
      setSounds(j.sounds);
    } catch (e) { setErr(e instanceof Error ? e.message : t("sndf.failed")); } finally { setBusy(false); }
  }

  async function toggleFav(s: Sound) {
    const on = favs.some((f) => f.id === s.id);
    try {
      const r = await fetch("/api/devtools", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(on ? { action: "unfav", id: s.id } : { action: "fav", sound: s }) });
      const j = await r.json().catch(() => ({}));
      if (r.ok) { setFavs(j.favourites); setErr(""); } else setErr(j.error || t("sndf.favErr"));
    } catch { setErr(t("sndf.favReach")); }
  }

  const list = tab === "favs" ? favs : sounds;
  return (
    <section className="space-y-3" aria-labelledby="sf-title">
      <h2 id="sf-title" className="text-base font-semibold" style={{ color: PINK }}>🔊 {t("sndf.title")}</h2>
      <form className="flex gap-2" role="search" onSubmit={(e) => { e.preventDefault(); void search(q); }}>
        <label htmlFor="sf-q" className="sr-only">{t("sndf.search")}</label>
        <input id="sf-q" className="field min-w-0 flex-1" value={q} maxLength={100} placeholder={t("sndf.searchPh")} onChange={(e) => setQ(e.target.value)} />
        <button className="btn" disabled={busy || !q.trim()}>{busy ? "…" : t("sndf.go")}</button>
      </form>
      <div className="flex flex-wrap gap-1.5" aria-label={t("sndf.quick")}>
        {CHIPS.map(([c, k]) => <button key={c} type="button" className="chip" onClick={() => void search(c)}>{t(k)}</button>)}
      </div>
      <div className="flex gap-2" role="group" aria-label={t("sndf.show")}>
        <button className="chip" aria-pressed={tab === "search"} onClick={() => setTab("search")}>{t("sndf.results")}</button>
        <button className="chip" aria-pressed={tab === "favs"} onClick={() => setTab("favs")}>★ {t("sndf.favs", { n: favs.length })}</button>
      </div>
      {err && <p className="error text-sm" role="alert">{err}</p>}
      <div aria-live="polite" aria-busy={busy}>
        {busy && <p className="muted text-sm">{t("sndf.searching")}</p>}
        {!busy && list && !list.length && <p className="muted text-sm">{tab === "favs" ? t("sndf.noFavs") : t("sndf.none")}</p>}
        {!busy && !list && <p className="muted text-sm">{t("sndf.start")}</p>}
      </div>
      <ul className="space-y-2">
        {!busy && list?.map((s) => {
          const fav = favs.some((f) => f.id === s.id);
          return (
            <li key={s.id} className="card space-y-1.5">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold" title={s.title}>{s.title}</p>
                  <p className="muted text-xs">{t("sndf.by", { who: s.creator })} · {fmtSeconds(s.seconds)} · {s.source}</p>
                </div>
                <button className="chip shrink-0" aria-pressed={fav} aria-label={fav ? t("sndf.unfav", { title: s.title }) : t("sndf.fav", { title: s.title })} onClick={() => void toggleFav(s)} style={fav ? { borderColor: PINK, color: PINK } : undefined}>{fav ? "★" : "☆"}</button>
              </div>
              <p className="text-xs">
                <span className="chip" style={{ borderColor: s.licence.commercial ? "#4ade80" : "#fb923c", color: s.licence.commercial ? "#4ade80" : "#fb923c" }}>
                  {s.licence.commercial ? "✓" : "⚠"} {s.licence.label}
                </span>
                {s.licence.warn && <span className={s.licence.commercial ? "muted ml-2" : "ml-2"} style={s.licence.commercial ? undefined : { color: "#fb923c" }}>{s.licence.warn}</span>}
              </p>
              {s.audio ? <audio controls preload="none" src={s.audio} className="h-8 w-full" aria-label={t("sndf.preview", { title: s.title })} /> : <p className="muted text-xs">{t("sndf.noPreview")}</p>}
              <p className="text-xs">
                {s.page && <a href={s.page} target="_blank" rel="noopener noreferrer" className="underline" style={{ color: PINK }}>{t("sndf.source")} ↗</a>}
                {s.licenceUrl && <a href={s.licenceUrl} target="_blank" rel="noopener noreferrer" className="muted ml-3 underline">{t("sndf.licence")} ↗</a>}
              </p>
            </li>
          );
        })}
      </ul>
      <p className="card muted text-xs">
        <strong style={{ color: PINK }}>{t("sndf.useHead")}</strong> {t("sndf.use1")}{" "}
        <a href="https://create.roblox.com/dashboard/creations?activeTab=Audio" target="_blank" rel="noopener noreferrer" className="underline">Creator Hub → Audio</a>.{" "}
        {t("sndf.use2")}
      </p>
    </section>
  );
}
