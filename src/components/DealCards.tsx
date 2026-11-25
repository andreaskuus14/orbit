"use client";
import { useCallback, useEffect, useState } from "react";
import { pollMs } from "@/lib/poll-pure";
import { usePoll } from "./use-poll";
import type { Offer, Wish } from "@/lib/deals-pure";
import NegotiatorBox from "./NegotiatorBox";
import { getDeals } from "./deals-client";
import { useT } from "./i18n";

// MARKETS → Deals: his wishlist and what the deal hunter found on public listings and shops (read-only). ORBIT never contacts a
// seller or buys: the message draft is for him to copy and send himself.
type Board = {
  wishes: Wish[]; offers: Record<string, Offer[]>; drafts: Record<string, string>;
  history: Record<string, { low: { day: string; eur: number }[]; median: { median: number; n: number } | null }>;
  hunted: Record<string, string>; lastHunt: string | null; lastError: string | null; busy: boolean; callsLeft: number;
};

async function call(body?: object) {
  if (!body) return getDeals();
  const res = await fetch("/api/markets/deals", { method: body ? "POST" : "GET", cache: "no-store", ...(body && { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }) });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error || `Request failed (${res.status})`);
  return json;
}
const eur = (n: number) => `€${n % 1 ? n.toFixed(2) : n}`;
const when = (s: string | null | undefined, never: string) => (s ? new Date(s).toLocaleString(undefined, { dateStyle: "short", timeStyle: "short" }) : never);

export default function DealCards() {
  const { t } = useT();
  const [b, setB] = useState<Board | null>(null);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState("");
  const load = useCallback(() => call().then((j: Board) => { setB(j); setErr(""); }, (e: Error) => setErr(e.message)), []);
  useEffect(() => { void load(); }, [load]);
  usePoll(load, pollMs(5000, "live"), !!b?.busy); // a scout/hunt runs minutes: refresh until done, only while on screen
  const act = async (key: string, body: object) => {
    setBusy(key); setErr("");
    try { await call(body); return true; } catch (e) { setErr((e as Error).message); return false; } finally { setBusy(""); await load(); }
  };
  const any = !!busy || !!b?.busy;
  return (
    <section className="space-y-2" aria-label={t("dl.hunter")}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-[12px] font-medium muted">{t("dl.head")}</h3>
        <button className="chip" disabled={any || !b?.wishes.length} onClick={() => void act("hunt", { action: "hunt" })}>{b?.busy ? t("dl.hunting") : t("dl.huntNow")}</button>
      </div>
      {b && <p className="muted text-xs">{t("dl.help", { n: b.callsLeft, at: when(b.lastHunt, t("dl.never")) })}</p>}
      {b?.lastError && !b.busy && <p className="muted text-xs">{t("dl.lastProblem", { err: b.lastError })}</p>}
      {err && <p className="error" role="alert">{err}</p>}
      <WishForm disabled={!!busy} add={(w) => act("add", { action: "add", ...w })} />
      {b && !b.wishes.length && <p className="muted text-xs">{t("dl.empty")}</p>}
      <ul className="space-y-2">
        {b?.wishes.map((w) => <WishCard key={w.id} w={w} b={b} any={any} act={act} />)}
      </ul>
    </section>
  );
}

function WishForm({ disabled, add }: { disabled: boolean; add: (w: Record<string, string>) => Promise<boolean> }) {
  const { t } = useT();
  const empty = { item: "", maxPrice: "", targetPrice: "", condition: "any", region: "Estonia / EU", deadline: "", notes: "" };
  const [f, setF] = useState(empty);
  const set = (k: keyof typeof empty) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  return (
    <form className="card grid gap-1.5 text-xs sm:grid-cols-2" onSubmit={async (e) => { e.preventDefault(); if (await add(f)) setF(empty); }}>
      <label className="sm:col-span-2">{t("dl.want")}<input className="field w-full" required maxLength={120} value={f.item} onChange={set("item")} placeholder={"RTX 4070"} /></label>
      <label>{t("dl.max")}<input className="field w-full" required inputMode="decimal" value={f.maxPrice} onChange={set("maxPrice")} placeholder="400" /></label>
      <label>{t("dl.target")}<input className="field w-full" inputMode="decimal" value={f.targetPrice} onChange={set("targetPrice")} placeholder="350" /></label>
      <label>{t("dl.condition")}<select className="field w-full" value={f.condition} onChange={set("condition")}><option value="any">{t("dl.any")}</option><option value="used">{t("dl.used")}</option><option value="new">{t("dl.new")}</option></select></label>
      <label>{t("dl.region")}<input className="field w-full" maxLength={60} value={f.region} onChange={set("region")} /></label>
      <label>{t("dl.deadline")}<input className="field w-full" type="date" value={f.deadline} onChange={set("deadline")} /></label>
      <label>{t("dl.notes")}<input className="field w-full" maxLength={300} value={f.notes} onChange={set("notes")} placeholder={t("dl.notesPh")} /></label>
      <div className="sm:col-span-2"><button className="chip" type="submit" disabled={disabled}>{t("dl.addWish")}</button></div>
    </form>
  );
}

function WishCard({ w, b, any, act }: { w: Wish; b: Board; any: boolean; act: (k: string, body: object) => Promise<boolean> }) {
  const { t } = useT();
  const offers = b.offers[w.id] ?? [], h = b.history[w.id];
  const low = h?.low ?? [], max = Math.max(...low.map((x) => x.eur), 1);
  const past = !!w.deadline && Date.parse(w.deadline) + 86_400_000 <= Date.now();
  return (
    <li className="card space-y-1.5" aria-label={w.item}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div className="min-w-0"><b>{w.item}</b>
          <div className="muted text-xs">{t("dl.maxV", { v: eur(w.maxPrice) })}{w.targetPrice !== null && ` · ${t("dl.targetV", { v: eur(w.targetPrice) })}`} · {w.condition === "any" ? t("dl.anyLow") : w.condition === "used" ? t("dl.usedLow") : t("dl.newLow")} · {w.region}
            {w.deadline && ` · ${t("dl.until", { d: w.deadline })}${past ? ` ${t("dl.passed")}` : ""}`}{w.notes && ` · ${w.notes}`}</div>
          <div className="muted text-xs">{t("dl.checked", { at: when(b.hunted[w.id], t("dl.never")) })}{h?.median && ` · ${t("dl.median", { v: eur(h.median.median), n: h.median.n })}`}</div>
        </div>
        <div className="flex gap-1.5">
          <button className="chip" disabled={any} onClick={() => void act(`done:${w.id}`, { action: "done", id: w.id })} title={t("dl.gotTip")}>{t("dl.got")}</button>
          <button className="chip" disabled={any} onClick={() => void act(`rm:${w.id}`, { action: "remove", id: w.id })}>{t("common.remove")}</button>
        </div>
      </div>
      {low.length > 1 && (
        <div className="flex h-8 items-end gap-px" role="img" aria-label={t("dl.lowest", { list: low.map((x) => `${x.day} ${eur(x.eur)}`).join(", ") })}>
          {low.map((x) => <span key={x.day} title={`${x.day}: ${eur(x.eur)}`} className="flex-1 rounded-sm bg-emerald-400/60" style={{ height: `${Math.max(8, (x.eur / max) * 100)}%` }} />)}
        </div>
      )}
      {!offers.length ? <p className="muted text-xs">{t("dl.noOffers")}</p> : (
        <ul className="space-y-1.5">{offers.slice(0, 6).map((o) => <OfferRow key={o.id} o={o} draft={b.drafts[o.id]} any={any} dismiss={() => void act(`x:${o.id}`, { action: "dismiss", id: w.id, offer: o.id })} />)}</ul>
      )}
    </li>
  );
}

function OfferRow({ o, draft, any, dismiss }: { o: Offer; draft?: string; any: boolean; dismiss: () => void }) {
  const { t } = useT();
  const [copied, setCopied] = useState(false);
  return (
    <li className={`rounded-md border p-2 text-xs ${o.great ? "border-emerald-400/60" : "border-white/10"}`}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="min-w-0">{o.great && <span className="chip mr-1.5">{t("dl.great")}</span>}<a className="underline break-all" href={o.url} target="_blank" rel="noreferrer noopener">{o.title}</a></span>
        <b className="num">{o.currency === "EUR" ? eur(o.eur) : `≈${eur(o.eur)} (${o.price} ${o.currency})`}</b>
      </div>
      <div className="muted">{o.condition} · {o.seller ? `${t("dl.sellerOn", { s: o.seller })} ` : ""}{o.site} · {t("dl.score", { n: o.score })} · {t("dl.seen", { at: when(o.seenAt, t("dl.never")) })}</div>
      {o.why.length > 0 && <div>{o.why.join(" · ")}</div>}
      {o.risks.length > 0 && <div className="error">{t("dl.watch")} {o.risks.join(" · ")}</div>}
      {draft && (
        <details>
          <summary className="cursor-pointer">{t("dl.msg")}</summary>
          <p className="select-all whitespace-pre-wrap">{draft}</p>
          <button className="chip" onClick={() => void navigator.clipboard?.writeText(draft).then(() => setCopied(true), () => {})}>{copied ? t("common.copied") : t("common.copy")}</button>
        </details>
      )}
      <div className="mt-1 flex flex-wrap gap-1.5"><button className="chip" disabled={any} onClick={dismiss}>{t("dl.notInterested")}</button>
        <NegotiatorBox refKey={`offer:${o.id}`} title={o.title} hint={{ floor: Math.round(o.eur * 0.85), ceiling: Math.round(o.eur) }} /></div>
    </li>
  );
}
