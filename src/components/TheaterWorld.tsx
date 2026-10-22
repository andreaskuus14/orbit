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
import { ago, embedUrl, findMode, isNew, isVideoId, length, safeThumb } from "@/lib/watch-pure";
import { WATCH_CONTROL, canAutoLoad, closeWatch, findAll, findTrending, findVideos, loadMore, setSort, forgetCreator, forgetTopic, saveTopic, getSaved, getSavedServer, getWatch, pinCreator, play, replay, setWatch, subscribeSaved, subscribeWatch } from "./watch-store";

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

  function fullscreen() {
    box.current?.requestFullscreen?.().catch(() => notice("The browser wants a click for full screen: press ⛶ Fullscreen."));
  }
  // Voice/typed player controls (IFrame API over postMessage: enablejsapi=1 + origin in the embed URL).
  useEffect(() => {
    const h = (e: Event) => {
      const c = (e as CustomEvent<string>).detail;
      if (c === "fullscreen") fullscreen();
      else if (c === "exitFullscreen") { if (document.fullscreenElement) void document.exitFullscreen().catch(() => {}); }
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
  useEffect(() => () => { if (getWatch()?.playing != null) play(null); }, []); // leaving THEATER stops the video
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

  const src = playing && origin ? embedUrl(playing.id, origin) : "";
  const now = Date.now();

  return (
    <div role="region" className="absolute inset-0 globe-in" aria-label="Theater: watch YouTube videos" style={{ background: "#030208" }}>
      {!flat && <Canvas key={glr.key} onCreated={glr.onCreated} frameloop={reduced || playing ? "demand" : "always"} camera={{ position: [0, 2.4, 9], fov: 50 }} dpr={[1, q.dpr]} gl={{ antialias: false }}>
        <WarmCompile />
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
            {src && <iframe ref={frame} key={playing.id} src={src} title={`YouTube video player: ${playing.title}`} className="h-full w-full"
              allow="autoplay; encrypted-media; picture-in-picture; fullscreen" allowFullScreen referrerPolicy="strict-origin-when-cross-origin" />}
          </div>
          <div className="glass mt-2 flex w-full max-w-3xl flex-wrap items-center gap-2 p-2">
            <b className="mr-auto truncate text-sm" title={playing.title}>{playing.title}</b>
            <button className="chip" onClick={fullscreen} title="Full screen (press F or say “full screen”)">⛶ Fullscreen</button>
            <a className="chip" href={`https://www.youtube.com/watch?v=${playing.id}`} target="_blank" rel="noreferrer">Open on YouTube ↗</a>
            {w?.channel && <button className="chip" onClick={addCreator} disabled={!!busy}>{busy === "add" ? "Adding…" : `Add ${w.channel.title} to scout creators`}</button>}
            <button className="chip" onClick={clipThis} disabled={!!busy} title="Downloads with yt-dlp (YouTube sometimes blocks it), then opens Studio's clips">{busy === "clip" ? "Starting…" : "Clip this → Studio"}</button>
            <button className="chip" onClick={() => play(null)} aria-label="Close video">✕ Close</button>
          </div>
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
        <div className="hud-title" style={{ color: GOLD }}>THEATER{w?.channel ? ` · ${w.channel.title.toUpperCase()}` : w?.topic ? ` · ${w.topic.toUpperCase()}` : ""}</div>
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
        {saved.creators.length > 0 && (
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
        {history.length > 0 && (
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
                    <span className="muted block truncate text-[10px]">{v.channel}</span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
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
