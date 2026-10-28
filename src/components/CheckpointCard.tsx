"use client";
// The open chat's work checkpoint (checkpoint-pure.ts) in the CORE chat sheet: what CORE always keeps in mind; edit or delete lines.
import { useCallback, useEffect, useState } from "react";
import { MAX_TEXT, type CpKind, type CpLine } from "@/lib/checkpoint-pure";

const LABEL: Record<CpKind, string> = { constraint: "Constraint", success: "Success", decision: "Decision", artifact: "Artifact", blocker: "Blocker", next: "Next" };

export function CheckpointCard({ chatId }: { chatId: string | null }) {
  const [lines, setLines] = useState<CpLine[]>([]);
  const [error, setError] = useState("");
  const call = useCallback(async (init?: RequestInit) => {
    if (!chatId) return;
    try {
      const res = await fetch(`/api/core/checkpoint${init ? "" : `?id=${encodeURIComponent(chatId)}`}`, init);
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j.error || `Request failed (${res.status})`);
      setLines(j.lines ?? []); setError("");
    } catch (e) { setError(e instanceof Error ? e.message : "failed"); }
  }, [chatId]);
  useEffect(() => { setLines([]); void call(); }, [call]);
  const post = (body: Record<string, unknown>) => call({ method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: chatId, ...body }) });
  if (!chatId || (!lines.length && !error)) return null;
  return (
    <section className="mt-3 rounded-lg bg-white/5 p-2" aria-label="Checkpoint">
      <div className="h3">Checkpoint</div>
      <p className="muted text-xs">CORE keeps these in every answer in this chat. Say “continue” / “jätka” to pick up from here.</p>
      {error && <p className="error text-xs" role="alert">{error}</p>}
      <ul className="mt-1 space-y-1">
        {lines.map((l) => (
          <li key={l.id} className="flex items-start gap-1 text-xs">
            <span className="muted shrink-0">{LABEL[l.kind]}:</span>
            <span className="min-w-0 flex-1 break-words">{l.text}{l.v ? ` (v${l.v})` : ""}</span>
            <button type="button" className="chip px-2" aria-label={`Edit ${l.text}`} title="Edit"
              onClick={() => { const t = prompt("Edit checkpoint line", l.text)?.trim(); if (t && t !== l.text) void post({ action: "edit", line: l.id, text: t.slice(0, MAX_TEXT) }); }}>✎</button>
            <button type="button" className="chip px-2" aria-label={`Delete ${l.text}`} title="Delete"
              onClick={() => { if (confirm(`Remove "${l.text}" from the checkpoint?`)) void post({ action: "delete", line: l.id }); }}>✕</button>
          </li>
        ))}
      </ul>
    </section>
  );
}
