"use client";
import { useCallback, useEffect, useState } from "react";
import type { Offer, Wish } from "@/lib/deals-pure";
import NegotiatorBox from "./NegotiatorBox";

// MARKETS → Deals: his wishlist and what the deal hunter found on public listings and shops (read-only). ORBIT never contacts a
// seller or buys: the message draft is for him to copy and send himself.
type Board = {
  wishes: Wish[]; offers: Record<string, Offer[]>; drafts: Record<string, string>;
  history: Record<string, { low: { day: string; eur: number }[]; median: { median: number; n: number } | null }>;
  hunted: Record<string, string>; lastHunt: string | null; lastError: string | null; busy: boolean; callsLeft: number;
};

async function call(body?: object) {
  const res = await fetch("/api/markets/deals", { method: body ? "POST" : "GET", cache: "no-store", ...(body && { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }) });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error || `Request failed (${res.status})`);
  return json;
}
const eur = (n: number) => `€${n % 1 ? n.toFixed(2) : n}`;
const when = (s: string | null | undefined) => (s ? new Date(s).toLocaleString(undefined, { dateStyle: "short", timeStyle: "short" }) : "never");

export default function DealCards() {
  const [b, setB] = useState<Board | null>(null);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState("");
  const load = useCallback(() => call().then((j: Board) => { setB(j); setErr(""); }, (e: Error) => setErr(e.message)), []);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => { // a hunt takes minutes: refresh until it's done
    if (!b?.busy) return;
    const t = setInterval(() => void load(), 5000);
    return () => clearInterval(t);
  }, [b?.busy, load]);
  const act = async (key: string, body: object) => {
    setBusy(key); setErr("");
    try { await call(body); return true; } catch (e) { setErr((e as Error).message); return false; } finally { setBusy(""); await load(); }
  };
  const any = !!busy || !!b?.busy;
  return (
    <section className="space-y-2" aria-label="Deal hunter">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-[11px] uppercase tracking-widest muted">Wishlist · deal hunter</h3>
        <button className="chip" disabled={any || !b?.wishes.length} onClick={() => void act("hunt", { action: "hunt" })}>{b?.busy ? "Hunting… (a few minutes)" : "Hunt now"}</button>
      </div>
      {b && <p className="muted text-xs">Checks public listings and shops every 6 h in the daytime and once at night (read-only, {b.callsLeft} searches left today). Last hunt {when(b.lastHunt)}. Only pages ORBIT really opened count; it never contacts sellers or buys.</p>}
      {b?.lastError && !b.busy && <p className="muted text-xs">Last problem: {b.lastError}</p>}
      {err && <p className="error" role="alert">{err}</p>}
      <WishForm disabled={!!busy} add={(w) => act("add", { action: "add", ...w })} />
      {b && !b.wishes.length && <p className="muted text-xs">Nothing on the wishlist yet. Add something above, or tell CORE “I want a used RTX 4070 under 400€”.</p>}
      <ul className="space-y-2">
        {b?.wishes.map((w) => <WishCard key={w.id} w={w} b={b} any={any} act={act} />)}
      </ul>
    </section>
  );
}

function WishForm({ disabled, add }: { disabled: boolean; add: (w: Record<string, string>) => Promise<boolean> }) {
  const empty = { item: "", maxPrice: "", targetPrice: "", condition: "any", region: "Estonia / EU", deadline: "", notes: "" };
  const [f, setF] = useState(empty);
  const set = (k: keyof typeof empty) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  return (
    <form className="card grid gap-1.5 text-xs sm:grid-cols-2" onSubmit={async (e) => { e.preventDefault(); if (await add(f)) setF(empty); }}>
      <label className="sm:col-span-2">What you want<input className="field w-full" required maxLength={120} value={f.item} onChange={set("item")} placeholder="RTX 4070" /></label>
      <label>Max price (€)<input className="field w-full" required inputMode="decimal" value={f.maxPrice} onChange={set("maxPrice")} placeholder="400" /></label>
      <label>Target price (€, optional)<input className="field w-full" inputMode="decimal" value={f.targetPrice} onChange={set("targetPrice")} placeholder="350" /></label>
      <label>Condition<select className="field w-full" value={f.condition} onChange={set("condition")}><option value="any">New or used</option><option value="used">Used is fine</option><option value="new">New only</option></select></label>
      <label>Region<input className="field w-full" maxLength={60} value={f.region} onChange={set("region")} /></label>
      <label>Deadline (optional)<input className="field w-full" type="date" value={f.deadline} onChange={set("deadline")} /></label>
      <label>Notes<input className="field w-full" maxLength={300} value={f.notes} onChange={set("notes")} placeholder="12 GB, no mining cards" /></label>
      <div className="sm:col-span-2"><button className="chip" type="submit" disabled={disabled}>Add to wishlist</button></div>
    </form>
  );
}

function WishCard({ w, b, any, act }: { w: Wish; b: Board; any: boolean; act: (k: string, body: object) => Promise<boolean> }) {
  const offers = b.offers[w.id] ?? [], h = b.history[w.id];
  const low = h?.low ?? [], max = Math.max(...low.map((x) => x.eur), 1);
  const past = !!w.deadline && Date.parse(w.deadline) + 86_400_000 <= Date.now();
  return (
    <li className="card space-y-1.5" aria-label={w.item}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div className="min-w-0"><b>{w.item}</b>
          <div className="muted text-xs">max {eur(w.maxPrice)}{w.targetPrice !== null && ` · target ${eur(w.targetPrice)}`} · {w.condition === "any" ? "new or used" : w.condition} · {w.region}
            {w.deadline && ` · until ${w.deadline}${past ? " (passed: no longer hunted)" : ""}`}{w.notes && ` · ${w.notes}`}</div>
          <div className="muted text-xs">Checked {when(b.hunted[w.id])}{h?.median && ` · recent median ${eur(h.median.median)} from ${h.median.n} listings`}</div>
        </div>
        <div className="flex gap-1.5">
          <button className="chip" disabled={any} onClick={() => void act(`done:${w.id}`, { action: "done", id: w.id })} title="Bought it: stop hunting">Got it</button>
          <button className="chip" disabled={any} onClick={() => void act(`rm:${w.id}`, { action: "remove", id: w.id })}>Remove</button>
        </div>
      </div>
      {low.length > 1 && (
        <div className="flex h-8 items-end gap-px" role="img" aria-label={`Lowest price per day: ${low.map((x) => `${x.day} ${eur(x.eur)}`).join(", ")}`}>
          {low.map((x) => <span key={x.day} title={`${x.day}: ${eur(x.eur)}`} className="flex-1 rounded-sm bg-emerald-400/60" style={{ height: `${Math.max(8, (x.eur / max) * 100)}%` }} />)}
        </div>
      )}
      {!offers.length ? <p className="muted text-xs">No offers yet.</p> : (
        <ul className="space-y-1.5">{offers.slice(0, 6).map((o) => <OfferRow key={o.id} o={o} draft={b.drafts[o.id]} any={any} dismiss={() => void act(`x:${o.id}`, { action: "dismiss", id: w.id, offer: o.id })} />)}</ul>
      )}
    </li>
  );
}

function OfferRow({ o, draft, any, dismiss }: { o: Offer; draft?: string; any: boolean; dismiss: () => void }) {
  const [copied, setCopied] = useState(false);
  return (
    <li className={`rounded-md border p-2 text-xs ${o.great ? "border-emerald-400/60" : "border-white/10"}`}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="min-w-0">{o.great && <span className="chip mr-1.5">Great deal</span>}<a className="underline break-all" href={o.url} target="_blank" rel="noreferrer noopener">{o.title}</a></span>
        <b className="num">{o.currency === "EUR" ? eur(o.eur) : `≈${eur(o.eur)} (${o.price} ${o.currency})`}</b>
      </div>
      <div className="muted">{o.condition} · {o.seller ? `${o.seller} on ` : ""}{o.site} · score {o.score} · seen {when(o.seenAt)}</div>
      {o.why.length > 0 && <div>{o.why.join(" · ")}</div>}
      {o.risks.length > 0 && <div className="error">Watch out: {o.risks.join(" · ")}</div>}
      {draft && (
        <details>
          <summary className="cursor-pointer">Message to the seller (you send it)</summary>
          <p className="select-all whitespace-pre-wrap">{draft}</p>
          <button className="chip" onClick={() => void navigator.clipboard?.writeText(draft).then(() => setCopied(true), () => {})}>{copied ? "Copied" : "Copy"}</button>
        </details>
      )}
      <div className="mt-1 flex flex-wrap gap-1.5"><button className="chip" disabled={any} onClick={dismiss}>Not interested</button>
        <NegotiatorBox refKey={`offer:${o.id}`} title={o.title} hint={{ floor: Math.round(o.eur * 0.85), ceiling: Math.round(o.eur) }} /></div>
    </li>
  );
}
