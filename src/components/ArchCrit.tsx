"use client";
// ARCH studio crit (roadmap 4): facts computed locally, cost shown, then one model call on his click; crits kept per model version.
import { useCallback, useEffect, useMemo, useState } from "react";
import type { PriceItem, Scene } from "@/lib/arch-pure";
import { canReply, critEstimate, critFacts, critPrompt, sceneVersion } from "@/lib/arch-crit-pure";

type Shot = { blob: Blob; w: number; h: number } | null;
type Row = { id: string; title: string; content: string; tags: string[] | null; created_at: string };

export default function ArchCrit({ scene, prices, shoot }: { scene: Scene; prices: PriceItem[]; shoot: () => Promise<Shot> }) {
  const facts = useMemo(() => critFacts(scene, prices), [scene, prices]);
  const version = useMemo(() => sceneVersion(scene), [scene]);
  const est = critEstimate(critPrompt(facts, true).length, { w: 1200, h: 800 });
  const [busy, setBusy] = useState(false), [msg, setMsg] = useState(""), [rows, setRows] = useState<Row[]>([]), [open, setOpen] = useState<string | null>(null), [reply, setReply] = useState("");
  const load = useCallback(() => fetch("/api/arch/studio").then((r) => r.json()).then((j) => setRows((j.rows ?? []).filter((r: Row) => r.tags?.includes("crit")))).catch(() => {}), []);
  useEffect(() => { void load(); }, [load]);

  async function run() {
    setBusy(true); setMsg("Taking a screenshot and asking the tutor…");
    const fd = new FormData();
    fd.set("scene", JSON.stringify(scene)); fd.set("prices", JSON.stringify(prices));
    const s = await shoot().catch(() => null);
    if (s) fd.set("shot", s.blob, "view.jpg");
    const r = await fetch("/api/arch/crit", { method: "POST", body: fd }).catch(() => null), j = await r?.json().catch(() => null);
    setBusy(false);
    if (!r?.ok) return setMsg(j?.error ?? "Couldn't get a crit.");
    setMsg(j.saveError ? `Not saved: ${j.saveError}` : "");
    await load(); setOpen(j.memoryId);
  }
  async function send(id: string) {
    setBusy(true);
    const r = await fetch("/api/arch/crit", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id, reply }) }).catch(() => null), j = await r?.json().catch(() => null);
    setBusy(false);
    if (!r?.ok) return setMsg(j?.error ?? "Couldn't send.");
    setReply(""); setRows((rs) => rs.map((x) => (x.id === id ? { ...x, content: j.content } : x)));
  }
  const cur = rows.find((r) => r.id === open);

  return (
    <details className="card space-y-2" aria-label="Studio crit">
      <summary className="muted cursor-pointer text-[10px] uppercase tracking-widest">🎓 Studio crit · model {version}</summary>
      <p className="muted text-[11px]">Learning aid: a tutor&apos;s opinion on numbers computed from your model, not a code or engineering check.</p>
      <ol className="space-y-0.5 text-xs">{facts.map((f) => <li key={f.id}><span className="num">{f.id}</span> {f.text}</li>)}</ol>
      <div className="flex flex-wrap items-center gap-2">
        <button className="btn" disabled={busy} onClick={() => void run()}>{busy ? "Working…" : "Get crit"}</button>
        <span className="muted text-[11px]">Costs 1 model call, ≈{est.toLocaleString("en")} tokens (with screenshot). Paused while Stop-all or a usage hold is on.</span>
      </div>
      {msg && <p className="text-xs" aria-live="polite">{msg}</p>}
      {!!rows.length && <div className="flex flex-wrap gap-1.5">{rows.map((r) => (
        <button key={r.id} className="chip" aria-pressed={open === r.id} onClick={() => setOpen(open === r.id ? null : r.id)}>
          {(r.tags ?? []).find((t) => t.startsWith("model:"))?.slice(6)} · {new Date(r.created_at).toLocaleDateString("et-EE")}
        </button>))}</div>}
      {cur && <div className="space-y-1.5">
        <pre className="whitespace-pre-wrap text-xs">{cur.content}</pre>
        {canReply(cur.content) && <div className="flex gap-1.5">
          <textarea className="field w-full text-xs" rows={2} maxLength={1500} value={reply} onChange={(e) => setReply(e.target.value)} placeholder="Reply to the tutor (one follow-up)" aria-label="Reply to crit" />
          <button className="btn" disabled={busy || !reply.trim()} onClick={() => void send(cur.id)}>Send</button>
        </div>}
      </div>}
    </details>
  );
}
