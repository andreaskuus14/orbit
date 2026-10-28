"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { NOT_LEGAL_ADVICE, STATUS_LABEL, TEMPLATES, TEMPLATE_IDS, changed, contractSendContent, current, diffWords, missing, type Contract, type Fields, type Signature, type TemplateId, type VClause, type Version } from "@/lib/contracts-pure";
import { emailIn, type Prospect } from "@/lib/business-pure";
import { contentHash } from "@/lib/approval-pure";

// BUSINESS → Contracts: ORBIT fills a vetted template, you review (fields beside the rendered contract, every change from the
// template highlighted), you sign with your own click, then approve the email that sends the signed PDF. ORBIT never signs.

type State = { contracts: Contract[]; canSend: boolean };
type Deal = { id: string; label: string };
async function call(body?: object) {
  const res = await fetch("/api/business/contracts", { method: body ? "POST" : "GET", cache: "no-store", ...(body && { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }) });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error || `Request failed (${res.status})`);
  return json;
}
const statusTone = (s: Contract["status"]) => (s === "review" ? "error" : s === "countersigned" ? "ok" : "muted");

export default function ContractsPanel({ prospects }: { prospects: Prospect[] }) {
  const [st, setSt] = useState<State | null>(null);
  const [open, setOpen] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState("");
  const [deals, setDeals] = useState<Deal[]>([]);
  const load = useCallback(() => call().then((j: State) => { setSt(j); setErr(""); }, (e: Error) => setErr(e.message)), []);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => { // great deals the hunter found: "Draft a purchase agreement" from one
    fetch("/api/markets/deals", { cache: "no-store" }).then((r) => r.json()).then((j: { offers?: Record<string, { id: string; title: string; great: boolean; seller: string; price: number; currency: string }[]> }) =>
      setDeals(Object.values(j.offers ?? {}).flat().filter((o) => o.great).map((o) => ({ id: o.id, label: `${o.title} · ${o.price} ${o.currency}${o.seller ? ` · ${o.seller}` : ""}` }))), () => {});
  }, []);
  const act = async (key: string, body: object) => {
    setBusy(key); setErr("");
    try { const c = await call(body); await load(); return c as Contract; } catch (e) { setErr((e as Error).message); return null; } finally { setBusy(""); }
  };
  const c = st?.contracts.find((x) => x.id === open);
  return (
    <section className="card space-y-2" aria-label="Contracts">
      <h3 className="text-[11px] uppercase tracking-widest muted">Contracts</h3>
      <p className="muted text-xs">{NOT_LEGAL_ADVICE} ORBIT never signs for you: you sign with your own click, and nothing is sent until you approve the email.</p>
      <NewContract prospects={prospects} deals={deals} busy={busy} onCreate={async (b) => { const n = await act("create", { action: "create", ...b }); if (n) setOpen(n.id); return !!n; }} />
      {err && <p className="error" role="alert">{err}</p>}
      {st && !st.contracts.length && <p className="muted text-xs">No contracts yet.</p>}
      <ul className="space-y-1">
        {st?.contracts.map((x) => (
          <li key={x.id}><button className="flex w-full flex-wrap items-baseline justify-between gap-2 text-left" aria-expanded={open === x.id} onClick={() => setOpen(open === x.id ? "" : x.id)}>
            <span><b>{x.title}</b><span className="muted"> · {current(x).fields.partyName || x.source?.label || "no party yet"} · v{current(x).n}</span></span>
            <span className={`chip ${statusTone(x.status)}`}>{STATUS_LABEL[x.status]}</span></button></li>))}
      </ul>
      {c && st && <Detail key={c.id + current(c).hash + c.updatedAt} c={c} canSend={st.canSend} busy={busy} act={act} />}
    </section>
  );
}

function NewContract({ prospects, deals, busy, onCreate }: { prospects: Prospect[]; deals: Deal[]; busy: string; onCreate: (b: object) => Promise<boolean> }) {
  const [show, setShow] = useState(false);
  const [tpl, setTpl] = useState<TemplateId>("service");
  const [src, setSrc] = useState("");
  const [fields, setFields] = useState<Fields>({});
  if (!show) return <button className="chip" onClick={() => setShow(true)}>📄 New contract</button>;
  const t = TEMPLATES[tpl];
  const source = src ? { kind: src.split(":")[0], id: src.slice(src.indexOf(":") + 1) } : undefined;
  const go = (ai: boolean) => onCreate({ template: tpl, fields, source, ai }).then((ok) => ok && (setShow(false), setFields({})));
  return (
    <form className="space-y-1.5 rounded-md border border-white/10 p-2" aria-label="New contract" onSubmit={(e) => { e.preventDefault(); void go(true); }}>
      <div className="flex flex-wrap gap-1.5">
        <select className="chip" aria-label="Template" value={tpl} onChange={(e) => setTpl(e.target.value as TemplateId)}>
          {TEMPLATE_IDS.map((id) => <option key={id} value={id}>{TEMPLATES[id].title}</option>)}</select>
        <select className="chip" aria-label="From" value={src} onChange={(e) => { setSrc(e.target.value); if (e.target.value.startsWith("deal:")) setTpl("purchase"); }}>
          <option value="">From: nothing (type it in)</option>
          {prospects.map((p) => <option key={p.id} value={`prospect:${p.id}`}>Client: {p.name}</option>)}
          {deals.map((d) => <option key={d.id} value={`deal:${d.id}`}>Deal: {d.label.slice(0, 70)}</option>)}
        </select>
      </div>
      <p className="muted text-xs">{t.blurb} Fill what you know; ORBIT fills only the blanks from the client or deal and may suggest clause wording (highlighted for you to check).</p>
      <FieldGrid t={tpl} f={fields} set={setFields} />
      <div className="flex flex-wrap gap-1.5">
        <button className="btn" disabled={!!busy}>{busy === "create" ? "ORBIT is drafting…" : "✍ Draft with ORBIT"}</button>
        <button type="button" className="chip" disabled={!!busy} onClick={() => void go(false)}>Use the template as is</button>
        <button type="button" className="chip" onClick={() => setShow(false)}>Close</button>
      </div>
    </form>
  );
}

function FieldGrid({ t, f, set, disabled }: { t: TemplateId; f: Fields; set: (f: Fields) => void; disabled?: boolean }) {
  return (
    <div className="grid gap-1.5 sm:grid-cols-2">
      {TEMPLATES[t].fields.map((x) => (
        <label key={x.key} className={`grid gap-0.5 text-xs ${x.long ? "sm:col-span-2" : ""}`}><span className="muted">{x.label}{x.required && " *"}</span>
          {x.options ? <select className="field" value={f[x.key] ?? x.def ?? ""} disabled={disabled} onChange={(e) => set({ ...f, [x.key]: e.target.value })}>{x.options.map((o) => <option key={o}>{o}</option>)}</select>
            : x.long ? <textarea className="field" rows={2} maxLength={2000} placeholder={x.def} value={f[x.key] ?? ""} disabled={disabled} onChange={(e) => set({ ...f, [x.key]: e.target.value })} />
              : <input className="field" maxLength={200} placeholder={x.def} value={f[x.key] ?? ""} disabled={disabled} onChange={(e) => set({ ...f, [x.key]: e.target.value })} />}
        </label>))}
    </div>
  );
}

function ClauseView({ c, i }: { c: VClause; i: number }) {
  return (
    <div className={changed(c) ? "rounded border-l-2 border-amber-400 pl-2" : ""}>
      <p className="font-semibold">{i + 1}. {c.heading}{changed(c) && <span className="chip ml-1 !text-[10px]">{c.by === "orbit" ? "ORBIT suggested" : "You changed"}</span>}</p>
      <p className="whitespace-pre-wrap">{changed(c) ? diffWords(c.base, c.text).map((p, k) => p.op === "same" ? <span key={k}>{p.text}</span>
        : p.op === "add" ? <ins key={k} className="bg-emerald-500/20 no-underline">{p.text}</ins> : <del key={k} className="bg-rose-500/20">{p.text}</del>) : c.text}</p>
      {c.why && <p className="muted text-[11px]">Why: {c.why}</p>}
    </div>
  );
}

function Detail({ c, canSend, busy, act }: { c: Contract; canSend: boolean; busy: string; act: (k: string, b: object) => Promise<Contract | null> }) {
  const v = current(c), editable = c.status === "draft" || c.status === "review";
  const [viewN, setViewN] = useState(v.n);
  const shown: Version = c.versions.find((x) => x.n === viewN) ?? v;
  const [fields, setFields] = useState<Fields>(v.fields);
  const [edits, setEdits] = useState<Record<string, string | null>>({});
  const [comment, setComment] = useState("");
  const [cover, setCover] = useState(c.cover);
  const [sure, setSure] = useState("");
  const twice = (k: string, run: () => void) => (sure === k ? (setSure(""), run()) : (setSure(k), setTimeout(() => setSure((s) => (s === k ? "" : s)), 5000)));
  const dirty = JSON.stringify(fields) !== JSON.stringify(v.fields) || Object.keys(edits).length > 0;
  const gaps = missing(TEMPLATES[c.template], fields);
  const to = emailIn(v.fields.partyEmail ?? "");
  return (
    <div className="space-y-2 rounded-md border border-white/10 p-2">
      <div className="flex flex-wrap items-center gap-1.5 text-xs">
        <span className={`chip ${statusTone(c.status)}`}>{STATUS_LABEL[c.status]}</span>
        <label className="flex items-center gap-1"><span className="muted">Version</span>
          <select className="chip" value={viewN} onChange={(e) => setViewN(Number(e.target.value))}>
            {[...c.versions].reverse().map((x) => <option key={x.n} value={x.n}>v{x.n} · {x.by === "orbit" ? "ORBIT" : "you"} · {x.at.slice(0, 16).replace("T", " ")} · {x.hash.slice(0, 10)}</option>)}</select></label>
        <code className="muted break-all" title="SHA-256 of this version's text">SHA-256 {shown.hash}</code>
      </div>
      <div className="grid gap-3 lg:grid-cols-2">
        <div className="space-y-2">
          <FieldGrid t={c.template} f={fields} set={setFields} disabled={!editable || viewN !== v.n} />
          {gaps.length > 0 && <p className="error text-xs">Still missing: {gaps.map((g) => g.label).join(", ")}</p>}
          {editable && viewN === v.n && (
            <details><summary className="cursor-pointer text-xs">Edit clause wording</summary>
              <div className="mt-1 space-y-1.5">{v.clauses.map((cl) => (
                <label key={cl.id} className="grid gap-0.5 text-xs"><span className="muted">{cl.heading}</span>
                  <textarea className="field" rows={3} maxLength={3000} value={edits[cl.id] ?? cl.text} onChange={(e) => setEdits({ ...edits, [cl.id]: e.target.value })} />
                  {changed(cl) && <button type="button" className="chip justify-self-start" onClick={() => setEdits({ ...edits, [cl.id]: null })}>Back to the template</button>}
                </label>))}</div></details>)}
          {editable && viewN === v.n && <button className="btn" disabled={!!busy || !dirty} onClick={() => void act("edit", { action: "edit", id: c.id, seen: v.hash, fields, clauses: edits })}>
            {busy === "edit" ? "Saving…" : "Save as new version"}</button>}
        </div>
        <article className="space-y-2 rounded bg-white/5 p-2 text-xs leading-relaxed" aria-label="Contract text">
          <h4 className="text-sm font-semibold">{c.title}</h4>
          {shown.clauses.map((cl, i) => <ClauseView key={cl.id} c={cl} i={i} />)}
        </article>
      </div>

      <div className="space-y-1">
        {c.comments.map((m, i) => <p key={i} className="text-xs"><span className="muted">v{m.n} · {m.at.slice(0, 16).replace("T", " ")}:</span> {m.text}</p>)}
        <form className="flex gap-1.5" onSubmit={async (e) => { e.preventDefault(); if (await act("comment", { action: "comment", id: c.id, text: comment })) setComment(""); }}>
          <input className="field flex-1" aria-label="Comment" placeholder="Note to self: what to ask, what to check…" maxLength={1000} value={comment} onChange={(e) => setComment(e.target.value)} />
          <button className="chip" disabled={!!busy || !comment.trim()}>Comment</button></form>
      </div>

      {c.status === "review" && !dirty && <SignBox name={v.fields.ownerName ?? ""} hash={v.hash} n={v.n} busy={busy === "sign"} onSign={(signature) => act("sign", { action: "sign", id: c.id, seen: v.hash, signature })} />}
      {c.status === "review" && dirty && <p className="muted text-xs">Save your changes first; you sign the saved version.</p>}

      {c.signed && (
        <div className="space-y-1.5 text-xs">
          <p>Signed by you on {c.signed.at.slice(0, 16).replace("T", " ")} UTC (v{c.signed.n}). <a className="underline" href={`/api/vault?file=${encodeURIComponent(c.signed.pdf)}&raw=1`} target="_blank" rel="noreferrer">Open the signed PDF</a> <span className="muted">(in VAULT; print it for the other party to sign and return)</span></p>
          {c.status === "signed" && (<>
            <textarea className="field w-full" rows={6} aria-label="Email to the other party" maxLength={4000} value={cover} onChange={(e) => setCover(e.target.value)} onBlur={() => { if (cover !== c.cover) void act("cover", { action: "cover", id: c.id, text: cover }); }} />
            <div className="flex flex-wrap items-center gap-1.5">
              {canSend && to ? <button className={`chip ${sure === "send" ? "ok" : ""}`} disabled={!!busy || cover !== c.cover} onClick={() => twice("send", () => void contentHash(contractSendContent(c)).then((seen) => act("send", { action: "send", id: c.id, seen })))}>
                {busy === "send" ? "Sending…" : sure === "send" ? `Click again to email the signed PDF to ${to}` : `✉ Approve & send to ${to}`}</button>
                : <span className="muted">{to ? "Sending from ORBIT isn't set up: download the PDF and email it yourself." : "Add the other party's email to send it from ORBIT, or email the PDF yourself."}</span>}
              <button className="chip" disabled={!!busy} onClick={() => twice("unsign", () => void act("unsign", { action: "unsign", id: c.id }))}>{sure === "unsign" ? "Click again to take your signature back" : "Take signature back"}</button>
            </div></>)}
          {c.sent && <p>Sent to {c.sent.to} on {c.sent.at.slice(0, 10)}.{c.sent.note && <span className="error"> {c.sent.note}</span>}</p>}
          {(c.status === "sent" || c.status === "signed") && <button className="chip" disabled={!!busy} onClick={() => twice("cs", () => void act("countersign", { action: "countersign", id: c.id, note: "" }))}>
            {sure === "cs" ? "Click again: they signed and you have their copy" : "Mark countersigned"}</button>}
          {c.countersigned && <p className="ok">Countersigned, marked by you on {c.countersigned.at.slice(0, 10)}. Save their signed copy in VAULT.</p>}
        </div>)}
      {c.status !== "countersigned" && c.status !== "cancelled" && <button className="chip" disabled={!!busy} onClick={() => twice("cancel", () => void act("cancel", { action: "cancel", id: c.id }))}>{sure === "cancel" ? "Click again to cancel this contract" : "Cancel contract"}</button>}
      <p className="muted text-[11px]">E-signature by the other party (a provider such as Dokobit or Smart-ID signing) is a future step and not connected: for now they sign the PDF and send it back.</p>
    </div>
  );
}

function SignBox({ name, hash, n, busy, onSign }: { name: string; hash: string; n: number; busy: boolean; onSign: (s: Signature) => Promise<unknown> }) {
  const [mode, setMode] = useState<"draw" | "type">("draw");
  const [typed, setTyped] = useState(name);
  const [read, setRead] = useState(false);
  const strokes = useRef<number[][]>([]);
  const cv = useRef<HTMLCanvasElement>(null);
  const [, redraw] = useState(0);
  const pos = (e: React.PointerEvent<HTMLCanvasElement>) => { const r = e.currentTarget.getBoundingClientRect(); return [Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)), Math.min(1, Math.max(0, (e.clientY - r.top) / r.height))]; };
  const paint = () => {
    const ctx = cv.current?.getContext("2d"), w = cv.current?.width ?? 0, h = cv.current?.height ?? 0;
    if (!ctx) return;
    ctx.clearRect(0, 0, w, h); ctx.strokeStyle = "#c7d2fe"; ctx.lineWidth = 2; ctx.lineCap = ctx.lineJoin = "round";
    for (const s of strokes.current) { ctx.beginPath(); for (let i = 0; i < s.length; i += 2) (i ? ctx.lineTo : ctx.moveTo).call(ctx, s[i] * w, s[i + 1] * h); ctx.stroke(); }
  };
  const sig: Signature = mode === "type" ? { kind: "typed", name: typed } : { kind: "drawn", strokes: strokes.current };
  const empty = mode === "type" ? typed.trim().length < 2 : strokes.current.reduce((a, s) => a + s.length / 2, 0) < 8;
  return (
    <div className="space-y-1.5 rounded-md border border-amber-400/40 p-2 text-xs" aria-label="Sign">
      <p><b>Sign version {n}</b> <span className="muted">· only you can sign; ORBIT never does.</span></p>
      <div className="flex gap-1" role="group" aria-label="Signature type">
        <button className="chip" aria-pressed={mode === "draw"} onClick={() => setMode("draw")}>Draw</button>
        <button className="chip" aria-pressed={mode === "type"} onClick={() => setMode("type")}>Type</button></div>
      {mode === "draw" ? (
        <div className="space-y-1">
          <canvas ref={cv} width={440} height={130} aria-label="Draw your signature here" className="w-full max-w-[440px] touch-none rounded border border-white/20 bg-white/5"
            onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); strokes.current.push(pos(e)); }}
            onPointerMove={(e) => { if (e.buttons !== 1 || !strokes.current.length) return; const s = strokes.current[strokes.current.length - 1]; if (s.length < 1200) s.push(...pos(e)); paint(); }}
            onPointerUp={() => redraw((x) => x + 1)} />
          <button className="chip" onClick={() => { strokes.current = []; paint(); redraw((x) => x + 1); }}>Clear</button>
        </div>
      ) : <input className="field font-serif italic" aria-label="Your name as signature" maxLength={80} value={typed} onChange={(e) => setTyped(e.target.value)} />}
      <label className="flex items-start gap-1.5"><input type="checkbox" checked={read} onChange={(e) => setRead(e.target.checked)} />
        <span>I have read version {n} (SHA-256 {hash.slice(0, 12)}…) and I sign it.</span></label>
      <button className="btn" disabled={busy || !read || empty} onClick={() => void onSign({ ...sig, ...(sig.kind === "drawn" && { strokes: sig.strokes.filter((s) => s.length >= 4) }) } as Signature)}>
        {busy ? "Signing…" : "✍ Sign"}</button>
    </div>
  );
}
