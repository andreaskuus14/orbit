"use client";
import { useEffect, useState } from "react";
import type { Stored } from "@/lib/lessons-pure";

// "What I learned about you" (Profile) and the one-tap chip CORE shows after a correction. Data: /api/lessons (lessons.ts).

type View = { proposed: Stored[]; kept: Stored[]; rejected: number; minedAt: string | null };

async function post(body: object): Promise<View> {
  const r = await fetch("/api/lessons", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || `Request failed (${r.status})`);
  return j as View;
}
const pct = (c: number) => `${Math.round(c * 100)}%`;
const SOURCE: Record<string, string> = { event: "ledger event", proposal: "proposal", clip: "clip review", prospect: "outreach", niche: "niche", message: "your chat message" };

function Evidence({ l }: { l: Stored }) {
  return (
    <details className="text-xs">
      <summary className="link muted">Based on {l.support} {l.area === "correction" ? "correction" : `decision${l.support === 1 ? "" : "s"}`} · {pct(l.confidence)} sure</summary>
      <ul className="muted mt-1 space-y-0.5">{l.evidence.map((e) => { const i = e.indexOf(":"); return <li key={e}>{SOURCE[e.slice(0, i)] ?? e.slice(0, i)} <code>{e.slice(i + 1)}</code></li>; })}</ul>
    </details>
  );
}

export function LessonsSection() {
  const [v, setV] = useState<View | null>(null);
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => { fetch("/api/lessons", { cache: "no-store" }).then((r) => r.json()).then((j) => (j.error ? setMsg(j.error) : setV(j))).catch((e) => setMsg(e.message)); }, []);
  const act = async (body: object, done = "") => {
    setBusy(true); setMsg("");
    try { setV(await post(body)); setMsg(done); } catch (e) { setMsg(e instanceof Error ? e.message : "Could not save"); } finally { setBusy(false); }
  };
  return (
    <section className="space-y-2" aria-labelledby="lessons-h">
      <h3 id="lessons-h" className="h3">What I learned about you</h3>
      <p className="muted text-xs">Every night ORBIT looks at your own decisions (clips you approve or reject, proposals, morning clicks, memory suggestions, niches, outreach replies, when you&apos;re active) and notes patterns, like an assistant would. Nothing is used until you keep it. Kept lessons are added next to your style rules and never change them; “Not true” lessons are never suggested again.</p>
      {!v ? (!msg && <p className="muted text-sm">Loading…</p>) : (<>
        <ul className="space-y-2" aria-label="New lessons">
          {v.proposed.map((l) => (
            <li key={l.id} className="card space-y-1 text-sm">
              <div>{l.text}</div>
              <Evidence l={l} />
              <div className="flex gap-2">
                <button type="button" className="btn" disabled={busy} onClick={() => act({ id: l.id, decision: "keep" }, "Kept.")}>Keep</button>
                <button type="button" className="chip" disabled={busy} onClick={() => act({ id: l.id, decision: "reject" }, "Won't suggest that again.")}>Not true</button>
              </div>
            </li>
          ))}
          {!v.proposed.length && <li className="muted text-sm">Nothing new to confirm.</li>}
        </ul>
        {!!v.kept.length && (
          <details>
            <summary className="link text-sm">Kept lessons ({v.kept.length})</summary>
            <ul className="mt-2 space-y-1">{v.kept.map((l) => (
              <li key={l.id} className="flex items-start justify-between gap-2 text-sm">
                <div><div>{l.text}</div><Evidence l={l} /></div>
                <button type="button" className="chip shrink-0" disabled={busy} onClick={() => confirm("Forget this lesson? It won't be suggested again.") && act({ id: l.id, decision: "reject" }, "Forgotten.")}>Forget</button>
              </li>))}</ul>
          </details>
        )}
        <div className="muted flex flex-wrap items-center gap-2 text-xs">
          <span>Last looked: {v.minedAt ? new Date(v.minedAt).toLocaleString([], { dateStyle: "medium", timeStyle: "short" }) : "not yet"}{v.rejected ? ` · ${v.rejected} marked not true` : ""}</span>
          <button type="button" className="chip" disabled={busy} onClick={() => act({ action: "mine" }, "Looked again.")}>Look again now</button>
        </div>
      </>)}
      {msg && <p className="muted text-sm" role="status">{msg}</p>}
    </section>
  );
}

/** After a correction in chat: "Noted: …" with Keep / Not true. */
export function LessonChip({ lesson }: { lesson: { id: string; text: string } }) {
  const [state, setState] = useState<"" | "busy" | "kept" | "dropped" | "error">("");
  const act = (decision: "keep" | "reject") => { setState("busy"); post({ id: lesson.id, decision }).then(() => setState(decision === "keep" ? "kept" : "dropped"), () => setState("error")); };
  return (
    <div className="mt-2 flex flex-wrap items-center gap-1.5 text-xs" role="group" aria-label="Lesson from your correction">
      <span className="muted">📝 {state === "kept" ? "Kept:" : state === "dropped" ? "Dropped:" : "Should I remember:"} {lesson.text}</span>
      {(state === "" || state === "error") && <>
        <button type="button" className="chip" onClick={() => act("keep")}>Keep</button>
        <button type="button" className="chip" onClick={() => act("reject")}>Not true</button>
        {state === "error" && <span className="error">Not saved; try again.</span>}
      </>}
    </div>
  );
}
