"use client";
import { OrbitThinks } from "./OrbitThinks";
// Weekly memory hygiene in the MEMORY panel: at most 3 proposals a week. Accept runs the existing routes (PATCH/DELETE
// /api/memories/:id, POST /api/facts "wrong"), then records the click (ledger event). Dismiss never proposes it again.
import { useCallback, useEffect, useState } from "react";
import { mergedContent, type HProposal } from "@/lib/memory-hygiene-pure";

type Item = { id: string; title: string; kind?: string; at: string; live: boolean };
type P = HProposal & { items: Item[] };
const WHY: Record<HProposal["why"], string> = {
  "same text": "These say the same thing.", "near duplicate": "These are near-duplicates.",
  contradicted: "A newer belief on the same subject says the opposite.", superseded: "A newer belief on the same subject replaces this one.",
  stale: "You haven't restated this in over a year.",
};

async function call(url: string, init?: RequestInit, okIf404 = false) {
  const r = await fetch(url, { ...init, headers: { "Content-Type": "application/json" } });
  const j = await r.json().catch(() => ({}));
  if (!r.ok && !(okIf404 && r.status === 404)) throw new Error(j.error || `Failed (${r.status})`);
  return j;
}

export function MemoryHygiene({ onChanged }: { onChanged: () => void }) {
  const [list, setList] = useState<P[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState("");
  const load = useCallback(() => call("/api/memories/hygiene").then((j) => setList(j.proposals ?? []), (e: Error) => setErr(e.message)), []);
  useEffect(() => { void load(); }, [load]);

  async function act(p: P, decision: "accepted" | "dismissed") {
    setBusy(p.key); setErr("");
    try {
      if (decision === "accepted" && p.action === "merge") {
        const [keep, drop] = p.ids;
        const [k, d] = await Promise.all([call(`/api/memories/${keep}`), call(`/api/memories/${drop}`)]);
        const content = mergedContent(String(k.memory.content ?? ""), String(d.memory.content ?? ""));
        if (content !== null) await call(`/api/memories/${keep}`, { method: "PATCH", body: JSON.stringify({ content }) });
        await call(`/api/memories/${drop}`, { method: "DELETE" }, true);
      }
      if (decision === "accepted" && p.action === "retract") await call("/api/facts", { method: "POST", body: JSON.stringify({ id: p.ids[0], action: "wrong" }) });
      await call("/api/memories/hygiene", { method: "POST", body: JSON.stringify({ key: p.key, decision }) });
      if (decision === "accepted") onChanged();
      await load();
    } catch (e) { setErr(e instanceof Error ? e.message : "Failed"); }
    finally { setBusy(null); }
  }

  const pending = list?.filter((p) => p.status === "pending") ?? [];
  if (!pending.length && !err) return null;
  return (
    <div className="card space-y-2" aria-label="Memory hygiene">
      <div className="muted text-[10px] uppercase tracking-widest">Tidy-up this week · nothing changes until you accept</div>
      {err && <p className="error" role="alert">{err}</p>}
      <ul className="space-y-2">{pending.map((p) => (
        <li key={p.key} className="space-y-1">
          <b>{p.action === "merge" ? "Merge two memories" : "Retract a belief"}</b>
          <p className="muted text-xs">{WHY[p.why]}{p.action === "merge" ? " The first keeps its links and gains any extra text; the second is deleted." : ""}</p>
          <ul className="text-xs">{p.items.map((it) => <li key={it.id} className="truncate">· {it.title}{it.kind ? <span className="muted"> ({it.kind})</span> : null}</li>)}</ul>
          <div className="flex gap-2">
            <button className="btn" onClick={() => act(p, "accepted")} disabled={busy !== null}>{busy === p.key ? "Working…" : "Accept"}</button>
            <button className="chip" onClick={() => act(p, "dismissed")} disabled={busy !== null}>Dismiss</button>
            <OrbitThinks id={`hygiene:${p.key}`} />
          </div>
        </li>))}</ul>
    </div>
  );
}
