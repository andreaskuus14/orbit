"use client";
import { useCallback, useEffect, useState } from "react";
import type { Recipe } from "@/lib/recipes-pure";
import { startRecipe } from "./recipe-command";

// Agents Station → Recipes: saved agent setups, re-run with one tap (or "run recipe <name>").
export default function RecipesPanel({ onOpenTask }: { onOpenTask?: (id: string) => void }) {
  const [list, setList] = useState<Recipe[] | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState("");
  const [sure, setSure] = useState("");
  const load = useCallback(() => fetch("/api/recipes", { cache: "no-store" }).then((r) => r.json()).then((j) => setList(j.recipes ?? []), () => setMsg({ ok: false, text: "Couldn't load recipes" })), []);
  useEffect(() => { void load(); }, [load]);
  const run = async (r: Recipe) => {
    const topic = r.contract ? window.prompt(`${r.name}: what should ORBIT research?`)?.trim() : undefined; // saved workflow: one topic in
    if (r.contract && !topic) return;
    setBusy(r.id); setMsg(null);
    try { setMsg({ ok: true, text: await startRecipe(r, topic) }); } catch (e) { setMsg({ ok: false, text: (e as Error).message }); } finally { setBusy(""); }
  };
  const del = async (r: Recipe) => {
    if (sure !== r.id) { setSure(r.id); setTimeout(() => setSure(""), 4000); return; }
    setBusy(r.id);
    const res = await fetch("/api/recipes", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "delete", id: r.id }) });
    const j = await res.json().catch(() => ({}));
    if (res.ok) setList(j.recipes); else setMsg({ ok: false, text: j.error || "Couldn't delete" });
    setBusy(""); setSure("");
  };
  return (
    <div className="space-y-2 text-sm">
      <p className="muted text-xs">Save a finished task as a recipe (Operations → task → Save as recipe), then run it here or say “run recipe &lt;name&gt;”.</p>
      {msg && <p className={msg.ok ? "ok" : "error"} role={msg.ok ? "status" : "alert"}>{msg.text}{msg.ok && onOpenTask ? " It's in Operations." : ""}</p>}
      {!list && <p className="muted">Loading…</p>}
      {list && !list.length && <p className="muted">No recipes yet.</p>}
      <ul className="space-y-1.5">{list?.map((r) => (
        <li key={r.id} className="card flex items-start justify-between gap-2">
          <div className="min-w-0"><b>{r.name}</b> <span className="muted text-xs">· {r.agent}</span><p className="muted text-xs line-clamp-2">{r.contract ? `${r.contract.outcome} · ${r.contract.mode} mode` : r.request}</p></div>
          <div className="flex shrink-0 gap-1">
            <button type="button" className="chip" disabled={!!busy} onClick={() => void run(r)} aria-label={`Run recipe ${r.name}`}>{busy === r.id ? "Starting…" : "▶ Run"}</button>
            {!r.contract && <button type="button" className={`chip ${sure === r.id ? "error" : ""}`} disabled={!!busy} onClick={() => void del(r)} aria-label={`Delete recipe ${r.name}`}>{sure === r.id ? "Really?" : "Delete"}</button>}
          </div>
        </li>))}</ul>
    </div>
  );
}
