"use client";
// Study cards in MEMORY (logic: study-pure.ts, data: /api/study): today's review (flip, Again/Hard/Good/Easy, keys Space and 1-4),
// streak and recall stats, a typed deck, cards from kept lessons, and "Learn this" drafts from one memory that he keeps or edits.
import { useCallback, useEffect, useState } from "react";
import { NAV_EVENT, type NavTarget } from "@/lib/nav-pure";
import { SESSION, type Card, type Draft, type Review } from "@/lib/study-pure";
import { OPEN_MEMORY_EVENT } from "@/lib/palette-pure";
import { useT } from "./i18n";
import { api } from "./AgentMission";
import { askConfirm } from "./ui/Dialog";

// The brief's "3 minutes of cards" may fire before MEMORY mounts: remember it until StudyCards takes it.
let requested = false;
if (typeof window !== "undefined") addEventListener(NAV_EVENT, (e) => { if ((e as CustomEvent<NavTarget>).detail?.study) requested = true; });
export const studyPending = () => requested;

type View = { cards: Card[]; log?: Review[]; queue: string[]; stats: { total: number; due: number; streak: number; reviewedToday: number; retention: number | null; learned: number };
  lessons: (Draft & { id: string })[] };
const GRADES = [["sc.again", 1], ["sc.hard", 2], ["sc.good", 3], ["sc.easy", 4]] as const;
const post = (body: object) => api<View>("/api/study", { method: "POST", body: JSON.stringify(body) });

/** MEM07: where the answer came from (opens the memory) and whether that source was corrected since. */
function SourceLink({ c }: { c: Card }) {
  const { t } = useT();
  return <>
    {c.source === "memory" && c.ref && <button className="link text-xs" onClick={() => dispatchEvent(new CustomEvent(OPEN_MEMORY_EVENT, { detail: { id: c.ref } }))}>{t("study.source")}</button>}
    {c.sourceChanged && <span className="warn text-xs" title={t("study.changedHint")}> · {t("study.changed", { d: c.sourceChanged })}</span>}
  </>;
}

/** MEM07: earlier versions of a card and its self-ratings, newest first. */
function CardHistory({ c, log }: { c: Card; log: Review[] }) {
  const { t } = useT();
  const mine = log.filter((r) => r.card === c.id).reverse();
  if (!mine.length && !c.history?.length) return null;
  return (
    <details className="ml-2 text-[11px]"><summary className="muted cursor-pointer">{t("study.history", { n: mine.length })}</summary>
      <ul className="muted">
        {mine.slice(0, 20).map((r, i) => <li key={i}>{r.day} · {t(GRADES[r.grade - 1][0])}</li>)}
        {[...(c.history ?? [])].reverse().map((h, i) => <li key={`h${i}`}>{h.day} · {t(h.why === "source" ? "study.before.source" : "study.before.edit")}: {h.front} :: {h.back}</li>)}
      </ul>
    </details>
  );
}

/** Editable drafts: he keeps or drops each one, or keeps them all. */
function Drafts({ drafts, onKeep, onDone }: { drafts: Draft[]; onKeep: (d: Draft[]) => Promise<void>; onDone: () => void }) {
  const { t } = useT();
  const [list, setList] = useState(drafts);
  useEffect(() => setList(drafts), [drafts]);
  if (!list.length) return null;
  const set = (i: number, d: Partial<Draft>) => setList((l) => l.map((x, j) => (j === i ? { ...x, ...d } : x)));
  const drop = (i: number) => { const l = list.filter((_, j) => j !== i); setList(l); if (!l.length) onDone(); };
  return (
    <ul className="space-y-2">
      {list.map((d, i) => (
        <li key={i} className="card space-y-1">
          <input className="field w-full text-sm" value={d.front} maxLength={300} onChange={(e) => set(i, { front: e.target.value })} aria-label={t("sc.cardQ", { n: i + 1 })} />
          <textarea className="field h-14 w-full text-xs" value={d.back} maxLength={1000} onChange={(e) => set(i, { back: e.target.value })} aria-label={t("sc.cardA", { n: i + 1 })} />
          <div className="flex gap-1"><button className="chip" onClick={() => void onKeep([d]).then(() => drop(i))}>{t("sc.keep")}</button><button className="chip" onClick={() => drop(i)}>{t("sc.drop")}</button></div>
        </li>
      ))}
      <li className="flex gap-1"><button className="chip" onClick={() => void onKeep(list).then(() => { setList([]); onDone(); })}>{t("sc.keepAll", { n: list.length })}</button></li>
    </ul>
  );
}

/** "Learn this" on a memory: ORBIT drafts cards from it (one fast-model call); nothing is saved until he keeps a card. Not shown for journal entries. */
export function LearnThis({ memory }: { memory: { id: string; kind: string } }) {
  const [drafts, setDrafts] = useState<Draft[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  if (memory.kind === "journal") return null;
  const draft = async () => {
    setBusy(true); setMsg("");
    try {
      const r = await api<{ drafts: Draft[] }>("/api/study", { method: "POST", body: JSON.stringify({ action: "draft", memoryId: memory.id }) });
      setDrafts(r.drafts); if (!r.drafts.length) setMsg("Nothing in this note to make cards from.");
    } catch (e) { setMsg(e instanceof Error ? e.message : "Couldn't draft cards"); } finally { setBusy(false); }
  };
  const keep = async (d: Draft[]) => { try { await post({ action: "add", source: "memory", ref: memory.id, cards: d }); setMsg(`Kept ${d.length === 1 ? "a card" : `${d.length} cards`}.`); } catch (e) { setMsg(e instanceof Error ? e.message : "Couldn't save"); } };
  return (
    <div className="space-y-2">
      <button className="chip" disabled={busy} onClick={() => void draft()}>{busy ? "Drafting cards…" : "Learn this"}</button>
      {msg && <span className="muted ml-2 text-xs" aria-live="polite">{msg}</span>}
      {drafts && <Drafts drafts={drafts} onKeep={keep} onDone={() => setDrafts(null)} />}
    </div>
  );
}

export function StudyCards() {
  const { t, tn } = useT();
  const [v, setV] = useState<View | null>(null);
  const [err, setErr] = useState("");
  const [queue, setQueue] = useState<string[] | null>(null); // a review in progress
  const [flipped, setFlipped] = useState(false);
  const [done, setDone] = useState(0);
  const [deck, setDeck] = useState("");
  const [lessonDrafts, setLessonDrafts] = useState<(Draft & { id: string })[] | null>(null);
  const [edit, setEdit] = useState<Card | null>(null);

  const load = useCallback(() => api<View>("/api/study").then((x) => { setV(x); setErr(""); return x; }), []);
  const start = useCallback((x: View) => { setQueue(x.queue.slice(0, SESSION)); setFlipped(false); setDone(0); }, []);
  useEffect(() => {
    load().then((x) => { if (requested) { requested = false; start(x); } }).catch((e) => setErr(e.message));
    const h = (e: Event) => { if ((e as CustomEvent<NavTarget>).detail?.study) { requested = false; load().then(start).catch((er) => setErr(er.message)); } };
    addEventListener(NAV_EVENT, h);
    return () => removeEventListener(NAV_EVENT, h);
  }, [load, start]);

  const act = async (body: object) => { setErr(""); try { setV(await post(body)); return true; } catch (e) { setErr(e instanceof Error ? e.message : t("sc.cantSave")); return false; } };
  const card = queue?.length ? v?.cards.find((c) => c.id === queue[0]) : undefined;
  const grade = useCallback(async (g: 1 | 2 | 3 | 4) => {
    if (!card || !flipped) return;
    const id = card.id;
    setFlipped(false); setDone((n) => n + 1);
    setQueue((q) => (q ? [...q.slice(1), ...(g === 1 ? [id] : [])] : q)); // Again comes back later in this sitting
    await act({ action: "review", id, grade: g });
  }, [card, flipped]); // eslint-disable-line react-hooks/exhaustive-deps -- act only uses setters

  useEffect(() => {
    if (!queue) return;
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable)) return;
      if (e.key === "Escape") { setQueue(null); void load(); }
      else if ((e.key === " " || e.key === "Enter") && !flipped) { e.preventDefault(); setFlipped(true); }
      else if (flipped && ["1", "2", "3", "4"].includes(e.key)) { e.preventDefault(); void grade(Number(e.key) as 1 | 2 | 3 | 4); }
    };
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  }, [queue, flipped, grade, load]);

  if (queue) {
    return (
      <section className="space-y-2" aria-label={t("sc.review")}>
        <div className="flex items-center justify-between"><h3 className="h3">{t("sc.title")}</h3>
          <span className="muted num text-xs">{t("sc.doneLeft", { d: done, l: queue.length })} <button className="link ml-2" onClick={() => { setQueue(null); void load(); }}>{t("sc.end")}</button></span></div>
        {card ? (
          <div className="card space-y-3" aria-live="polite">
            <p className="font-medium">{card.front}</p>
            {flipped ? <>
              <p className="whitespace-pre-wrap border-t border-white/10 pt-2 text-sm">{card.back}</p>
              <SourceLink c={card} />
              <div className="flex flex-wrap gap-1">{GRADES.map(([label, g]) => <button key={g} className="chip" onClick={() => void grade(g)} aria-keyshortcuts={String(g)}>{t(label)} <span className="muted">{g}</span></button>)}</div>
            </> : <button className="btn" onClick={() => setFlipped(true)} aria-keyshortcuts="Space">{t("sc.show")} <span className="muted text-xs">{t("sc.space")}</span></button>}
          </div>
        ) : <p className="ok">{done ? tn("sc.doneN", done) : t("sc.nothingDue")}</p>}
        {err && <p className="error text-xs">{err}</p>}
      </section>
    );
  }

  const s = v?.stats;
  return (
    <details className="card space-y-2" open={!!s?.due}>
      <summary className="cursor-pointer"><b>{t("sc.title")}</b>{s && <span className="muted num text-xs"> · {t("sc.due", { n: s.due })} · {tn("sc.cards", s.total)}</span>}</summary>
      {s && <p className="muted num text-xs">{tn("sc.streak", s.streak)} · {t("sc.recall", { v: s.retention === null ? t("sc.na") : `${Math.round(s.retention * 100)}%` })} · {t("sc.learned", { n: s.learned })} · {t("sc.today", { n: s.reviewedToday })}</p>}
      {v && <button className="btn" disabled={!v.queue.length} onClick={() => start(v)}>{v.queue.length ? t("sc.reviewN", { n: Math.min(SESSION, v.queue.length) }) : t("sc.caughtUp")}</button>}
      <div className="space-y-1">
        <textarea className="field h-20 w-full text-xs" value={deck} onChange={(e) => setDeck(e.target.value)} maxLength={100_000}
          placeholder={t("sc.deckPh")} aria-label={t("sc.deck")} />
        <button className="chip" disabled={!deck.trim()} onClick={() => void act({ action: "deck", text: deck }).then((ok) => ok && setDeck(""))}>{t("sc.add")}</button>
        {!!v?.lessons.length && !lessonDrafts && <button className="chip ml-1" onClick={() => setLessonDrafts(v.lessons)}>{t("sc.fromLessons", { n: v.lessons.length })}</button>}
      </div>
      {lessonDrafts && <Drafts drafts={lessonDrafts} onDone={() => setLessonDrafts(null)}
        onKeep={async (ds) => { for (const d of ds) await act({ action: "add", source: "lesson", ref: (d as Draft & { id?: string }).id, cards: [d] }); }} />}
      {!!v?.cards.length && (
        <details>
          <summary className="muted cursor-pointer text-xs">{t("sc.all")}</summary>
          <ul className="mt-1 space-y-1">
            {v.cards.map((c) => edit?.id === c.id ? (
              <li key={c.id} className="space-y-1">
                <input className="field w-full text-xs" value={edit.front} maxLength={300} onChange={(e) => setEdit({ ...edit, front: e.target.value })} aria-label={t("sc.q")} />
                <textarea className="field h-12 w-full text-xs" value={edit.back} maxLength={1000} onChange={(e) => setEdit({ ...edit, back: e.target.value })} aria-label={t("sc.a")} />
                <button className="chip" onClick={() => void act({ action: "edit", id: c.id, front: edit.front, back: edit.back }).then((ok) => ok && setEdit(null))}>{t("sc.save")}</button>
                <button className="chip ml-1" onClick={() => setEdit(null)}>{t("common.cancel")}</button>
              </li>
            ) : (
              <li key={c.id} className="text-xs"><div className="flex items-center gap-2">
                <span className="min-w-0 flex-1 truncate" title={c.back}>{c.front}</span>
                <SourceLink c={c} />
                <span className="muted num shrink-0">{c.source} · {t("sc.dueOn", { d: c.due })}</span>
                <button className="link" onClick={() => setEdit(c)}>{t("sc.edit")}</button>
                <button className="link" onClick={async () => { if ((await askConfirm(t("sc.delAsk")))) void act({ action: "delete", id: c.id }); }}>{t("sc.del")}</button>
              </div><CardHistory c={c} log={v.log ?? []} /></li>
            ))}
          </ul>
        </details>
      )}
      {err && <p className="error text-xs">{err}</p>}
    </details>
  );
}
