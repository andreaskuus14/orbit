"use client";
// ARCH Study: today's cards due, flip, Again/Hard/Good/Easy (SM-2 in study-pure.ts, data /api/study) and a weekly quiz of 10 due
// book cards. A book card's back shows the quoted passage and "Book, Chapter", so every answer can be checked in the book.
import { useCallback, useEffect, useState } from "react";
import type { Card } from "@/lib/study-pure";
import { api } from "./AgentMission";
import { useT } from "./i18n";

type View = { cards: Card[]; skipped?: string[]; queue: string[]; stats: { due: number; total: number } };
const GRADES = [["astudy.again", 1], ["astudy.hard", 2], ["astudy.good", 3], ["astudy.easy", 4]] as const;
const post = <T,>(body: object) => api<T>("/api/study", { method: "POST", body: JSON.stringify(body) });

export function ArchStudy() {
  const { t } = useT();
  const [v, setV] = useState<View | null>(null), [books, setBooks] = useState<string[]>([]), [err, setErr] = useState(""), [busy, setBusy] = useState(false);
  const [queue, setQueue] = useState<Card[] | null>(null), [quiz, setQuiz] = useState(false), [flip, setFlip] = useState(false), [right, setRight] = useState(0), [total, setTotal] = useState(0);
  const load = useCallback(async () => {
    // A reply missing a field (an error page, an older server) must not crash ARCH: fill in empty lists.
    try { const r = await api<Partial<View>>("/api/study"); setV({ cards: r?.cards ?? [], skipped: r?.skipped ?? [], queue: r?.queue ?? [], stats: r?.stats ?? { due: 0, total: 0 } }); setBooks((await post<{ books?: string[] }>({ action: "books" }))?.books ?? []); } catch (e) { setErr(e instanceof Error ? e.message : t("astudy.loadFail")); }
  }, [t]);
  useEffect(() => { void load(); }, [load]);

  const card = queue?.[0];
  const start = (cards: Card[], isQuiz: boolean) => { setQueue(cards); setQuiz(isQuiz); setFlip(false); setRight(0); setTotal(cards.length); setErr(""); };
  const end = () => { setQueue(null); void load(); };
  async function grade(g: 1 | 2 | 3 | 4) {
    if (!card) return;
    setFlip(false);
    if (g >= 3) setRight((n) => n + 1);
    setQueue((q) => (q ? [...q.slice(1), ...(g === 1 && !quiz ? [card] : [])] : q)); // Again comes back in this sitting; the quiz is one pass
    await post({ action: "review", id: card.id, grade: g }).catch((e) => setErr(e instanceof Error ? e.message : t("astudy.saveFail")));
  }
  async function make(book: string, retry?: string) {
    setBusy(true); setErr("");
    try { const r = await post<{ added: number; left: number }>({ action: "bookCards", book, ...(retry ? { retry } : {}) }); setErr(r.left ? t("astudy.addedLeft", { n: r.added, left: r.left }) : t("astudy.added", { n: r.added })); await load(); }
    catch (e) { setErr(e instanceof Error ? e.message : t("astudy.makeFail")); }
    setBusy(false);
  }

  const due = v?.cards.filter((c) => v.queue.includes(c.id)) ?? [];
  return (
    <div className="card space-y-1.5 text-xs" aria-label={t("astudy.title")}>
      <div className="muted text-[12px] font-medium">{t("astudy.title")}{v && ` · ${t("astudy.due", { n: v.stats.due })}`}</div>
      {queue ? (card ? <div className="space-y-1.5" aria-live="polite">
        <div className="muted">{quiz ? t("astudy.quizN", { i: total - queue.length + 1, n: total }) : t("astudy.left", { n: queue.length })} <button className="link ml-2" onClick={end}>{t("astudy.end")}</button></div>
        <p className="font-medium">{card.front}</p>
        {flip ? <>
          <p className="whitespace-pre-wrap border-t border-white/10 pt-1">{card.back}</p>
          <div className="flex flex-wrap gap-1.5">{GRADES.map(([l, g]) => <button key={g} className="chip" onClick={() => void grade(g)}>{t(l)}</button>)}</div>
        </> : <button className="chip" onClick={() => setFlip(true)}>{t("astudy.show")}</button>}
      </div> : <p className="ok" role="status">{quiz ? t("astudy.quizDone", { r: right, n: total }) : t("astudy.doneNow")} <button className="link ml-2" onClick={end}>OK</button></p>)
      : <div className="flex flex-wrap gap-1.5">
        <button className="chip" disabled={!due.length} onClick={() => start(due.slice(0, 20), false)}>{due.length ? t("astudy.review", { n: Math.min(20, due.length) }) : t("astudy.nothing")}</button>
        <button className="chip" onClick={() => void post<{ quiz?: Card[] }>({ action: "quiz" }).then((r) => r?.quiz?.length ? start(r.quiz, true) : setErr(t("astudy.noQuiz"))).catch((e) => setErr(e.message))}>{t("astudy.weekly")}</button>
      </div>}
      {!queue && <div className="flex flex-wrap items-center gap-1.5">
        {books.length ? books.map((b) => <button key={b} className="chip" disabled={busy} onClick={() => void make(b)}>{busy ? t("astudy.reading") : t("astudy.from", { b })}</button>) : <span className="muted">{t("astudy.noBook")}</span>}
      </div>}
      {!queue && !!v?.skipped?.length && <div className="flex flex-wrap items-center gap-1.5"><span className="muted">{t("astudy.noneFrom")}</span>
        {v.skipped.map((s) => { const k = s.indexOf("|"), b = s.slice(5, k), ch = s.slice(k + 1); return <button key={s} className="chip" disabled={busy} onClick={() => void make(b, ch)}>{t("astudy.retry", { ch })}</button>; })}
      </div>}
      {err && <p role="status" className="muted">{err}</p>}
    </div>
  );
}
