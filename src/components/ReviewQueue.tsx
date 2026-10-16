"use client";
import { useEffect, useRef, useState } from "react";
import { CAPTION_STYLES, REJECT_REASONS, mmss } from "@/lib/clips/format";
import ClipPicks from "./ClipPicks";

// Morning review: every ready clip across all jobs, one at a time, keyboard first (A approve · R reject + 1–6 · V version · T title · ←/→ · Esc).
// Uses the clip factory's routes only: GET /api/studio/clips, PATCH …/[job]/[clip], POST …/[job]/[clip]/version and …/titles. Mounted by ClipFactory.

// Mirrors src/lib/clips/types.ts (only what the review reads).
type CaptionStyle = (typeof CAPTION_STYLES)[number];
type VersionEdit = { layout: "fit" | "fill" | "split"; camSide: "left" | "right"; captions: CaptionStyle; jumpCuts: boolean; zooms: boolean };
type Clip = { id: string; start: number; end: number; title: string; hook: string; reason: string; score: number;
  status: "rendering" | "ready" | "failed" | "approved" | "rejected"; video?: string; thumb?: string; edit?: VersionEdit;
  titleOptions?: { text: string; score: number }[]; thumbOptions?: string[] };
type Job = { id: string; source: string; createdAt: string; clips: Clip[];
  options: { captions: boolean; layout?: VersionEdit["layout"]; camSide?: VersionEdit["camSide"]; jumpCuts?: boolean; zooms?: boolean } };
type Item = { job: string; source: string; base: VersionEdit; clip: Clip };
type Mode = "idle" | "reject" | "title" | "version";

const API = "/api/studio/clips";
const media = (p: string) => `${API}/media?f=${encodeURIComponent(p)}`;
const score = (s: number) => Math.round(Number.isFinite(s) ? (s <= 1 ? s * 100 : s) : 0); // same scale rule as ClipFactory
const LAYOUTS: VersionEdit["layout"][] = ["fit", "fill", "split"];

async function api<T>(url: string, method?: string, body?: unknown): Promise<T> {
  const res = await fetch(url, { method, cache: "no-store", headers: body ? { "Content-Type": "application/json" } : undefined, body: body ? JSON.stringify(body) : undefined });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error || `Request failed (${res.status})`);
  return json as T;
}

export default function ReviewQueue({ reduced, onClose }: { reduced: boolean; onClose: () => void }) {
  const [items, setItems] = useState<Item[] | null>(null);
  const [err, setErr] = useState("");
  const [i, setI] = useState(0);
  const [mode, setMode] = useState<Mode>("idle");
  const [title, setTitle] = useState("");
  const [ver, setVer] = useState<VersionEdit & { suggest: boolean }>({ layout: "fit", camSide: "right", captions: "karaoke", jumpCuts: true, zooms: true, suggest: false });
  const [busy, setBusy] = useState(false);
  const [writing, setWriting] = useState(false); // "More titles" in flight
  const [note, setNote] = useState("");
  const [said, setSaid] = useState("");
  const [muted, setMuted] = useState(true);

  // A snapshot taken on open, so decided clips stay in place for ← and the count doesn't shift under you.
  useEffect(() => {
    api<{ jobs: Job[] }>(API).then(({ jobs }) => setItems([...jobs].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).flatMap((j) => j.clips
      .filter((c) => c.status === "ready")
      .map((c) => ({ job: j.id, source: j.source, clip: c, base: c.edit ?? { layout: j.options.layout ?? "fit", camSide: j.options.camSide ?? "right",
        captions: j.options.captions ? "karaoke" : "none", jumpCuts: j.options.jumpCuts ?? true, zooms: j.options.zooms ?? true } })))),
    (e) => setErr(e instanceof Error ? e.message : "Couldn't load clips"));
  }, []);

  const n = items?.length ?? 0, cur = items && i < n ? items[i] : null, c = cur?.clip;
  const url = (it: Item) => `${API}/${encodeURIComponent(it.job)}/${encodeURIComponent(it.clip.id)}`;
  const go = (k: number) => { setI(Math.max(0, Math.min(n, k))); setMode("idle"); setNote(""); };

  async function run(fn: (it: Item, k: number) => Promise<void>) {
    if (!cur || busy) return;
    setBusy(true); setNote("");
    try { await fn(cur, i); } catch (e) { setNote(e instanceof Error ? e.message : "Something went wrong"); } finally { setBusy(false); }
  }
  // Move on only if the owner hasn't already moved while the save was in flight.
  const next = (k: number) => { setI((cur) => (cur === k ? Math.min(n, k + 1) : cur)); setMode("idle"); };
  const patch = (body: { status?: "approved" | "rejected"; title?: string; reason?: string; thumb?: string }, after: (t: string, k: number) => void) => run(async (it, k) => {
    const { clip } = await api<{ clip: Clip }>(url(it), "PATCH", body);
    setItems((xs) => xs && xs.map((x, j) => (j === k ? { ...x, clip } : x)));
    after(clip.title, k);
  });
  const approve = () => c?.status === "ready" && patch({ status: "approved" }, (t, k) => { setSaid(`Approved ✓ ${t}`); next(k); });
  const reject = (reason?: string) => patch({ status: "rejected", ...(reason ? { reason } : {}) }, (t, k) => { setSaid(`Rejected ✕ ${t}${reason ? ` (${reason})` : ""}`); next(k); });
  const saveTitle = () => { const t = title.trim(); if (!t || t === c?.title) setMode("idle"); else void patch({ title: t }, () => setMode("idle")); };
  const moreTitles = () => run(async (it, k) => {
    setWriting(true);
    try {
      const { clip } = await api<{ clip: Clip }>(`${url(it)}/titles`, "POST");
      setItems((xs) => xs && xs.map((x, j) => (j === k ? { ...x, clip } : x)));
    } finally { setWriting(false); }
  });
  const version = () => run(async (it) => {
    const { suggest, ...edit } = ver;
    await api(`${url(it)}/version`, "POST", { ...edit, start: 0, end: 0, suggest });
    setSaid("↻ Another version is rendering: it will be in your next review."); setMode("idle");
  });
  const open = (m: Mode) => {
    if (!c || c.status === "rejected") return;
    if (m === "title") setTitle(c.title);
    if (m === "version" && cur) setVer({ ...cur.base, suggest: false });
    setMode(m); setNote("");
  };

  // Window capture so StudioWorld/Orbit don't also act on these keys (StudioWorld skips Esc while .review-queue exists).
  const onKey = useRef<(e: KeyboardEvent) => void>(() => {});
  onKey.current = (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey || document.querySelector(".drawer")) return; // CORE on top owns the keyboard
    const t = e.target as HTMLElement | null;
    if (t && (/^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName) || t.isContentEditable)) { if (e.key === "Escape") { e.preventDefault(); setMode("idle"); } return; }
    if ((e.key === "Enter" || e.key === " ") && t?.closest("form, [role=group]")) return; // a focused reason chip / form button does its own thing
    const k = e.key.toLowerCase(), d = Number(e.key);
    const act =
      k === "escape" ? () => (mode !== "idle" ? setMode("idle") : onClose())
      : k === "arrowleft" ? () => go(i - 1)
      : k === "arrowright" ? () => go(i + 1)
      : !c ? null
      : mode === "reject" && d >= 1 && d <= REJECT_REASONS.length ? () => void reject(REJECT_REASONS[d - 1])
      : mode === "reject" && k === "enter" ? () => void reject()
      : k === "a" ? () => void approve()
      : k === "r" && c.status !== "rejected" ? () => setMode("reject")
      : k === "v" ? () => open("version")
      : k === "t" ? () => open("title")
      : k === "m" ? () => setMuted((m) => !m)
      : null;
    if (act) { e.preventDefault(); act(); }
  };
  useEffect(() => {
    const h = (e: KeyboardEvent) => onKey.current(e);
    addEventListener("keydown", h, true);
    return () => removeEventListener("keydown", h, true);
  }, []);

  const count = (s: Clip["status"]) => items?.filter((x) => x.clip.status === s).length ?? 0;
  const label = "muted mb-0.5 block text-[10px] uppercase tracking-widest";
  const Kbd = ({ k }: { k: string }) => <kbd className="num ml-1 rounded border border-white/20 px-1 text-[10px] opacity-70">{k}</kbd>;

  return (
    <div className={`review-queue studio-clips glass flex h-full w-full flex-col overflow-y-auto p-3 sm:p-4 ${reduced ? "" : "panel-in"}`} role="region" aria-label="Morning review" aria-busy={!items && !err}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="hud-title studio-title truncate">☀ MORNING REVIEW</h2>
        <div className="flex items-center gap-2">
          {items && n > 0 && <span className="num text-sm" aria-label={`Clip ${Math.min(i + 1, n)} of ${n}`}>{Math.min(i + 1, n)} / {n}</span>}
          <button className="chip" onClick={onClose} aria-label="Close review (Esc)">×</button>
        </div>
      </div>
      {items && n > 0 && (
        <div className="mt-2 h-1 overflow-hidden rounded-full" style={{ background: "rgba(255,214,224,0.08)" }} aria-hidden>
          <div className="h-full rounded-full" style={{ width: `${(Math.min(i, n) / n) * 100}%`, background: "linear-gradient(90deg, #800f2f, #ff2e63)", transition: reduced ? "none" : "width 0.3s" }} />
        </div>
      )}
      <p className="ok mt-1 min-h-[1.25rem] truncate text-xs" role="status" aria-live="polite">{said}</p>

      {err && <p className="error mt-3" role="alert">{err}</p>}
      {!items && !err && <p className="muted mt-3 text-sm">Loading new clips…</p>}

      {cur && c && (
        <div className="mt-2 grid flex-1 gap-4 min-[700px]:grid-cols-[auto_1fr]">
          <div className="relative mx-auto aspect-[9/16] h-[min(36rem,calc(100vh-17rem))] max-w-full overflow-hidden rounded-xl bg-black/60">
            {c.video ? (
              <video key={c.id} className="h-full w-full object-cover" src={media(c.video)} poster={c.thumb ? media(c.thumb) : undefined}
                autoPlay muted={muted} loop playsInline aria-label={`Clip: ${c.title}`} />
            ) : <div className="muted grid h-full place-items-center p-3 text-center text-sm">{c.status === "rejected" ? "✕ Rejected (files deleted)" : "No video file"}</div>}
            {c.video && (
              <button className="chip absolute bottom-2 right-2" onClick={() => setMuted((m) => !m)} aria-pressed={!muted} aria-label={muted ? "Unmute (M)" : "Mute (M)"}>
                {muted ? "🔇 Unmute" : "🔊 Mute"}
              </button>
            )}
          </div>

          <div className="flex min-w-0 flex-col gap-2 text-sm">
            <p className="muted truncate text-xs" title={cur.source}>From {cur.source}</p>
            {c.status !== "ready" && <p className={c.status === "approved" ? "ok" : "error"}>{c.status === "approved" ? "✓ Approved" : c.status === "rejected" ? "✕ Rejected" : c.status}</p>}

            {mode === "title" ? (
              <form className="flex flex-wrap gap-1" onSubmit={(e) => { e.preventDefault(); saveTitle(); }}>
                <label className="sr-only" htmlFor="review-title">Clip title</label>
                <input id="review-title" className="field min-w-0 flex-1 !px-2 !py-1" value={title} maxLength={70} autoFocus onChange={(e) => setTitle(e.target.value)} />
                <button type="submit" className="chip" disabled={busy || !title.trim()}>{busy ? "Saving…" : "Save"}</button>
                <button type="button" className="chip" onClick={() => setMode("idle")}>Cancel</button>
              </form>
            ) : (
              <div className="flex items-start gap-2">
                <b className="min-w-0 flex-1 text-lg leading-snug">{c.title}</b>
                {c.status !== "rejected" && <button className="chip shrink-0" onClick={() => open("title")} aria-label={`Edit title (T): ${c.title}`}>✎<Kbd k="T" /></button>}
              </div>
            )}
            {c.status !== "rejected" && <ClipPicks clip={c} busy={busy} big onPick={(body) => void patch(body, () => {})} onMore={() => void moreTitles()} moreBusy={writing} />}
            {c.hook && <p className="leading-snug">“{c.hook}”</p>}
            <p className="muted num text-xs">score {score(c.score)}/100 · {mmss(c.start)}–{mmss(c.end)} · {mmss(Math.max(0, c.end - c.start))}</p>
            {c.reason && <p className="muted text-xs leading-snug">Why: {c.reason}</p>}

            <div className="mt-1 flex flex-wrap gap-1.5">
              <button className="chip" onClick={() => void approve()} disabled={busy || c.status !== "ready"} aria-label={`Approve ${c.title} (A)`}>✓ Approve<Kbd k="A" /></button>
              <button className="chip" onClick={() => setMode((m) => (m === "reject" ? "idle" : "reject"))} disabled={busy || c.status === "rejected"} aria-expanded={mode === "reject"} aria-label={`Reject ${c.title} (R)`}>✕ Reject<Kbd k="R" /></button>
              <button className="chip" onClick={() => (mode === "version" ? setMode("idle") : open("version"))} disabled={busy || c.status === "rejected"} aria-expanded={mode === "version"} aria-label={`Another version of ${c.title} (V)`}>↻ Version<Kbd k="V" /></button>
              <button className="chip" onClick={() => go(i - 1)} disabled={i === 0} aria-label="Previous clip (←)">←</button>
              <button className="chip" onClick={() => go(i + 1)} aria-label="Next clip (→)">Skip →</button>
            </div>

            {mode === "reject" && (
              <div role="group" aria-label="Reject reason" className="flex flex-wrap items-center gap-1 rounded-xl border border-white/10 p-2" style={{ borderColor: "#fb7185" }}>
                <span className="muted text-[11px]">Why? (optional)</span>
                {REJECT_REASONS.map((r, k) => (
                  <button key={r} className="chip !px-2 !py-0.5 !text-[11px]" onClick={() => void reject(r)} disabled={busy} aria-label={`Reject: ${r} (${k + 1})`}>
                    <span className="num opacity-70">{k + 1}</span> {r}
                  </button>
                ))}
                <button className="chip !px-2 !py-0.5 !text-[11px]" onClick={() => void reject()} disabled={busy} aria-label="Reject without a reason (Enter)">No reason ↵</button>
              </div>
            )}

            {mode === "version" && (
              <form className="flex flex-col gap-2 rounded-xl border border-white/10 p-2 text-xs" aria-label={`Another version of ${c.title}`} onSubmit={(e) => { e.preventDefault(); void version(); }}>
                <fieldset><legend className={label}>Layout</legend>
                  <div className="flex gap-1">{LAYOUTS.map((l) => <button key={l} type="button" className="chip" aria-pressed={ver.layout === l} onClick={() => setVer((v) => ({ ...v, layout: l }))}>{l}</button>)}</div>
                </fieldset>
                <fieldset><legend className={label}>Captions</legend>
                  <div className="flex gap-1">{CAPTION_STYLES.map((s) => <button key={s} type="button" className="chip" aria-pressed={ver.captions === s} onClick={() => setVer((v) => ({ ...v, captions: s }))}>{s}</button>)}</div>
                </fieldset>
                <label className="flex items-center gap-1.5"><input type="checkbox" checked={ver.suggest} onChange={(e) => setVer((v) => ({ ...v, suggest: e.target.checked }))} /> ✨ New title &amp; hook by Claude</label>
                <p className="muted text-[11px]">Trim, facecam side and more: “Another version” in the clip list.</p>
                <div className="flex gap-1">
                  <button type="submit" className="chip" disabled={busy}>{busy ? "Starting…" : "↻ Render"}</button>
                  <button type="button" className="chip" onClick={() => setMode("idle")}>Cancel</button>
                </div>
              </form>
            )}

            {note && <p className="error text-xs" role="alert">{note}</p>}
            <p className="muted mt-auto text-[11px]">A approve · R reject, then 1–6 or Enter · V version · T title · M sound · ←/→ move · Esc close</p>
          </div>
        </div>
      )}

      {items && !cur && (
        <div className="card mx-auto mt-6 w-full max-w-md text-center">
          {n === 0 ? <p>☀ Nothing new to review. Clips show up here when a job finishes.</p> : (
            <>
              <p className="studio-title text-lg">☀ All caught up</p>
              <p className="num mt-1">{count("approved")} approved · {count("rejected")} rejected{count("ready") ? ` · ${count("ready")} skipped` : ""}</p>
            </>
          )}
          <div className="mt-3 flex flex-wrap justify-center gap-2">
            {count("approved") > 0 && <button className="btn" onClick={onClose}>Schedule all approved →</button>}
            {n > 0 && <button className="chip" onClick={() => go(n - 1)}>← Back</button>}
            <button className="chip" onClick={onClose}>Clip list</button>
          </div>
          {count("approved") > 0 && <p className="muted mt-2 text-[11px]">Each approved clip has ▶ Publish (with a schedule time) in the clip list.</p>}
        </div>
      )}
    </div>
  );
}
