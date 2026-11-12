"use client";
import { OrbitThinks } from "./OrbitThinks";
import RivalsBox from "./RivalsBox";
import ComplaintsBox from "./ComplaintsBox";
import WhatIf from "./WhatIf";
import { useCallback, useEffect, useState } from "react";
import { pollMs } from "@/lib/poll-pure";
import { usePoll } from "./use-poll";
import { marginOf, type Kit, type Niche } from "@/lib/niche-pure";
import LaunchPackage from "./LaunchPackage";

// BUSINESS niche scout cards (weekly, or "Scout now") and shop-in-a-box. Everything stays on this PC: you publish a shop yourself.
type Board = { niches: Niche[]; kits: Record<string, Kit | null>; lastOk: string | null; lastAttempt: string | null; lastError: string | null; busy: string | null; dir: string };

async function call(body?: object) {
  const res = await fetch("/api/business/niches", { method: body ? "POST" : "GET", cache: "no-store", ...(body && { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }) });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error || `Request failed (${res.status})`);
  return json;
}
const eur = (n: number) => `€${n.toFixed(2)}`;
const day = (s: string | null) => (s ? new Date(s).toLocaleDateString() : "never");

export default function NicheCards() {
  const [b, setB] = useState<Board | null>(null);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState("");
  const load = useCallback(() => call().then((j: Board) => { setB(j); setErr(""); }, (e: Error) => setErr(e.message)), []);
  useEffect(() => { void load(); }, [load]);
  usePoll(load, pollMs(5000, "live"), !!b?.busy); // a scout/hunt runs minutes: refresh until done, only while on screen
  const act = async (key: string, body: object) => {
    setBusy(key); setErr("");
    try { await call(body); } catch (e) { setErr((e as Error).message); } finally { setBusy(""); await load(); }
  };
  const any = !!busy || !!b?.busy;
  return (
    <section className="space-y-2" aria-label="Webshop niche ideas">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-[11px] uppercase tracking-widest muted">Webshop niches · weekly scout</h3>
        <button className="chip" disabled={any} onClick={() => void act("scout", { action: "scout" })}>{b?.busy === "scout" ? "Scouting the web… (a few minutes)" : "Scout now"}</button>
      </div>
      {b && <p className="muted text-xs">Last run {day(b.lastOk)}. Ideas need 2+ links CORE really read; margins are estimates, check them before spending.</p>}
      {b?.lastError && !b.busy && <p className="muted text-xs">Last attempt: {b.lastError}</p>}
      {err && <p className="error" role="alert">{err}</p>}
      {b && !b.niches.length && !b.busy && <p className="muted text-xs">No ideas yet. The scout runs once a week by itself, or click Scout now.</p>}
      <ul className="space-y-2">
        {b?.niches.map((n) => <Card key={n.id} n={n} kit={b.kits[n.id] ?? null} dir={b.dir} busy={busy} building={b.busy === `shop:${n.id}`} any={any} act={act} />)}
      </ul>
    </section>
  );
}

function Card({ n, kit, dir, busy, building, any, act }: { n: Niche; kit: Kit | null; dir: string; busy: string; building: boolean; any: boolean; act: (k: string, b: object) => Promise<void> }) {
  const [open, setOpen] = useState(false);
  const [sim, setSim] = useState(false);
  const m = marginOf(n.margin);
  const sep = dir.includes("\\") ? "\\" : "/";
  return (
    <li className="card space-y-1.5" aria-label={n.title}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div className="min-w-0"><b>{n.title}</b>{n.status === "kept" && <span className="chip ml-1.5">Kept</span>}<div className="muted text-xs">{n.product}{n.audience && ` · for ${n.audience}`}</div></div>
        <span className="num text-lg font-semibold" title="Score: demand, competition, fit and margin">{n.score}</span>
      </div>
      <dl className="grid gap-x-3 gap-y-1 text-xs sm:grid-cols-[auto_1fr]">
        <dt className="muted">Demand {n.demandScore}/5</dt><dd>{n.demand}</dd>
        <dt className="muted">Competition {n.competitionScore}/5</dt><dd>{n.competition}</dd>
        <dt className="muted">Margin</dt>
        <dd><span className="num">{eur(n.margin.price)}</span> price − <span className="num">{eur(n.margin.cogs)}</span> product − <span className="num">{eur(n.margin.shipping)}</span> shipping − <span className="num">{Math.round(n.margin.feePct * 100)}%</span> fees − <span className="num">{eur(n.margin.cac)}</span> ads
          = <b className={m.unit > 0 ? "ok" : "error"}>{eur(m.unit)} ({m.pct}%)</b> per order{n.assumptions && <span className="muted"> · {n.assumptions}</span>}</dd>
        <dt className="muted">Risks</dt><dd>{n.risks.join(" · ")}</dd>
        <dt className="muted">Why you</dt><dd>{n.fit}</dd>
        <dt className="muted">Evidence</dt>
        <dd><ul>{n.evidence.map((e) => <li key={e.url} className="break-all"><a className="underline" href={e.url} target="_blank" rel="noreferrer noopener">{e.title}</a>
          <span className="muted"> · {e.opened ? "read" : "in search results"}</span></li>)}</ul></dd>
      </dl>
      <div className="flex flex-wrap gap-1.5">
        {n.status !== "kept" && <button className="chip" disabled={any} onClick={() => void act(`keep:${n.id}`, { action: "keep", id: n.id })}>Keep</button>}
        <button className="chip" disabled={any} onClick={() => void act(`dismiss:${n.id}`, { action: "dismiss", id: n.id })}>Dismiss</button>
        {n.status === "new" && <OrbitThinks id={`niche:${n.id}`} />}
        {n.status === "kept" && <button className="chip" disabled={any} onClick={() => void act(`build:${n.id}`, { action: "build", id: n.id })}>
          {building || busy === `build:${n.id}` ? "CORE is writing the shop…" : n.shopAt ? "Rebuild shop" : "Build shop"}</button>}
        <button className="chip" aria-expanded={sim} onClick={() => setSim(!sim)}>{sim ? "Hide what-if" : "What if…"}</button>
        {kit && <button className="chip" aria-expanded={open} onClick={() => setOpen(!open)}>{open ? "Hide shop" : "Show shop"}</button>}
      </div>
      {n.status === "kept" && <RivalsBox id={n.id} />}
      {n.status === "kept" && <ComplaintsBox id={n.id} />}
      {sim && <WhatIf margin={n.margin} />}
      {kit && open && (
        <div className="space-y-2 rounded-md border border-white/10 p-2">
          <iframe title={`Preview of ${kit.brand}`} sandbox="" src={`/api/business/shop/${n.id}?v=${encodeURIComponent(n.shopAt ?? "")}`} className="h-[420px] w-full rounded bg-white" />
          <p className="muted text-xs">Saved on this PC in <code className="select-all break-all">{`${dir}${sep}shops${sep}${n.id}`}</code> (index.html, launch-kit.md). <a className="underline" href={`/api/business/shop/${n.id}?download=1`}>Download HTML</a>.
            Nothing was published: replace <code>#checkout</code> with your checkout link, then publish it yourself.</p>
          <div className="text-xs"><b>Ad hooks</b><ol className="list-decimal pl-5">{kit.hooks.map((h) => <li key={h} className="select-all">{h}</li>)}</ol></div>
          <details className="text-xs"><summary className="cursor-pointer"><b>Launch checklist</b> ({kit.checklist.length} steps)</summary><ol className="list-decimal pl-5">{kit.checklist.map((c) => <li key={c}>{c}</li>)}</ol></details>
          <details className="text-xs"><summary className="cursor-pointer"><b>Product descriptions</b></summary>
            {kit.products.map((p) => <p key={p.name} className="select-all"><b>{p.name}</b> ({eur(p.price)}): {p.description}</p>)}</details>
          <LaunchPackage id={n.id} />
        </div>
      )}
    </li>
  );
}
