"use client";
// ARCH Study: today's cards due, flip, Again/Hard/Good/Easy (SM-2 in study-pure.ts, data /api/study) and a weekly quiz of 10 due
// book cards. A book card's back shows the quoted passage and "Book, Chapter", so every answer can be checked in the book.
import { useCallback, useEffect, useState } from "react";
import type { Card } from "@/lib/study-pure";
import { api } from "./AgentMission";

type View = { cards: Card[]; queue: string[]; stats: { due: number; total: number } };
const GRADES = [["Again", 1], ["Hard", 2], ["Good", 3], ["Easy", 4]] as const;
const post = <T,>(body: object) => api<T>("/api/study", { method: "POST", body: JSON.stringify(body) });

export function ArchStudy() {
  const [v, setV] = useState<View | null>(null), [books, setBooks] = useState<string[]>([]), [err, setErr] = useState(""), [busy, setBusy] = useState(false);
  const [queue, setQueue] = useState<Card[] | null>(null), [quiz, setQuiz] = useState(false), [flip, setFlip] = useState(false), [right, setRight] = useState(0), [total, setTotal] = useState(0);
  const load = useCallback(async () => {
    try { setV(await api<View>("/api/study")); setBooks((await post<{ books: string[] }>({ action: "books" })).books); } catch (e) { setErr(e instanceof Error ? e.message : "Couldn't load"); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const card = queue?.[0];
  const start = (cards: Card[], isQuiz: boolean) => { setQueue(cards); setQuiz(isQuiz); setFlip(false); setRight(0); setTotal(cards.length); setErr(""); };
  const end = () => { setQueue(null); void load(); };
  async function grade(g: 1 | 2 | 3 | 4) {
    if (!card) return;
    setFlip(false);
    if (g >= 3) setRight((n) => n + 1);
    setQueue((q) => (q ? [...q.slice(1), ...(g === 1 && !quiz ? [card] : [])] : q)); // Again comes back in this sitting; the quiz is one pass
    await post({ action: "review", id: card.id, grade: g }).catch((e) => setErr(e instanceof Error ? e.message : "Couldn't save"));
  }
  async function make(book: string) {
    setBusy(true); setErr("");
    try { const r = await post<{ added: number; left: number }>({ action: "bookCards", book }); setErr(`${r.added} new cards${r.left ? `; ${r.left} chapters left, press again` : ""}.`); await load(); }
    catch (e) { setErr(e instanceof Error ? e.message : "Couldn't make cards"); }
    setBusy(false);
  }

  const due = v?.cards.filter((c) => v.queue.includes(c.id)) ?? [];
  return (
    <div className="card space-y-1.5 text-xs" aria-label="Study">
      <div className="muted text-[10px] uppercase tracking-widest">Study{v && ` · ${v.stats.due} due today`}</div>
      {queue ? (card ? <div className="space-y-1.5" aria-live="polite">
        <div className="muted">{quiz ? `Quiz ${total - queue.length + 1}/${total}` : `${queue.length} left`} <button className="link ml-2" onClick={end}>End</button></div>
        <p className="font-medium">{card.front}</p>
        {flip ? <>
          <p className="whitespace-pre-wrap border-t border-white/10 pt-1">{card.back}</p>
          <div className="flex flex-wrap gap-1.5">{GRADES.map(([l, g]) => <button key={g} className="chip" onClick={() => void grade(g)}>{l}</button>)}</div>
        </> : <button className="chip" onClick={() => setFlip(true)}>Show answer</button>}
      </div> : <p className="ok" role="status">{quiz ? `Quiz done: ${right}/${total} right.` : "Done for now."} <button className="link ml-2" onClick={end}>OK</button></p>)
      : <div className="flex flex-wrap gap-1.5">
        <button className="chip" disabled={!due.length} onClick={() => start(due.slice(0, 20), false)}>{due.length ? `Review ${Math.min(20, due.length)} cards` : "Nothing due"}</button>
        <button className="chip" onClick={() => void post<{ quiz: Card[] }>({ action: "quiz" }).then((r) => r.quiz.length ? start(r.quiz, true) : setErr("No due book cards for a quiz yet.")).catch((e) => setErr(e.message))}>Weekly quiz</button>
      </div>}
      {!queue && <div className="flex flex-wrap items-center gap-1.5">
        {books.length ? books.map((b) => <button key={b} className="chip" disabled={busy} onClick={() => void make(b)}>{busy ? "Reading…" : `Cards from ${b}`}</button>) : <span className="muted">No book yet: make its skill in VAULT first.</span>}
      </div>}
      {err && <p role="status" className="muted">{err}</p>}
    </div>
  );
}
