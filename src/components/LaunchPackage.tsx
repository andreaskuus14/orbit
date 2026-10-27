"use client";
import { useCallback, useEffect, useState } from "react";
import { PLATFORMS, PRO_NOTE, type LaunchPackage as Pkg, type Platform } from "@/lib/launch-pure";

// BUSINESS → Niches → Launch package (roadmap B5): import files for the platform you pick, made on this PC. You import and publish yourself.
const NAMES: Record<Platform, string> = { shopify: "Shopify", woocommerce: "WooCommerce", etsy: "Etsy" };
const eur = (n: number) => `€${n.toFixed(2)}`;

async function call(id: string, body?: object) {
  const res = await fetch(`/api/business/launch/${id}`, { method: body ? "POST" : "GET", cache: "no-store", ...(body && { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }) });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error || `Request failed (${res.status})`);
  return json;
}

export default function LaunchPackage({ id }: { id: string }) {
  const [launches, setLaunches] = useState<Partial<Record<Platform, Pkg>>>({});
  const [platform, setPlatform] = useState<Platform>("shopify");
  const [busy, setBusy] = useState("");
  const [msg, setMsg] = useState("");
  const load = useCallback(() => call(id).then((j) => setLaunches(j.launches ?? {}), (e: Error) => setMsg(e.message)), [id]);
  useEffect(() => { void load(); }, [load]);
  const act = async (key: string, body: object, done: string) => {
    setBusy(key); setMsg("");
    try { await call(id, body); setMsg(done); } catch (e) { setMsg((e as Error).message); } finally { setBusy(""); await load(); }
  };
  const p = launches[platform];
  const file = (f: string) => `/api/business/launch/${id}?platform=${platform}&file=${encodeURIComponent(f)}`;
  return (
    <section className="space-y-2 rounded-md border border-white/10 p-2 text-xs" aria-label="Launch package">
      <div className="flex flex-wrap items-center gap-1.5">
        <b className="mr-1">Launch package</b>
        {PLATFORMS.map((x) => <button key={x} className="chip" aria-pressed={platform === x} onClick={() => setPlatform(x)}>{NAMES[x]}{launches[x] ? " ✓" : ""}</button>)}
        <button className="chip" disabled={!!busy} onClick={() => void act("build", { action: "build", platform }, "")}>
          {busy === "build" ? "Preparing… (checking the format doc)" : p ? `Rebuild for ${NAMES[platform]}` : `Prepare for ${NAMES[platform]}`}</button>
      </div>
      {msg && <p className="muted" role="status">{msg}</p>}
      {p && <>
        <p className="muted">Format checked against <a className="underline break-all" href={p.doc.url} target="_blank" rel="noreferrer noopener">{p.doc.url}</a> on {new Date(p.doc.at).toLocaleDateString()}:{" "}
          {p.doc.error ? `couldn't fetch it (${p.doc.error}); columns are as read on 2026-10-26.` : p.doc.ok ? "every column name is still on the page." : <span className="error">not on the page now: {p.doc.missing.join(", ")}. Check before importing.</span>}</p>
        <p>Download: {p.files.map((f, i) => <span key={f}>{i > 0 && " · "}<a className="underline" href={file(f)}>{f}</a></span>)}. Everything imports as draft; nothing was uploaded or published.</p>
        <table className="w-full text-left"><thead><tr className="muted"><th>Product</th><th>Pack</th><th className="num">Price</th><th className="num">Profit/order</th></tr></thead>
          <tbody>{p.products.flatMap((x) => x.variants.map((v) => <tr key={x.handle + v.option}><td>{x.name}</td><td>{v.option}</td><td className="num">{eur(v.price)}</td>
            <td className={`num ${v.profit > 0 ? "ok" : "error"}`}>{eur(v.profit)} ({v.pct}%){v.raised && <span className="muted" title="Raised to keep a 20 % margin"> ↑</span>}</td></tr>))}</tbody></table>
        <details><summary className="cursor-pointer"><b>SEO</b></summary>
          {p.products.map((x) => <div key={x.handle} className="mt-1"><b>{x.name}</b><div className="select-all">{x.seo.title}</div><div className="select-all muted">{x.seo.description}</div><div className="select-all muted">{x.seo.tags.join(", ")}</div></div>)}</details>
        <details><summary className="cursor-pointer"><b>Image prompts</b> ({p.images.length})</summary>
          <p className="muted">Get Higgsfield quote only asks the price: approve (or not) in STUDIO → Clip Factory → AI Story.</p>
          <ul className="space-y-1">{p.images.map((im, i) => <li key={im.label}><b>{im.label}</b> <span className="muted">({im.aspect})</span> <span className="select-all">{im.prompt}</span>{" "}
            <button className="chip" disabled={!!busy} onClick={() => void act(`q${i}`, { action: "quote", platform, index: i }, "Quote requested: approve it in STUDIO → AI Story if the price is right.")}>{busy === `q${i}` ? "Asking…" : "Get Higgsfield quote"}</button></li>)}</ul></details>
        <details><summary className="cursor-pointer"><b>Launch checklist</b> ({p.checklist.length})</summary><ol className="list-decimal pl-5">{p.checklist.map((c) => <li key={c}>{c}</li>)}</ol></details>
        <details><summary className="cursor-pointer"><b>14-day plan</b> (drafts: ORBIT never posts)</summary>
          <ol className="space-y-1">{p.plan.map((d) => <li key={d.day}><b>Day {d.day}: {d.goal}</b> <span className="muted">· {d.channel}</span><div className="select-all">{d.post}</div></li>)}</ol></details>
        <p className="muted">Shipping and returns: <a className="underline" href={file("policies.md")}>policies.md</a> (EU 14-day withdrawal, 2-year guarantee). {PRO_NOTE}</p>
      </>}
    </section>
  );
}
