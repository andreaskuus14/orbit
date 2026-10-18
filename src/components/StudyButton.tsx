"use client";
import { useState } from "react";
import type { Lesson } from "@/lib/clips/study-pure";

// "📚 Study" one Short: ORBIT downloads it, watches it (frames + transcript) and saves why it works (POST /api/studio/clips/learn).
export default function StudyButton({ id, title, channel, views, source, onDone }: { id: string; title: string; channel: string; views?: number; source: "niche" | "own"; onDone?: (l: Lesson) => void }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [l, setL] = useState<Lesson | null>(null);
  async function run() {
    setBusy(true); setErr("");
    try {
      const r = await fetch("/api/studio/clips/learn", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id, title, channel, views, source }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || `Failed (${r.status})`);
      setL(j.lesson); onDone?.(j.lesson);
    } catch (e) { setErr(e instanceof Error ? e.message : "Failed"); } finally { setBusy(false); }
  }
  return (
    <div className="space-y-1 text-xs">
      <button className="chip" onClick={() => void run()} disabled={busy} aria-label={`Study why "${title}" works`}>{busy ? "📚 Watching… (1-3 min)" : l ? "📚 Study again" : "📚 Study"}</button>
      {err && <p className="error" role="alert">{err}</p>}
      {l && (
        <div className="space-y-0.5" aria-live="polite">
          <p>{l.why}</p>
          <p className="muted">Hook: {l.hook.technique}{l.hook.text ? ` ("${l.hook.text}")` : ""} · {l.facts.durationSec} s · {l.facts.cuts} cuts (avg shot {l.facts.avgShotSec} s) · payoff at {l.payoffSec} s{l.effects.length ? ` · ${l.effects.join(", ")}` : ""}</p>
          {!!l.lessons.length && <ul className="list-disc pl-4">{l.lessons.map((x) => <li key={x}>{x}</li>)}</ul>}
        </div>
      )}
    </div>
  );
}
