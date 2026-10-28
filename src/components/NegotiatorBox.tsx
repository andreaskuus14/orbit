"use client";
import { useCallback, useState } from "react";
import { INTENTS, type Intent, type Negotiation } from "@/lib/negotiator-pure";
import { LANGS } from "@/lib/business-pure";
import { contentHash, negoContent } from "@/lib/approval-pure";

// Negotiator (roadmap B2) for one BUSINESS prospect or deal offer: his limits, their replies (pasted by him), ORBIT's plan + draft,
// and his approve. Drafts are always inside his limits; an edit outside them needs "I mean it". Nothing goes out without his click.

async function call(body?: object) {
  const res = await fetch("/api/negotiator", { method: body ? "POST" : "GET", cache: "no-store", ...(body && { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }) });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(j.error || `Request failed (${res.status})`);
  return j;
}
const STATE_TEXT: Record<Negotiation["state"], string> = { talking: "Talking", agreed: "Agreed", walked: "Walked away", lost: "They said no", expired: "Deadline passed" };

export default function NegotiatorBox({ refKey, title, hint }: { refKey: string; title: string; hint?: { floor?: number; ceiling?: number } }) {
  const [open, setOpen] = useState(false);
  const [n, setN] = useState<Negotiation | null>(null);
  const [form, setForm] = useState<Record<string, string>>({ floor: hint?.floor ? String(hint.floor) : "", ceiling: hint?.ceiling ? String(hint.ceiling) : "", deadline: "", mustHaves: "", walkAway: "", stepPct: "5" });
  const [editLimits, setEditLimits] = useState(false);
  const [reply, setReply] = useState("");
  const [intent, setIntent] = useState<Intent | "auto">("auto");
  const [lang, setLang] = useState("English");
  const [text, setText] = useState("");
  const [mean, setMean] = useState(false);
  const [sure, setSure] = useState(false);
  const [busy, setBusy] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [to, setTo] = useState<string | null>(null); // who approving emails it to (server-resolved; hashed into the approval)

  const show = (x: Negotiation | null) => { setN(x); setText(x?.draft?.text ?? ""); setMean(false); };
  const load = useCallback(async () => {
    const j = (await call()) as { negotiations: Negotiation[]; recipients?: Record<string, string | null> };
    const mine = j.negotiations.filter((x) => x.ref === refKey).sort((a, b) => a.updated.localeCompare(b.updated)).at(-1) ?? null;
    show(mine);
    setTo((mine && j.recipients?.[mine.id]) ?? null);
    if (mine) setForm({ floor: String(mine.limits.floor), ceiling: String(mine.limits.ceiling), deadline: mine.limits.deadline ?? "", mustHaves: mine.limits.mustHaves.join("; "), walkAway: mine.limits.walkAway, stepPct: String(mine.limits.stepPct) });
  }, [refKey]);
  const act = async (key: string, body: object, after?: (j: { negotiation?: Negotiation; note?: string; message?: string }) => void) => {
    setBusy(key); setMsg(null);
    try {
      const j = await call(body);
      if (j.negotiation) show(j.negotiation);
      after?.(j);
      if (j.message || j.note) setMsg({ ok: true, text: j.message || j.note });
    } catch (e) { setMsg({ ok: false, text: (e as Error).message }); } finally { setBusy(""); }
  };
  const toggle = () => { setOpen(!open); if (!open) load().catch((e: Error) => setMsg({ ok: false, text: e.message })); };

  if (!open) return <button className="chip" onClick={toggle}>🤝 Negotiate</button>;
  const any = !!busy;
  const d = n?.draft;
  const edited = !!d && text !== d.text;
  const field = (k: string, label: string, cls = "w-20", type = "text") => (
    <label className="flex items-center gap-1"><span className="muted">{label}</span><input className={`field ${cls}`} type={type} inputMode={type === "text" && k !== "mustHaves" && k !== "walkAway" ? "decimal" : undefined} value={form[k]} onChange={(e) => setForm({ ...form, [k]: e.target.value })} /></label>
  );
  return (
    <div className="space-y-1.5 rounded-md border border-white/10 p-2 text-xs" aria-label={`Negotiation with ${title}`}>
      <div className="flex items-center justify-between gap-2"><b>🤝 Negotiation{n ? ` · ${STATE_TEXT[n.state]}` : ""}</b><button className="chip" onClick={toggle}>Close</button></div>
      {(!n || editLimits) ? (
        <div className="space-y-1">
          <div className="flex flex-wrap gap-2">{field("floor", "Floor €")}{field("ceiling", "Ceiling €")}{field("stepPct", "Max step %", "w-14")}{field("deadline", "Deadline", "w-36", "date")}</div>
          {field("mustHaves", "Must-haves (; between)", "w-full")}
          {field("walkAway", "Walk away if", "w-full")}
          <button className="chip" disabled={any} onClick={() => void act("limits", { action: "limits", ref: refKey, title, ...form, mustHaves: form.mustHaves }, () => setEditLimits(false))}>{n ? "Save limits" : "Start with these limits"}</button>
          <p className="muted">ORBIT never drafts a price outside floor–ceiling. {n ? "New limits drop the waiting draft." : ""}</p>
        </div>
      ) : (
        <p className="muted">Limits €{n.limits.floor}–€{n.limits.ceiling}, max {n.limits.stepPct}% per step{n.limits.deadline ? `, until ${n.limits.deadline}` : ""}{n.limits.mustHaves.length ? ` · must: ${n.limits.mustHaves.join("; ")}` : ""}{n.limits.walkAway ? ` · walk away: ${n.limits.walkAway}` : ""}
          {n.state === "talking" && <button className="chip ml-1" onClick={() => setEditLimits(true)}>Change</button>}</p>
      )}
      {n && n.turns.length > 0 && (
        <ol className="max-h-40 space-y-1 overflow-auto">{n.turns.map((t, i) => (
          <li key={i} className={t.from === "me" ? "pl-4" : ""}><span className="muted">{t.from === "me" ? `You${t.via === "email" ? " (emailed)" : t.via === "unknown" ? " (email result unknown)" : ""}` : `Them${t.intent ? ` · ${t.intent}` : ""}`}:</span> <span className="whitespace-pre-wrap">{t.text}</span></li>
        ))}</ol>
      )}
      {n?.state === "talking" && (
        <div className="space-y-1">
          <textarea className="field w-full" rows={2} aria-label="Their reply" placeholder="Paste their reply here" maxLength={3000} value={reply} onChange={(e) => setReply(e.target.value)} />
          <div className="flex flex-wrap items-center gap-1.5">
            <select className="chip" aria-label="Their intent" value={intent} onChange={(e) => setIntent(e.target.value as Intent | "auto")}><option value="auto">Intent: ORBIT reads it</option>{INTENTS.map((i) => <option key={i} value={i}>Intent: {i}</option>)}</select>
            <select className="chip" aria-label="Message language" value={lang} onChange={(e) => setLang(e.target.value)}>{LANGS.map((l) => <option key={l}>{l}</option>)}</select>
            <button className="chip" disabled={any || !reply.trim()} onClick={() => void act("reply", { action: "reply", id: n.id, text: reply, lang, ...(intent !== "auto" && { intent }) }, () => setReply(""))}>{busy === "reply" ? "CORE is writing…" : "Read reply & draft"}</button>
            <button className="chip" disabled={any} onClick={() => void act("redraft", { action: "redraft", id: n.id, lang, ...(intent !== "auto" && { intent }) })}>{busy === "redraft" ? "CORE is writing…" : n.turns.length ? "Redraft" : "Draft opening offer"}</button>
          </div>
        </div>
      )}
      {n?.state === "talking" && d && (
        <div className="space-y-1 rounded-md border border-amber-400/40 p-2">
          <p><b>Plan:</b> {d.strategy}</p>
          <textarea className="field w-full" rows={4} aria-label="Draft reply" value={text} onChange={(e) => { setText(e.target.value); setSure(false); }} />
          <div className="flex flex-wrap items-center gap-1.5">
            {edited ? <>
              <label className="flex items-center gap-1"><input type="checkbox" checked={mean} onChange={(e) => setMean(e.target.checked)} />I mean it (even outside my limits)</label>
              <button className="chip" disabled={any} onClick={() => void act("edit", { action: "edit", id: n.id, seen: d.at, text, confirm: mean })}>Save edit</button>
              <button className="chip" onClick={() => setText(d.text)}>Undo</button>
            </> : <>
              <button className={`chip ${sure ? "ok" : ""}`} disabled={any}
                onClick={() => (sure ? (setSure(false), void contentHash(negoContent(n.id, d.text, to)).then((seen) => act("approve", { action: "approve", id: n.id, seen }))) : (setSure(true), setTimeout(() => setSure(false), 5000)))}>
                {busy === "approve" ? "…" : sure ? "Click again to approve" : "✓ Approve"}</button>
              <button className="chip" onClick={() => void navigator.clipboard?.writeText(d.text).catch(() => {})}>Copy</button>
            </>}
            {d.outside.length > 0 && <span className="error">Outside your limits: {d.outside.join(", ")} (your edit)</span>}
          </div>
          <p className="muted">{to ? `Approve emails it to ${to}. If Contact changes, reload and approve again.` :"No email address to send to: approve, then copy it and send it yourself."}</p>
        </div>
      )}
      {n?.state === "talking" && <div className="flex gap-1.5"><button className="chip" disabled={any} onClick={() => void act("agreed", { action: "close", id: n.id, state: "agreed" })}>Mark agreed</button><button className="chip" disabled={any} onClick={() => void act("lost", { action: "close", id: n.id, state: "lost" })}>Mark lost</button></div>}
      {msg && <p className={msg.ok ? "ok" : "error"} role={msg.ok ? "status" : "alert"}>{msg.text}</p>}
    </div>
  );
}
