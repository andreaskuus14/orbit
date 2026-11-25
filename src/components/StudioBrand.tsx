"use client";
// STUDIO brand look: the small settings card behind the Production "More" menu. One stored kit (lib/brand-kit-pure.ts) that every new
// render reads; /api/studio/brand. Saving never touches clips that already exist.
import { useEffect, useState } from "react";
import StateNote from "./StateNote";
import { useT } from "./i18n";
import type { BrandKit } from "@/lib/brand-kit-pure";

type Resp = { kit: BrandKit; defaults: BrandKit; isDefault: boolean };
const API = "/api/studio/brand";
async function call(method: "GET" | "PUT", body?: unknown): Promise<Resp> {
  const r = await fetch(API, { method, cache: "no-store", ...(body ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : {}) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || `Request failed (${r.status})`);
  return j as Resp;
}

export default function StudioBrand() {
  const { t } = useT();
  const [r, setR] = useState<Resp | null>(null), [kit, setKit] = useState<BrandKit | null>(null), [err, setErr] = useState(""), [msg, setMsg] = useState(""), [busy, setBusy] = useState(false);
  useEffect(() => { call("GET").then((x) => { setR(x); setKit(x.kit); }, (e: Error) => setErr(e.message)); }, []);
  if (err && !kit) return <StateNote state="failed" what={err} />;
  if (!kit || !r) return <StateNote state="loading">{t("bk.loading")}</StateNote>;
  const put = async (body: unknown) => {
    setBusy(true); setErr(""); setMsg("");
    try { const x = await call("PUT", body); setR(x); setKit(x.kit); setMsg(t("bk.saved")); } catch (e) { setErr(e instanceof Error ? e.message : "Couldn't save"); } finally { setBusy(false); }
  };
  const cap = (k: keyof BrandKit["caption"], v: string | number) => setKit({ ...kit, caption: { ...kit.caption, [k]: v } });
  const field = "field w-full !px-2 !py-1 !text-xs", label = "muted mb-0.5 block text-[12px] font-medium";
  const colour = (text: string, value: string, on: (v: string) => void) => (
    <label><span className={label}>{text}</span><input type="color" className="h-7 w-full cursor-pointer rounded border border-white/10 bg-transparent" value={value} onChange={(e) => on(e.target.value)} /></label>
  );
  const num = (text: string, k: "size" | "outlineWidth" | "bottom") => (
    <label><span className={label}>{text}</span><input className={field} type="number" value={kit.caption[k]} onChange={(e) => cap(k, Number(e.target.value))} /></label>
  );
  return (
    <form className="space-y-3 text-[12px]" onSubmit={(e) => { e.preventDefault(); void put({ kit }); }} aria-label={t("bk.title")}>
      <p className="muted">{t("bk.help")}{r.isDefault ? ` ${t("bk.isDefault")}` : ""}</p>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        <label className="col-span-2 sm:col-span-1"><span className={label}>{t("bk.capFont")}</span><input className={field} value={kit.caption.font} maxLength={40} placeholder="Arial" onChange={(e) => cap("font", e.target.value)} /></label>
        {num(t("bk.capSize"), "size")}{num(t("bk.capBottom"), "bottom")}
        {colour(t("bk.capText"), kit.caption.text, (v) => cap("text", v))}{colour(t("bk.capHi"), kit.caption.highlight, (v) => cap("highlight", v))}{colour(t("bk.capShout"), kit.caption.shout, (v) => cap("shout", v))}
        {colour(t("bk.capOutline"), kit.caption.outline, (v) => cap("outline", v))}{num(t("bk.capOutlineW"), "outlineWidth")}
        {colour(t("bk.hookBox"), kit.hook.box, (v) => setKit({ ...kit, hook: { ...kit.hook, box: v } }))}{colour(t("bk.hookText"), kit.hook.text, (v) => setKit({ ...kit, hook: { ...kit.hook, text: v } }))}
        {colour(t("bk.accent"), kit.thumb.accent, (v) => setKit({ ...kit, thumb: { ...kit.thumb, accent: v } }))}{colour(t("bk.thumbText"), kit.thumb.text, (v) => setKit({ ...kit, thumb: { ...kit.thumb, text: v } }))}
        <label className="col-span-2 sm:col-span-1"><span className={label}>{t("bk.intro")}</span><input className={field} value={kit.card.intro} maxLength={40} onChange={(e) => setKit({ ...kit, card: { ...kit.card, intro: e.target.value } })} /></label>
        <label className="col-span-2 sm:col-span-1"><span className={label}>{t("bk.outro")}</span><input className={field} value={kit.card.outro} maxLength={40} onChange={(e) => setKit({ ...kit, card: { ...kit.card, outro: e.target.value } })} /></label>
      </div>
      {err && <p className="error" role="alert">{err}</p>}
      {msg && <p className="muted" aria-live="polite">{msg}</p>}
      <div className="flex gap-1.5">
        <button type="submit" className="chip" disabled={busy}>{t("bk.save")}</button>
        <button type="button" className="chip" disabled={busy || r.isDefault} onClick={() => void put({ reset: true })}>{t("bk.reset")}</button>
      </div>
    </form>
  );
}
