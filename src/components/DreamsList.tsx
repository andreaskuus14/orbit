"use client";
import { useEffect, useState } from "react";
import { api } from "./AgentMission";
import type { Idea } from "@/lib/dream-ideas-pure";

// 💭 DREAMS under GOALS: ideas the night shift combined from his goals, notes and kept niches (dream-ideas.ts). Keep / Discard teach
// ORBIT which kinds he likes; "Make it a goal" creates a draft goal (plan needs his approval). Model text: rendered as React text only.

export function DreamsList({ onGoal }: { onGoal: () => void }) {
  const [ideas, setIdeas] = useState<Idea[] | null>(null);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => { api<{ ideas: Idea[] }>("/api/dreams").then((r) => setIdeas(r.ideas), (e) => setErr(e.message)); }, []);
  async function act(id: string, decision: "keep" | "discard" | "goal") {
    setBusy(true); setErr("");
    try { setIdeas((await api<{ ideas: Idea[] }>("/api/dreams", { method: "POST", body: JSON.stringify({ id, decision }) })).ideas); if (decision === "goal") onGoal(); }
    catch (e) { setErr(e instanceof Error ? e.message : "Failed"); } finally { setBusy(false); }
  }
  if (!ideas?.length) return err ? <p className="error text-xs" role="alert">{err}</p> : null;
  return (
    <details className="text-xs" open={ideas.some((i) => i.status === "new")}>
      <summary className="hud-title cursor-pointer text-[0.7rem]">DREAMS ({ideas.length})</summary>
      <ul className="mt-2 space-y-2" aria-label="Dreamt ideas">
        {ideas.map((i) => (
          <li key={i.id} className="card space-y-1">
            <b className="block break-words">{i.title}</b>
            {i.why && <span className="muted block">{i.why}</span>}
            <span className="block">First step: {i.step}</span>
            <span className="muted block">{i.category} · {i.day}{i.status !== "new" ? ` · ${i.status === "goal" ? "now a goal" : "kept"}` : ""}</span>
            {i.status !== "goal" && (
              <span className="flex flex-wrap gap-2">
                {i.status === "new" && <button type="button" className="chip" disabled={busy} onClick={() => act(i.id, "keep")}>Keep</button>}
                <button type="button" className="chip" disabled={busy} onClick={() => act(i.id, "discard")}>Discard</button>
                <button type="button" className="btn" disabled={busy} onClick={() => act(i.id, "goal")}>Make it a goal draft</button>
              </span>
            )}
          </li>
        ))}
      </ul>
      {err && <p className="error" role="alert">{err}</p>}
    </details>
  );
}
