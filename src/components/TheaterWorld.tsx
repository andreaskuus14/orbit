"use client";
import { WarmCompile } from "./WarmCompile";
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import * as THREE from "three";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Stars, PerformanceMonitor } from "@react-three/drei";
import { EffectComposer, Bloom, Vignette } from "@react-three/postprocessing";
import { useGlRecovery } from "./useGlRecovery";
import { FrameMark } from "./dev-timing";
import type { QualityMode } from "@/lib/quality-pure";
import { useLeanQuality } from "./useLeanQuality";
import { NAV_EVENT, type NavTarget } from "@/lib/nav-pure";
import { ago, findMode, isNew, isVideoId, length, safeThumb } from "@/lib/watch-pure";
import { candidate, clock, groundedAnswer, parseTranscript, playerError, seekTarget, embedParams, type NoteKind } from "@/lib/theater-pure";
import type { Watched } from "@/lib/theater-history-pure";
import WorkspaceFrame, { useWorkspaceView } from "./WorkspaceFrame";
import { useT } from "./i18n";
import { WATCH_CONTROL, getTranscript, positions, queueVideo, reportPlayer, restoreOpen, saveNote, sendCandidate, setTranscript, unqueue, canAutoLoad, closeWatch, findAll, findTrending, findVideos, loadMore, setSort, forgetCreator, forgetTopic, saveTopic, getSaved, getSavedServer, getWatch, pinCreator, play, replay, setWatch, subscribeSaved, subscribeWatch } from "./watch-store";

// THEATER: a dark cinema floating in space. "Show me Jynxzi's latest videos" lists the creator's 3 newest uploads here; the chosen
// one plays in the big screen through YouTube's official embed (youtube-nocookie). Standard materials only (safe for Bloom).

const fmt = new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 });
const GOLD = "#fbbf24";
const YT_ORIGIN = "https://www.youtube-nocookie.com";

function Screen({ lit, reduced }: { lit: boolean; reduced: boolean }) {
  const glow = useRef<THREE.MeshStandardMaterial>(null);
  useFrame(({ clock }) => { // a slow "projector" breathing on the frame; steady when reduced
    if (glow.current) glow.current.emissiveIntensity = (lit ? 1.4 : 0.9) + (reduced ? 0 : Math.sin(clock.elapsedTime * 0.8) * 0.15);
  });
  const W = 8, H = 4.5, T = 0.08;
  return (
    <group position={[0, 2.6, -4]}>
      <mesh>
        <planeGeometry args={[W, H]} />
        <meshStandardMaterial color="#05050a" emissive={GOLD} emissiveIntensity={lit ? 0.12 : 0.04} roughness={0.9} />
      </mesh>
      {[[0, H / 2, W + T, T], [0, -H / 2, W + T, T], [W / 2, 0, T, H + T], [-W / 2, 0, T, H + T]].map(([x, y, w, h], i) => (
        <mesh key={i} position={[x, y, 0.02]}>
          <boxGeometry args={[w, h, T]} />
          <meshStandardMaterial ref={i === 0 ? glow : undefined} color="#3a2a0a" emissive={GOLD} emissiveIntensity={1} toneMapped />
        </mesh>
      ))}
      <pointLight position={[0, 0, 2]} intensity={lit ? 18 : 8} color="#ffd28a" distance={14} />
    </group>
  );
}

/** Rows of seats curving toward the screen (one instanced mesh). */
function Seats() {
  const ref = useRef<THREE.InstancedMesh>(null);
  const spots = useMemo(() => {
    const out: [number, number, number, number][] = [];
    for (let row = 0; row < 5; row++) for (let k = -5; k <= 5; k++) {
      const a = k * 0.09, r = 6 + row * 1.1;
      out.push([Math.sin(a) * r, row * 0.25, -4 + Math.cos(a) * r, -a]);
    }
    return out;
  }, []);
  useEffect(() => {
    const m = new THREE.Object3D();
    spots.forEach(([x, y, z, ry], i) => { m.position.set(x, y, z); m.rotation.set(0, ry, 0); m.updateMatrix(); ref.current?.setMatrixAt(i, m.matrix); });
    if (ref.current) ref.current.instanceMatrix.needsUpdate = true;
  }, [spots]);
  return (
    <instancedMesh ref={ref} args={[undefined, undefined, spots.length]}>
      <boxGeometry args={[0.5, 0.55, 0.45]} />
      <meshStandardMaterial color="#4c0519" roughness={0.8} emissive="#1a0208" emissiveIntensity={0.5} />
    </instancedMesh>
  );
}

/** Shifts the scene left of the side panel on wide screens, and drifts the camera a little. */
function Rig({ reduced }: { reduced: boolean }) {
  const camera = useThree((s) => s.camera) as THREE.PerspectiveCamera;
  const size = useThree((s) => s.size);
  useEffect(() => {
    if (size.width >= 900) camera.setViewOffset(size.width, size.height, 240, 0, size.width, size.height);
    else camera.clearViewOffset();
    camera.updateProjectionMatrix();
  }, [camera, size]);
  useFrame(({ clock }) => {
    camera.position.x = reduced ? 0 : Math.sin(clock.elapsedTime * 0.1) * 0.4;
    camera.lookAt(0, 2.2, -4);
  });
  return null;
}

export default function TheaterWorld({ onClose, reduced, flat, quality = "auto" }: { onClose: () => void; reduced: boolean; flat?: boolean; quality?: QualityMode }) {
  const glr = useGlRecovery();
  const w = useSyncExternalStore(subscribeWatch, getWatch, () => null);
  const playing = w?.playing != null ? w.videos[w.playing] : null;
  const saved = useSyncExternalStore(subscribeSaved, getSaved, getSavedServer);
  const history = saved.history.filter((v) => isVideoId(v.id));
  const box = useRef<HTMLDivElement>(null);
  const frame = useRef<HTMLIFrameElement>(null);
  const [query, setQuery] = useState("");
  const findBox = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState("");
  const [adding, setAdding] = useState<string | null>(null); // the "+ Add" topic box (null = closed)
  const [modeSet, setModeSet] = useState<"creator" | "topic" | null>(null); // the Creator | Topic toggle, when the user overrides it
  const mode = modeSet ?? findMode(query, saved.topics);
  const scroller = useRef<HTMLElement>(null);
  const sentinel = useRef<HTMLDivElement>(null);
  useEffect(() => { // endless scroll: a fresh observer after each page fires at once if the end is still in view
    const el = sentinel.current;
    if (!el || !w?.next || w.more || playing) return;
    const io = new IntersectionObserver((es) => { if (es.some((e) => e.isIntersecting)) loadMore(); }, { root: scroller.current, rootMargin: "0px 0px 800px 0px" });
    io.observe(el);
    return () => io.disconnect();
  }, [w?.next, w?.more, w?.videos.length, playing]);
  const [origin, setOrigin] = useState("");
  useEffect(() => setOrigin(location.origin), []);
  const q = useLeanQuality(quality);
  const notice = (msg: string) => { const s = getWatch(); if (s) setWatch({ ...s, notice: msg }); };

  const { t } = useT();
  const views = [{ id: "continue", label: t("thr.v.continue") }, { id: "queue", label: t("thr.v.queue") }, { id: "following", label: t("thr.v.following") }, { id: "search", label: t("thr.v.search") }] as const;
  const [view, setView] = useWorkspaceView("theater", views);
  const now$ = useRef({ time: 0, duration: 0 }); // the player's last reported time (seek and notes use it)
  const [offline, setOffline] = useState(false);
  useEffect(() => { // THE07: network loss shows the same error card; coming back clears it
    const on = () => setOffline(!navigator.onLine);
    on(); addEventListener("online", on); addEventListener("offline", on);
    return () => { removeEventListener("online", on); removeEventListener("offline", on); };
  }, []);
  useEffect(() => { restoreOpen(); return () => { if (getWatch()?.playing != null) play(null, true, true); }; }, []); // THE01: reopen the left-open video paused
  useEffect(() => { // YouTube IFrame API over postMessage: play state, time and errors from the player
    const h = (e: MessageEvent) => {
      if (e.origin !== YT_ORIGIN || e.source !== frame.current?.contentWindow || typeof e.data !== "string") return;
      let m: { event?: string; info?: unknown };
      try { m = JSON.parse(e.data); } catch { return; }
      const info = m.info as { playerState?: number; currentTime?: number; duration?: number } | number | null;
      if (m.event === "onError") return reportPlayer({ error: playerError(info) });
      if (m.event === "onStateChange" && typeof info === "number") return reportPlayer({ playing: info === 1, ...(info === 2 || info === 0 ? { time: now$.current.time, duration: now$.current.duration } : {}) });
      if (m.event === "infoDelivery" && info && typeof info === "object") {
        if (typeof info.duration === "number") now$.current.duration = info.duration;
        if (typeof info.currentTime === "number") now$.current.time = info.currentTime;
        reportPlayer({ ...(typeof info.playerState === "number" ? { playing: info.playerState === 1 } : {}), ...(typeof info.currentTime === "number" ? { time: info.currentTime, duration: now$.current.duration } : {}) });
      }
    };
    addEventListener("message", h);
    return () => removeEventListener("message", h);
  }, []);
  const listen = () => frame.current?.contentWindow?.postMessage(JSON.stringify({ event: "listening", id: 1, channel: "widget" }), YT_ORIGIN);

  function fullscreen() {
    box.current?.requestFullscreen?.().catch(() => notice("The browser wants a click for full screen: press ⛶ Fullscreen."));
  }
  // Voice/typed player controls (IFrame API over postMessage: enablejsapi=1 + origin in the embed URL).
  useEffect(() => {
    const h = (e: Event) => {
      const c = (e as CustomEvent<string>).detail;
      if (c === "fullscreen") fullscreen();
      else if (c === "exitFullscreen") { if (document.fullscreenElement) void document.exitFullscreen().catch(() => {}); }
      else if (c.startsWith("seek:")) frame.current?.contentWindow?.postMessage(JSON.stringify({ event: "command", func: "seekTo", args: [seekTarget(c.slice(5), now$.current.time, now$.current.duration), true] }), YT_ORIGIN);
      else frame.current?.contentWindow?.postMessage(JSON.stringify({ event: "command", func: c, args: [] }), YT_ORIGIN);
    };
    addEventListener(WATCH_CONTROL, h);
    return () => removeEventListener(WATCH_CONTROL, h);
  }, []);
  const was = useRef<number | null>(null);
  useEffect(() => { // video closed (✕, Esc or voice): focus its card in the list, else the Find box, so the keyboard isn't lost
    const p = w?.playing ?? null;
    if (was.current !== null && p === null) (document.querySelector<HTMLElement>(`[data-watch="${was.current}"]`) ?? findBox.current)?.focus();
    was.current = p;
  }, [w?.playing]);
  useEffect(() => { // Esc: leave full screen (browser), then stop the video, then close the list. "f": toggle full screen.
    if (!w) return; // Capture + preventDefault keeps Orbit from leaving the world.
    const h = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (/^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName) || t.isContentEditable)) return;
      if (document.querySelector(".drawer:not(.drawer-out), dialog[open], [popover]:popover-open")) return; // CORE/dialog on top closes first
      if ((e.key === "f" || e.key === "F") && !e.ctrlKey && !e.metaKey && !e.altKey && !e.repeat && getWatch()?.playing != null) {
        e.preventDefault();
        if (document.fullscreenElement) void document.exitFullscreen().catch(() => {}); else fullscreen();
        return;
      }
      if (e.key !== "Escape") return;
      if (document.fullscreenElement) { e.preventDefault(); return; } // the browser exits full screen; don't also close THEATER
      e.preventDefault();
      if (getWatch()?.playing != null) play(null); else closeWatch();
    };
    addEventListener("keydown", h, true);
    return () => removeEventListener("keydown", h, true);
  }, [w]);

  async function post(what: string, url: string, body: object, ok: (json: Record<string, unknown>) => string, then?: () => void) {
    setBusy(what);
    try {
      const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || `Failed (${res.status})`);
      notice(ok(json)); then?.();
    } catch (e) { notice(e instanceof Error ? e.message : "Failed"); }
    finally { setBusy(""); }
  }
  const addCreator = () => w?.channel && post("add", "/api/studio/clips/scout/creators", { input: w.channel.id }, (j) => {
    const a = j.added as { title?: string; already?: boolean } | undefined;
    return a?.already ? `${a.title} is already a scout creator.` : `Added ${a?.title ?? w.channel!.title} to scout creators (auto-clip off).`;
  });
  // The clip factory's add-from-link path; YouTube often blocks yt-dlp, and then its pause message is shown as is.
  const clipThis = () => playing && post("clip", "/api/studio/clips/download",
    { url: `https://www.youtube.com/watch?v=${playing.id}`, permission: "Owner chose to clip this in THEATER" },
    () => "Downloading for the clip factory…",
    () => dispatchEvent(new CustomEvent<NavTarget>(NAV_EVENT, { detail: { panel: "studio", view: "clips" } })));

  const src = playing && origin && isVideoId(playing.id) ? `${YT_ORIGIN}/embed/${playing.id}?${embedParams(origin, w?.start ?? 0, !!w?.autoplay)}` : "";
  const perr = w?.playerError ?? (offline && playing ? "network" : undefined);
  const pos = positions();
  const now = Date.now();

  return (
    <div role="region" className="absolute inset-0 globe-in" aria-label="Theater: watch YouTube videos" style={{ background: "#030208" }}>
      {!flat && <Canvas key={glr.key} onCreated={glr.onCreated} frameloop={reduced || playing ? "demand" : "always"} camera={{ position: [0, 2.4, 9], fov: 50 }} dpr={[1, q.dpr]} gl={{ antialias: false }}>
        <WarmCompile world="theater" />
        {quality === "auto" && <PerformanceMonitor onDecline={q.onDecline} />}
        <color attach="background" args={["#030208"]} />
        <Stars radius={70} depth={40} count={reduced ? 600 : Math.min(2500, q.stars)} factor={2} fade speed={reduced ? 0 : 0.3} />
        <ambientLight intensity={0.25} color="#ffe7c2" />
        <mesh rotation-x={-Math.PI / 2} position={[0, -0.3, 2]}>
          <circleGeometry args={[12, 48]} />
          <meshStandardMaterial color="#0a0610" roughness={1} />
        </mesh>
        {(playing || !w) && <Screen lit={!!playing} reduced={reduced} />} {/* hidden behind the feed: its empty gold frame looked broken */}
        <Seats />
        <Rig reduced={reduced} />
        {q.bloomScale > 0 && (
          <EffectComposer multisampling={q.msaa}>
            <Bloom intensity={(reduced ? 0.3 : 0.5) * q.bloomScale} luminanceThreshold={0.7} luminanceSmoothing={0.3} mipmapBlur />
            <Vignette offset={0.3} darkness={0.7} />
          </EffectComposer>
        )}
        {process.env.NODE_ENV === "development" && <FrameMark name="theater" />}
      </Canvas>}

      {playing && (
        <section className="absolute inset-x-3 top-[4.5rem] z-[16] flex flex-col items-center min-[900px]:right-[32rem]" aria-label="Now playing">
          <div ref={box} className="w-full max-w-[min(100%,calc((100dvh-16rem)*16/9))] overflow-hidden rounded-xl bg-black shadow-[0_0_60px_#fbbf2455]" style={{ aspectRatio: "16 / 9" }}>
            {perr ? (
              <div role="alert" className="flex h-full flex-col items-center justify-center gap-2 p-4 text-center text-sm">
                <p>{t(`thr.err.${perr}`)}</p><p className="muted">{t("thr.err.keep")}</p>
                <a className="chip" href={`https://www.youtube.com/watch?v=${playing.id}`} target="_blank" rel="noreferrer">{t("thr.openOriginal")}</a>
              </div>
            ) : src && <iframe ref={frame} key={`${playing.id}:${w?.start ?? 0}`} src={src} onLoad={listen} title={`YouTube video player: ${playing.title}`} className="h-full w-full"
              allow="autoplay; encrypted-media; picture-in-picture; fullscreen" allowFullScreen referrerPolicy="strict-origin-when-cross-origin" />}
          </div>
          {!w?.autoplay && !!w?.start && !w.audible && !perr && <p className="muted mt-1 text-xs" aria-live="polite">{t("thr.paused", { t: clock(w.start) })}</p>}
          <div className="glass mt-2 flex w-full max-w-3xl flex-wrap items-center gap-2 p-2">
            <b className="mr-auto truncate text-sm" title={playing.title}>{playing.title}</b>
            <button className="chip" onClick={fullscreen} title="Full screen (press F or say “full screen”)">⛶ Fullscreen</button>
            <a className="chip" href={`https://www.youtube.com/watch?v=${playing.id}`} target="_blank" rel="noreferrer">Open on YouTube ↗</a>
            {w?.channel && <button className="chip" onClick={addCreator} disabled={!!busy}>{busy === "add" ? "Adding…" : `Add ${w.channel.title} to scout creators`}</button>}
            <button className="chip" onClick={clipThis} disabled={!!busy} title="Downloads with yt-dlp (YouTube sometimes blocks it), then opens Studio's clips">{busy === "clip" ? "Starting…" : "Clip this → Studio"}</button>
            <button className="chip" onClick={() => queueVideo(playing, w?.channel?.title)} disabled={saved.queue.some((x) => x.id === playing.id)}>{saved.queue.some((x) => x.id === playing.id) ? t("thr.queued") : t("thr.addQueue")}</button>
            <button className="chip" onClick={() => play(null)} aria-label="Close video">✕ Close</button>
          </div>
          <NotesPane v={{ ...playing, channel: playing.channel || w?.channel?.title || "", at: 0 }} time={() => now$.current.time} duration={() => now$.current.duration || playing.durationSec}
            notes={saved.notes.filter((n) => n.id === playing.id)} seek={(sec) => dispatchEvent(new CustomEvent(WATCH_CONTROL, { detail: `seek:=${sec}` }))} />
        </section>
      )}

      {/* Kept mounted while a video plays (hidden), so closing it returns to the same scroll position. */}
      <section ref={scroller} className={`absolute inset-x-3 top-[4.5rem] bottom-[calc(40dvh+9rem)] z-[13] overflow-y-auto rounded-xl pb-14 min-[900px]:bottom-3 min-[900px]:right-[32rem]${w ? " bg-[#05030b]/90 p-3 backdrop-blur-sm" : ""}${playing ? " hidden" : ""}`}
        aria-label="Browse videos">
        <ul className="flex flex-wrap items-center gap-1.5" aria-label="Categories">
          {["All", "Trending", ...saved.topics].map((t) => {
            const on = w?.topic?.toLowerCase() === t.toLowerCase(), fixed = t === "All" || t === "Trending";
            return (
              <li key={t} className="chip flex items-center gap-0.5 !py-0.5" style={on ? { borderColor: "#f59e0b", background: "#f59e0b22" } : undefined}>
                <button className="px-1 text-sm" aria-pressed={on} style={on ? { color: "#f59e0b" } : undefined}
                  onClick={() => (t === "All" ? findAll(w?.sort) : t === "Trending" ? findTrending() : findVideos({ creator: t, shorts: false, topic: true }, undefined, w?.sort))}
                  aria-label={t === "All" ? "All: newest videos from your creators" : t === "Trending" ? "Trending Gaming: most popular gaming videos now" : `${t} videos`}>
                  {t === "Trending" ? "📈 Trending Gaming" : t}</button>
                {!fixed && <button className="muted px-1" onClick={() => forgetTopic(t)} aria-label={`Remove category ${t}`} title="Remove">×</button>}
              </li>
            );
          })}
          <li>
            {adding === null ? (
              saved.topics.length < 12 && <button className="chip !py-0.5 text-sm" onClick={() => setAdding("")} aria-label="Add a category">+ Add</button>
            ) : (
              <form className="flex gap-1" onSubmit={(e) => { e.preventDefault(); const t = adding.trim(); if (t) { saveTopic(t); findVideos({ creator: t, shorts: false, topic: true }, undefined, w?.sort); } setAdding(null); }}>
                <input className="field !py-0.5 text-sm" autoFocus value={adding} maxLength={60} onChange={(e) => setAdding(e.target.value)} placeholder="Topic, e.g. Rocket League"
                  aria-label="New category" onKeyDown={(e) => { if (e.key === "Escape") { e.stopPropagation(); setAdding(null); } }} />
                <button className="chip !py-0.5 text-sm" type="submit">Add</button>
              </form>
            )}
          </li>
        </ul>
        {w && w.kind !== "trending" && (
          <div className="mt-2 flex gap-1.5" role="group" aria-label="Sort">
            {([["viral", "🔥 Viral"], ["new", "🆕 Newest"]] as const).map(([k, label]) => {
              const on = (w.sort ?? "viral") === k;
              return <button key={k} className="chip !py-0.5 text-sm" aria-pressed={on} onClick={() => setSort(k)}
                style={on ? { borderColor: "#f59e0b", background: "#f59e0b22", color: "#f59e0b" } : undefined}>{label}</button>;
            })}
          </div>
        )}
        {w?.status === "loading" && <p className="muted mt-3 text-sm">Loading…</p>}
        {w?.status === "ready" && w.videos.length > 0 && (
          <ol className="mt-3 grid gap-3" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))" }} aria-label={w.topic ? `${w.topic} videos` : "Videos"}>
            {w.videos.map((v, i) => {
              const thumb = safeThumb(v.thumb), ranked = (w.sort ?? "viral") === "viral";
              return (
                <li key={v.id}>
                  <button data-watch={i} onClick={() => play(i)}
                    aria-label={`${ranked ? `${i + 1}. ` : ""}${v.title}${v.channel ? `, ${v.channel}` : ""}${v.live ? ", live now" : ""}, ${fmt.format(v.views)} views, ${ago(v.publishedAt, now)}`}
                    className="group w-full rounded-xl border border-white/10 bg-white/[0.04] p-2 text-left transition hover:-translate-y-1 hover:border-[#f59e0b]/60 hover:shadow-[0_8px_30px_#f59e0b33] focus-visible:-translate-y-1 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#f59e0b] motion-reduce:transition-none motion-reduce:hover:translate-y-0">
                    <span className="relative block aspect-video overflow-hidden rounded-lg bg-black/60">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      {thumb && <img src={thumb} alt="" className="h-full w-full object-cover" loading="lazy" referrerPolicy="no-referrer" />}
                      {ranked && <span className="absolute left-1.5 top-1.5 rounded bg-black/75 px-1.5 text-xs font-bold">{i + 1}</span>}
                      {!v.live && isNew(v, now) && <span className="absolute right-1.5 top-1.5 rounded px-1 text-[11px] font-bold text-black" style={{ background: "#f59e0b" }}>NEW</span>}
                      {v.live ? <span className="absolute bottom-1.5 right-1.5 rounded bg-red-600 px-1 text-xs font-bold">LIVE</span>
                        : v.durationSec > 0 && <span className="absolute bottom-1.5 right-1.5 rounded bg-black/80 px-1 text-xs font-semibold">{length(v.durationSec)}</span>}
                    </span>
                    <b className="mt-2 line-clamp-2 text-sm leading-snug group-hover:text-[#fbbf24]">{v.title}</b>
                    {v.channel && <span className="muted mt-1 block truncate text-xs">{v.channel}</span>}
                    <span className="muted block text-xs">{fmt.format(v.views)} views · {ago(v.publishedAt, now)}</span>
                  </button>
                  <button className="chip mt-1 !py-0 text-xs" onClick={() => queueVideo(v, w.channel?.title)} disabled={saved.queue.some((x) => x.id === v.id)}>
                    {saved.queue.some((x) => x.id === v.id) ? t("thr.queued") : t("thr.addQueue")}</button>
                </li>
              );
            })}
          </ol>
        )}
        {w?.status === "ready" && (w.videos.length > 0 || !!w.next) && (
          <div ref={sentinel} className="mt-3 flex min-h-8 items-center justify-center text-sm" aria-live="polite">
            {w.more ? <span className="muted">Loading more…</span>
              : w.next && (!canAutoLoad(w) || !w.videos.length) ? (
                <button className="chip" onClick={() => loadMore(true)}>
                  {!w.videos.length ? "No regular videos on this page — load more?" : w.kind === "topic" ? `Load more (uses 101 of ${w.unitsLeft ?? "?"} units left today)` : "Load more"}</button>)
              : !w.next && w.kind !== "all" && <span className="muted">That&apos;s everything.</span>}
          </div>
        )}
      </section>

      <section className="glass hud-panel world-panel panel-in absolute inset-x-3 bottom-32 z-[14] max-h-[40dvh] overflow-y-auto p-3 min-[900px]:inset-x-auto min-[900px]:bottom-auto min-[900px]:right-3 min-[900px]:top-[4.5rem] min-[900px]:max-h-[calc(100dvh-11rem)] min-[900px]:w-[30rem]"
        aria-label="Theater">
        <WorkspaceFrame planet="theater" title={`THEATER${w?.channel ? ` · ${w.channel.title.toUpperCase()}` : w?.topic ? ` · ${w.topic.toUpperCase()}` : ""}`} views={views} view={view} onView={setView}>
        {view === "search" && <>
        <form className="mt-2 flex flex-wrap gap-2" onSubmit={(e) => { e.preventDefault(); const c = query.trim(); if (c) findVideos({ creator: c, shorts: false, topic: mode === "topic" }, undefined, w?.sort); }}>
          <input ref={findBox} className="field min-w-0 flex-1" value={query} onChange={(e) => { setQuery(e.target.value); setModeSet(null); }} maxLength={60}
            placeholder={mode === "topic" ? "Topic, e.g. cs2 or minecraft" : "Creator, e.g. Jynxzi or @handle"} aria-label={mode === "topic" ? "Topic to search" : "Creator name or @handle"} />
          <div className="flex shrink-0 overflow-hidden rounded-full border border-white/15" role="group" aria-label="Search for">
            {(["creator", "topic"] as const).map((m) => (
              <button key={m} type="button" className="px-2.5 text-xs" aria-pressed={mode === m} onClick={() => setModeSet(m)}
                style={mode === m ? { background: "#f59e0b", color: "#000" } : undefined}>{m === "creator" ? "Creator" : "Topic"}</button>
            ))}
          </div>
          <button className="chip shrink-0" type="submit">Find</button>
        </form>
        </>}
        {view === "following" && !saved.creators.length && <p className="muted text-sm">{t("thr.noFollow")}</p>}
        {view === "following" && saved.creators.length > 0 && (
          <ul className="mt-2 flex flex-wrap gap-1.5" aria-label="Your creators">
            {saved.creators.map((c) => (
              <li key={c.name} className="chip flex items-center gap-0.5 !px-1 !py-0.5" style={c.pinned ? { borderColor: "#f59e0b" } : undefined}>
                <button className="px-1" onClick={() => pinCreator(c.name)} aria-pressed={c.pinned} aria-label={`${c.pinned ? "Unpin" : "Pin"} ${c.name}`}
                  title={c.pinned ? "Unpin" : "Pin to the front"} style={{ color: c.pinned ? "#f59e0b" : undefined }}>{c.pinned ? "★" : "☆"}</button>
                <button className="px-1 text-sm" onClick={() => { setQuery(c.name); findVideos({ creator: c.name, shorts: false }); }} aria-label={`Find ${c.name}'s newest videos`}>{c.name}</button>
                <button className="muted px-1" onClick={() => forgetCreator(c.name)} aria-label={`Remove ${c.name}`} title="Remove">×</button>
              </li>
            ))}
          </ul>
        )}
        {view === "continue" && !history.length && <p className="muted text-sm">{t("thr.noHistory")}</p>}
        {view === "continue" && history.length > 0 && (
          <div className="mt-3">
            <div className="muted text-xs font-semibold uppercase tracking-wide">Continue watching</div>
            <ul className="mt-1 flex gap-2 overflow-x-auto pb-1" aria-label="Continue watching">
              {history.map((v) => (
                <li key={v.id} className="shrink-0">
                  <button className={`card w-[124px] p-1 text-left${playing?.id === v.id ? " on" : ""}`} onClick={() => replay(v)}
                    aria-label={`Play again: ${v.title}${v.channel ? ` by ${v.channel}` : ""}, opened ${ago(new Date(v.at).toISOString(), now)}`} title={v.title}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    {v.thumb ? <img src={v.thumb} alt="" width={116} height={65} className="rounded" loading="lazy" referrerPolicy="no-referrer" /> : <span className="block h-[65px] w-[116px] rounded bg-black/40" />}
                    <b className="mt-1 line-clamp-2 text-[11px] leading-tight">{v.title}</b>
                    <span className="muted block truncate text-[10px]">{pos[v.id] ? t("thr.resumeAt", { t: clock(pos[v.id].t) }) : v.channel}</span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
        {view === "queue" && (saved.queue.length ? (
          <ol className="space-y-1" aria-label={t("thr.v.queue")}>
            {saved.queue.map((v: Watched) => (
              <li key={v.id} className="flex items-center gap-2">
                <button className="min-w-0 flex-1 truncate text-left text-sm" onClick={() => { unqueue(v.id); replay(v); }} title={v.title}>{v.title}<span className="muted"> · {v.channel}</span></button>
                <button className="muted px-1" onClick={() => unqueue(v.id)} aria-label={t("thr.remove")}>×</button>
              </li>))}
          </ol>) : <p className="muted text-sm">{t("thr.queueEmpty")}</p>)}
        </WorkspaceFrame>
        {!w && <p className="muted mt-2 text-sm">Say “show me Jynxzi&apos;s latest videos” or “show me cs2 videos”, or pick a category. ORBIT finds them and asks which one to open.</p>}
        <div aria-live="polite">
          {w?.status === "loading" && <p className="muted mt-2 text-sm">{w.topic === "All" ? "Loading your creators’ newest videos…" : w.topic ? `Finding ${w.topic} videos…` : `Looking for ${w.creator}’s ${w.shorts ? "Shorts" : "videos"}…`}</p>}
          {w?.note && <p className="mt-2 text-sm" style={{ color: GOLD }}>{w.note}</p>}
          {w?.status === "error" && <p className="error mt-2" role="alert">{w.error}</p>}
          {w?.notice && <p className="mt-2 text-sm">{w.notice}</p>}
          {w?.status === "ready" && !w.videos.length && !w.note && <p className="muted mt-2 text-sm">No recent {w.shorts ? "Shorts" : "long videos"} {w.topic ? "about" : "from"} {w.channel?.title ?? w.creator}.</p>}
          {w?.status === "ready" && w.videos.length > 0 && w.playing === null && <p className="mt-2 text-sm">Pick a video, or say “the second one”, “number 3” or “yes” for the first.</p>}
        </div>
        {w && <button className="chip mt-3" onClick={closeWatch}>Clear</button>}
      </section>

      <button className="chip world-back absolute bottom-28 right-3 z-[15] min-[900px]:bottom-24 min-[900px]:right-[32rem]" onClick={onClose}>← Back to galaxy</button>
    </div>
  );
}

/** THE02/03/06 beside the player: a timestamped note or question → MEMORY, the owner's transcript and answers quoted from it,
 *  and a range sent to STUDIO after he reads exactly what goes. */
function NotesPane({ v, time, duration, notes, seek }: { v: Watched; time: () => number; duration: () => number; notes: { t: number; text: string; kind: NoteKind; at: number }[]; seek: (s: number) => void }) {
  const { t } = useT();
  const [text, setText] = useState(""), [kind, setKind] = useState<NoteKind>("note"), [msg, setMsg] = useState(""), [at, setAt] = useState(0);
  const [tx, setTx] = useState(() => getTranscript(v.id)), [q, setQ] = useState(""), [ans, setAns] = useState<ReturnType<typeof groundedAnswer> | null>(null);
  const [range, setRange] = useState({ from: "", to: "", why: "" }), [check, setCheck] = useState(false);
  useEffect(() => { setTx(getTranscript(v.id)); setAns(null); setMsg(""); setCheck(false); }, [v.id]);
  const secs = (s: string) => s.split(":").map(Number).reduce((a, b) => a * 60 + b, 0);
  const c = candidate(v.id, secs(range.from), secs(range.to), range.why);
  async function save() {
    try { const r = await saveNote(v, at, text, kind); if (r !== "empty") { setText(""); setMsg(t(r === "dup" ? "thr.dup" : "thr.saved")); } }
    catch (e) { setMsg(e instanceof Error ? e.message : t("common.failed")); }
  }
  async function send() {
    const r = await sendCandidate(v.id, secs(range.from), secs(range.to), range.why).catch((e: Error) => e.message);
    setMsg(r === "sent" ? t("thr.sent") : r === "already" ? t("thr.already") : r); setCheck(false);
  }
  return (
    <details className="glass mt-2 w-full max-w-3xl p-2 text-sm" onToggle={() => setAt(time())}>
      <summary className="cursor-pointer">{t("thr.pane")}</summary>
      <form className="mt-2 flex flex-wrap gap-2" onSubmit={(e) => { e.preventDefault(); void save(); }}>
        <div role="group" className="flex gap-1">{(["note", "question"] as const).map((k) => <button key={k} type="button" className="chip !py-0" aria-pressed={kind === k} onClick={() => setKind(k)}>{t(k === "note" ? "thr.note" : "thr.question")}</button>)}</div>
        <input className="field min-w-0 flex-1" value={text} maxLength={2000} onFocus={() => setAt(time())} onChange={(e) => setText(e.target.value)} placeholder={t("thr.notePh", { t: clock(at) })} aria-label={t("thr.notePh", { t: clock(at) })} />
        <button className="chip" type="submit" disabled={!text.trim()}>{t("thr.save", { t: clock(at) })}</button>
      </form>
      {notes.length > 0 && <ul className="mt-2 space-y-0.5" aria-label={t("thr.notes")}>{notes.map((n) => (
        <li key={n.at}><button className="text-left" onClick={() => seek(n.t)}><b>{clock(n.t)}</b> {n.kind === "question" ? "?" : "·"} {n.text}</button></li>))}</ul>}
      <div className="mt-3 font-semibold">{t("thr.tx")}</div>
      <p className="muted text-xs">{t("thr.txHint")}</p>
      <textarea className="field mt-1 h-20 w-full" value={tx} onChange={(e) => setTx(e.target.value)} aria-label={t("thr.tx")} />
      <button className="chip mt-1" onClick={() => setTranscript(v.id, tx)}>{t("thr.txSave")}</button>
      <form className="mt-2 flex gap-2" onSubmit={(e) => { e.preventDefault(); setAns(groundedAnswer(parseTranscript(getTranscript(v.id)), q, duration())); }}>
        <input className="field min-w-0 flex-1" value={q} onChange={(e) => setQ(e.target.value)} aria-label={t("thr.ask")} placeholder={t("thr.ask")} />
        <button className="chip" type="submit">{t("thr.askBtn")}</button>
      </form>
      {ans && <div className="mt-1" aria-live="polite">
        {ans.status === "none" ? <p>{t("thr.txNone")}</p> : <>
          {ans.status === "partial" && <p className="muted">{t("thr.txPartial", { p: Math.round(ans.covered * 100) })}</p>}
          {ans.hits.length ? <ul>{ans.hits.map((h) => <li key={h.t}><button className="text-left" onClick={() => seek(h.t)}><b>{clock(h.t)}</b> “{h.text}”</button></li>)}</ul> : <p>{t("thr.txNoHit")}</p>}
        </>}
      </div>}
      <div className="mt-3 font-semibold">{t("thr.cand")}</div>
      <div className="mt-1 flex flex-wrap gap-2">
        <input className="field w-20" value={range.from} placeholder={clock(at)} onChange={(e) => { setRange({ ...range, from: e.target.value }); setCheck(false); }} aria-label={t("thr.from")} />
        <input className="field w-20" value={range.to} placeholder={clock(at + 30)} onChange={(e) => { setRange({ ...range, to: e.target.value }); setCheck(false); }} aria-label={t("thr.to")} />
        <input className="field min-w-0 flex-1" value={range.why} maxLength={200} onChange={(e) => { setRange({ ...range, why: e.target.value }); setCheck(false); }} aria-label={t("thr.purpose")} placeholder={t("thr.purpose")} />
      </div>
      {typeof c === "string" ? (range.from || range.to || range.why) && <p className="muted mt-1 text-xs">{c}</p> : <>
        <p className="muted mt-1 text-xs">{t("thr.preview")}</p>
        <pre className="mt-1 whitespace-pre-wrap text-xs">{c.url}{"\n"}{c.permission}</pre>
        <label className="mt-1 flex items-center gap-1 text-xs"><input type="checkbox" checked={check} onChange={(e) => setCheck(e.target.checked)} /> {t("thr.confirm")}</label>
        <button className="chip mt-1" disabled={!check} onClick={() => void send()}>{t("thr.confirm")}</button>
      </>}
      {msg && <p className="mt-2" aria-live="polite">{msg}</p>}
    </details>
  );
}
