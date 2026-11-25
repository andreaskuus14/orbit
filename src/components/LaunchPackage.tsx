"use client";
import { useCallback, useEffect, useState } from "react";
import { PLATFORMS, PRO_NOTE, type LaunchPackage as Pkg, type Platform } from "@/lib/launch-pure";
import { useT } from "./i18n";

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
  const { t } = useT();
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
    <section className="space-y-2 rounded-md border border-white/10 p-2 text-xs" aria-label={t("lpk.title")}>
      <div className="flex flex-wrap items-center gap-1.5">
        <b className="mr-1">{t("lpk.title")}</b>
        {PLATFORMS.map((x) => <button key={x} className="chip" aria-pressed={platform === x} onClick={() => setPlatform(x)}>{NAMES[x]}{launches[x] ? " ✓" : ""}</button>)}
        <button className="chip" disabled={!!busy} onClick={() => void act("build", { action: "build", platform }, "")}>
          {busy === "build" ? t("lpk.preparing") : p ? t("lpk.rebuild", { p: NAMES[platform] }) : t("lpk.prepare", { p: NAMES[platform] })}</button>
      </div>
      {msg && <p className="muted" role="status">{msg}</p>}
      {p && <>
        <p className="muted">{t("lpk.checked")} <a className="underline break-all" href={p.doc.url} target="_blank" rel="noreferrer noopener">{p.doc.url}</a> {t("lpk.on", { d: new Date(p.doc.at).toLocaleDateString() })}{" "}
          {p.doc.error ? t("lpk.fetchErr", { e: p.doc.error }) : p.doc.ok ? t("lpk.docOk") : <span className="error">{t("lpk.missing", { list: p.doc.missing.join(", ") })}</span>}</p>
        <p>{t("lpk.download")} {p.files.map((f, i) => <span key={f}>{i > 0 && " · "}<a className="underline" href={file(f)}>{f}</a></span>)}. {t("lpk.draftNote")}</p>
        <table className="w-full text-left"><thead><tr className="muted"><th>{t("lpk.product")}</th><th>{t("lpk.pack")}</th><th className="num">{t("lpk.price")}</th><th className="num">{t("lpk.profit")}</th></tr></thead>
          <tbody>{p.products.flatMap((x) => x.variants.map((v) => <tr key={x.handle + v.option}><td>{x.name}</td><td>{v.option}</td><td className="num">{eur(v.price)}</td>
            <td className={`num ${v.profit > 0 ? "ok" : "error"}`}>{eur(v.profit)} ({v.pct}%){v.raised && <span className="muted" title={t("lpk.raised")}> ↑</span>}</td></tr>))}</tbody></table>
        <details><summary className="cursor-pointer"><b>SEO</b></summary>
          {p.products.map((x) => <div key={x.handle} className="mt-1"><b>{x.name}</b><div className="select-all">{x.seo.title}</div><div className="select-all muted">{x.seo.description}</div><div className="select-all muted">{x.seo.tags.join(", ")}</div></div>)}</details>
        <details><summary className="cursor-pointer"><b>{t("lpk.images")}</b> ({p.images.length})</summary>
          <p className="muted">{t("lpk.quoteNote")}</p>
          <ul className="space-y-1">{p.images.map((im, i) => <li key={im.label}><b>{im.label}</b> <span className="muted">({im.aspect})</span> <span className="select-all">{im.prompt}</span>{" "}
            <button className="chip" disabled={!!busy} onClick={() => void act(`q${i}`, { action: "quote", platform, index: i }, t("lpk.quoted"))}>{busy === `q${i}` ? t("lpk.asking") : t("lpk.quote")}</button></li>)}</ul></details>
        <details><summary className="cursor-pointer"><b>{t("lpk.checklist")}</b> ({p.checklist.length})</summary><ol className="list-decimal pl-5">{p.checklist.map((c) => <li key={c}>{c}</li>)}</ol></details>
        <details><summary className="cursor-pointer"><b>{t("lpk.plan")}</b> {t("lpk.planNote")}</summary>
          <ol className="space-y-1">{p.plan.map((d) => <li key={d.day}><b>{t("lpk.day", { n: d.day })}: {d.goal}</b> <span className="muted">· {d.channel}</span><div className="select-all">{d.post}</div></li>)}</ol></details>
        <p className="muted">{t("lpk.shipping")} <a className="underline" href={file("policies.md")}>policies.md</a> {t("lpk.eu")} {PRO_NOTE}</p>
      </>}
    </section>
  );
}
