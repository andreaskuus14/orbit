"use client";
import { useEffect, useRef, useState } from "react";
import { CAM_NAME, CAPTION_STYLES, LAYOUT_NAME, REJECT_REASONS, mmss } from "@/lib/clips/format";
import ClipPicks from "./ClipPicks";
import { useWorldPaused } from "./world-paused";
import { ScoreRing, ScoreWhy } from "./HypeScore";
import type { Virality } from "@/lib/clips/score-pure";
import { reviewQueue, startAt } from "@/lib/studio-ui-pure";
import { publishWarnings } from "@/lib/clips/publish-checks-pure";
import type { BrandKit } from "@/lib/brand-kit-pure";
import { useT } from "./i18n";

// Morning review, the ONE review queue (UI audit PR 2): every clip waiting for a decision, one at a time, keyboard first
// (A approve · R reject + 1–6 · V version · T title · ←/→ · Esc). Every "review / approve" entry point opens this: Shorts' Next card
// and Review tab, the Autopilot's "Waiting for you", Production → Review and Needs-you links. Clips the autopilot packaged also show
// its plan (title runner-ups, critics, slot, "What I added") with its own Approve & schedule, the same call its card made before.
// Routes: GET /api/studio/clips, PATCH …/[job]/[clip], POST …/version and …/titles; GET/POST /api/studio/autopilot. Mounted by ClipFactory.

// Mirrors src/lib/clips/types.ts (only what the review reads).
type CaptionStyle = (typeof CAPTION_STYLES)[number];
type VersionEdit = { layout: "fit" | "fill" | "split" | "follow"; camSide: "left" | "right" | "tl" | "tr" | "bl" | "br"; camSize?: number; captions: CaptionStyle; jumpCuts: boolean; zooms: boolean };
type Clip = { id: string; start: number; end: number; title: string; hook: string; reason: string; score: number;
  retryOf?: { videoId: string; title: string };
  status: "rendering" | "ready" | "failed" | "approved" | "rejected"; video?: string; thumb?: string; edit?: VersionEdit; brand?: string;
  titleOptions?: { text: string; score: number }[]; thumbOptions?: string[]; virality?: Virality; dub?: { lang: "en" | "et"; of: string } };
type Job = { id: string; source: string; createdAt: string; clips: Clip[];
  options: { captions: boolean; layout?: VersionEdit["layout"]; camSide?: VersionEdit["camSide"]; camSize?: number; jumpCuts?: boolean; zooms?: boolean } };
type Item = { job: string; source: string; base: VersionEdit; clip: Clip };
// Mirrors src/lib/clips/autopilot-pure.ts (what the plan box reads).
type Proposal = { title: string; titleWhy: string; description?: string; slot?: string; slotWhy: string; alts?: string[]; notes?: string[] };
type ApView = { items: { clips: { key: string; stage: string }[] }[]; proposals: Record<string, Proposal>; slots?: string[] };
const AP = "/api/studio/autopilot";
const when = (iso?: string) => (iso ? new Date(iso).toLocaleString([], { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "—");
type Mode = "idle" | "reject" | "title" | "version";

const API = "/api/studio/clips";
const media = (p: string) => `${API}/media?f=${encodeURIComponent(p)}`;
const score = (s: number) => Math.round(Number.isFinite(s) ? (s <= 1 ? s * 100 : s) : 0); // same scale rule as ClipFactory
const LAYOUTS: VersionEdit["layout"][] = ["fit", "fill", "follow", "split"];
const CAM_SIDES = Object.keys(CAM_NAME) as VersionEdit["camSide"][];

async function api<T>(url: string, method?: string, body?: unknown): Promise<T> {
  const res = await fetch(url, { method, cache: "no-store", headers: body ? { "Content-Type": "application/json" } : undefined, body: body ? JSON.stringify(body) : undefined });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error || `Request failed (${res.status})`);
  return json as T;
}

export default function ReviewQueue({ reduced, onClose, start }: { reduced: boolean; onClose: () => void; start?: string /* "job/clip" to open on */ }) {
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

  const { t: tr } = useT();
  const [kit, setKit] = useState<BrandKit | undefined>(); // brand kit: renders made with another look get a (non-blocking) warning
  const [ap, setAp] = useState<ApView | null>(null); // null: no autopilot data (not used, or it couldn't load): plain review still works
  // A snapshot taken on open, so decided clips stay in place for ← and the count doesn't shift under you. Waits for the autopilot
  // view too, so its approved-and-waiting clips are in the list from the start (studio-ui-pure reviewQueue).
  useEffect(() => {
    Promise.all([api<{ jobs: Job[] }>(API), api<ApView>(AP).catch(() => null), api<{ kit: BrandKit }>("/api/studio/brand").catch(() => null)]).then(([{ jobs }, view, brand]) => {
      setAp(view); setKit(brand?.kit);
      const waiting = new Set(view ? view.items.flatMap((x) => x.clips.filter((c) => c.stage === "waiting" && view.proposals[c.key]).map((c) => c.key)) : []);
      const list: Item[] = reviewQueue(jobs, waiting).map(({ job: j, clip: c }) => ({ job: j.id, source: j.source, clip: c, base: c.edit ?? { layout: j.options.layout ?? "fit", camSide: j.options.camSide ?? "right", camSize: j.options.camSize,
        captions: j.options.captions ? "karaoke" : "none", jumpCuts: j.options.jumpCuts ?? true, zooms: j.options.zooms ?? true } }));
      setItems(list); setI(startAt(list.map((x) => ({ job: { id: x.job }, clip: x.clip })), start));
    }, (e) => setErr(e instanceof Error ? e.message : "Couldn't load clips"));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps -- one snapshot per opening

  const n = items?.length ?? 0, cur = items && i < n ? items[i] : null, c = cur?.clip;
  const key = cur ? `${cur.job}/${cur.clip.id}` : "", plan = key ? ap?.proposals[key] : undefined;
  const added = useRef<Record<string, string>>({}); // "What I added" per clip (sent with Approve & schedule; required for other creators' clips)
  // The autopilot's own actions, unchanged: edit title/slot, title critics, approve = approved + scheduled into exactly that slot.
  const apAct = (body: Record<string, unknown>, after?: () => void) => run(async () => {
    const r = await api<Partial<ApView>>(AP, "POST", body);
    if (r && r.proposals) setAp((v) => v && { ...v, proposals: r.proposals!, slots: r.slots ?? v.slots });
    else await api<ApView>(AP).then((v) => setAp((x) => x && { ...x, proposals: v.proposals, slots: v.slots ?? x.slots }), () => {});
    after?.();
  });
  const approvePlan = () => { const k = i, original = added.current[key]?.trim();
    void apAct({ action: "approve", key, ...(original ? { original } : {}) }, () => {
      setItems((xs) => xs && xs.map((x, j) => (j === k ? { ...x, clip: { ...x.clip, status: "approved" } } : x)));
      setSaid("✅ Approved: uploading as private, YouTube publishes it at the slot"); next(k);
    }); };
  const url = (it: Item) => `${API}/${encodeURIComponent(it.job)}/${encodeURIComponent(it.clip.id)}`;
  const go = (k: number) => { setI(Math.max(0, Math.min(n, k))); setMode("idle"); setNote(""); };

  async function run(fn: (it: Item, k: number) => Promise<void>) {
    if (!cur || busy) return;
    setBusy(true); setNote("");
    try { await fn(cur, i); } catch (e) { setNote(e instanceof Error ? e.message : "Something went wrong"); } finally { setBusy(false); }
  }
  // Move on only if the owner hasn't already moved while the save was in flight.
  const next = (k: number) => { setI((cur) => (cur === k ? Math.min(n, k + 1) : cur)); setMode("idle"); };
  const patch = (body: { status?: "approved" | "rejected"; title?: string; reason?: string; thumb?: string; replaceOriginal?: string }, after: (t: string, k: number) => void) => run(async (it, k) => {
    const { clip } = await api<{ clip: Clip }>(url(it), "PATCH", body);
    setItems((xs) => xs && xs.map((x, j) => (j === k ? { ...x, clip } : x)));
    after(clip.title, k);
  });
  const approve = () => c?.status === "ready" && patch({ status: "approved", ...(c.retryOf && { replaceOriginal: c.retryOf.videoId }) }, (t, k) => { setSaid(`Approved ✓ ${t}`); next(k); });
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
  // Bilingual dub (dub-pure.ts): the approved Short in the other language, in his own voice. It comes back here as a new version.
  const dub = () => run(async (it) => {
    const { clip } = await api<{ clip: Clip }>(`${url(it)}/dub`, "POST");
    setSaid(tr("dub.started", { lang: tr(clip.dub?.lang === "et" ? "dub.et" : "dub.en") }));
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
    if (e.ctrlKey || e.metaKey || e.altKey || document.querySelector(".drawer:not(.drawer-out), dialog[open]")) return; // CORE on top owns the keyboard
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
  const paused = useWorldPaused();
  useEffect(() => {
    if (paused) return; // STUDIO kept but hidden: its keys (A, R, arrows…) must not fire elsewhere
    const h = (e: KeyboardEvent) => onKey.current(e);
    addEventListener("keydown", h, true);
    return () => removeEventListener("keydown", h, true);
  }, [paused]);

  const count = (s: Clip["status"]) => items?.filter((x) => x.clip.status === s).length ?? 0;
  const label = "muted mb-0.5 block text-[12px] font-medium";
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
      {!items && !err && <div className="mt-3 grid flex-1 gap-4 min-[700px]:grid-cols-[auto_1fr]" role="status" aria-label="Loading new clips"><span className="sr-only">Loading new clips…</span><div aria-hidden className={`mx-auto aspect-[9/16] h-[min(36rem,calc(100vh-17rem))] max-w-full rounded-xl bg-white/5 ${reduced ? "" : "animate-pulse"}`} /><div aria-hidden className="space-y-2">{[60, 24, 24, 40].map((h, k) => <div key={k} className={`rounded-lg bg-white/5 ${reduced ? "" : "animate-pulse"}`} style={{ height: h }} />)}</div></div>}

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
            {c.retryOf && <p className="text-xs">Retry of {c.retryOf.title}. Approving allows the old Short to become private after this retry is published publicly. You can restore it from Last Shorts.</p>}
            {c.status !== "ready" && !plan && <p className={c.status === "approved" ? "ok" : "error"}>{c.status === "approved" ? "✓ Approved" : c.status === "rejected" ? "✕ Rejected" : c.status}</p>}

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
            {c.dub && <p className="muted text-xs" role="note">{tr("dub.note", { lang: tr(c.dub.lang === "et" ? "dub.et" : "dub.en") })}</p>}
            {c.virality && <div className="flex items-start gap-3 rounded-xl border border-white/10 p-2"><ScoreRing key={c.id} v={c.virality} reduced={reduced} size={56} /><div className="min-w-0 flex-1"><ScoreWhy key={c.id} v={c.virality} open /></div></div>}
            <p className="muted num text-xs">{c.virality ? "editor" : "score"} {score(c.score)}/100 · {mmss(c.start)}–{mmss(c.end)} · {mmss(Math.max(0, c.end - c.start))}</p>
            {c.reason && <p className="muted text-xs leading-snug">Why: {c.reason}</p>}
            {(() => { const w = publishWarnings(c, kit); return w.length > 0 && <div className="rounded-lg border border-white/10 p-2 text-xs" role="note"><b>{tr("sp.warnings")}</b>
              <ul className="list-disc pl-4">{w.map((x) => <li key={x}>{x}</li>)}</ul></div>; })()}

            {plan && <PlanBox key={key} p={plan} slots={ap?.slots ?? []} busy={busy} approved={c.status === "approved"} added={added.current[key] ?? ""} onAdded={(t) => { added.current[key] = t; }}
              onTitle={(title) => void apAct({ action: "edit", key, title })} onSlot={(slot) => void apAct({ action: "edit", key, slot })}
              onCritics={() => void apAct({ action: "review", key })} onApprove={approvePlan} />}
            <div className="mt-1 flex flex-wrap gap-1.5">
              <button className="chip" onClick={() => void approve()} disabled={busy || c.status !== "ready"} aria-label={`Approve ${c.title}${c.retryOf ? " and replace original after publication" : ""} (A)`}>✓ {c.retryOf ? "Approve & replace after publication" : "Approve"}<Kbd k="A" /></button>
              <button className="chip" onClick={() => setMode((m) => (m === "reject" ? "idle" : "reject"))} disabled={busy || c.status === "rejected"} aria-expanded={mode === "reject"} aria-label={`Reject ${c.title} (R)`}>✕ Reject<Kbd k="R" /></button>
              {c.status === "approved" && !c.dub && <button className="chip" onClick={() => void dub()} disabled={busy} title={tr("dub.why")}>🌐 {tr("dub.button")}</button>}
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
                  <div className="flex flex-wrap gap-1">{LAYOUTS.map((l) => <button key={l} type="button" className="chip" aria-pressed={ver.layout === l} onClick={() => setVer((v) => ({ ...v, layout: l }))}>{LAYOUT_NAME[l]}</button>)}</div>
                </fieldset>
                {ver.layout === "split" && (
                  <fieldset><legend className={label}>Facecam</legend>
                    <div className="flex flex-wrap gap-1">{CAM_SIDES.map((k) => <button key={k} type="button" className="chip" aria-pressed={ver.camSide === k} onClick={() => setVer((v) => ({ ...v, camSide: k }))}>{CAM_NAME[k]}</button>)}</div>
                  </fieldset>
                )}
                <fieldset><legend className={label}>Captions</legend>
                  <div className="flex flex-wrap gap-1">{CAPTION_STYLES.map((s) => <button key={s} type="button" className="chip" aria-pressed={ver.captions === s} onClick={() => setVer((v) => ({ ...v, captions: s }))}>{s}</button>)}</div>
                </fieldset>
                <label className="flex items-center gap-1.5"><input type="checkbox" checked={ver.suggest} onChange={(e) => setVer((v) => ({ ...v, suggest: e.target.checked }))} /> ✨ New title &amp; hook by Claude</label>
                <p className="muted text-[11px]">Trim, cam box size and more: “Another version” in the clip list.</p>
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

/** The autopilot's plan for a clip it packaged (was the Autopilot tab's waiting card): its title and runner-ups, the title critics,
 *  the slot, "What I added", and Approve & schedule (approved + uploaded as private for exactly that slot; the owner's click). */
function PlanBox({ p, slots, busy, approved, added, onAdded, onTitle, onSlot, onCritics, onApprove }: {
  p: Proposal; slots: string[]; busy: boolean; approved: boolean; added: string; onAdded: (t: string) => void;
  onTitle: (t: string) => void; onSlot: (s: string) => void; onCritics: () => void; onApprove: () => void;
}) {
  const { t: tr } = useT();
  const [text, setText] = useState(added);
  return (
    <section className="space-y-2 rounded-xl border border-[#ff8fab]/30 bg-[#ff2e63]/5 p-2 text-xs" aria-label={tr("rq.plan")}>
      <b className="block text-[12px] font-medium">🤖 {tr("rq.plan")}</b>
      {approved && <p className="ok">{tr("rq.planOnly")}</p>}
      <div><p className="font-semibold">{p.title}</p><p className="muted">{p.titleWhy}</p></div>
      {!!p.alts?.length && <div className="flex flex-wrap items-center gap-1" role="group" aria-label={tr("ap.runnerUps")}>
        <span className="muted">{tr("ap.swap")}</span>
        {p.alts.map((x) => <button key={x} className="chip !px-2 !py-0.5 text-left !text-[11px]" disabled={busy} onClick={() => onTitle(x)} aria-label={tr("ap.useTitle", { t: x })}>↔ {x}</button>)}
      </div>}
      {p.notes?.length ? <ul className="space-y-0.5" aria-label={tr("ap.critics")}>{p.notes.map((x, k) => <li key={k}><span aria-hidden>🧐 </span>{x}</li>)}</ul>
        : <button className="chip !px-2 !py-0.5" disabled={busy} onClick={onCritics}>{busy ? tr("ap.criticsReading") : `🧐 ${tr("ap.reviewTitles")}`}</button>}
      <label className="flex flex-wrap items-center gap-1.5"><span className="muted">{tr("ap.slot")}</span>
        <select className="chip" value={p.slot ?? ""} disabled={busy} onChange={(e) => onSlot(e.target.value)}>
          {!p.slot && <option value="">{tr("ap.noneFree")}</option>}
          {p.slot && <option value={p.slot}>{when(p.slot)}</option>}
          {slots.filter((x) => x !== p.slot).map((x) => <option key={x} value={x}>{when(x)}</option>)}
        </select>
        <span className="muted">{p.slotWhy}</span>
      </label>
      {p.description && <details><summary className="muted cursor-pointer">{tr("cf.description")}</summary><p className="mt-1 whitespace-pre-line">{p.description}</p></details>}
      <label className="block"><span className="muted">{tr("ap.whatAdded")}</span>
        <input className="field mt-0.5 w-full !px-2 !py-1" value={text} maxLength={200} disabled={busy} placeholder={tr("ap.whatAddedPh")}
          onChange={(e) => { setText(e.target.value); onAdded(e.target.value); }} />
        <span className="muted text-[11px]">{tr("ap.ownLayer")}</span>
      </label>
      <button className="btn !px-4 !py-1.5" disabled={busy || !p.slot} onClick={onApprove}>{busy ? tr("ap.approving") : `✅ ${tr("ap.approveSchedule")}`}</button>
    </section>
  );
}
