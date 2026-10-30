"use client";
// Deliverable cards under a CORE answer: each workspace file it wrote, with Open preview, Download, Save to VAULT and Download all (.zip).
import { useEffect, useState } from "react";
import type { WriteEvidence } from "@/lib/completion-pure";
import { deliverables } from "@/lib/core-workspace-pure";
import { useT } from "./i18n";

const q = (ws: string, file?: string) => `/api/workspace?ws=${encodeURIComponent(ws)}${file ? `&file=${encodeURIComponent(file)}` : ""}`;
const size = (n = 0) => (n < 1024 ? `${n} B` : `${(n / 1024).toFixed(1)} KB`);

export function DeliverableCards({ items }: { items: WriteEvidence[] }) {
  const { t } = useT();
  const [saved, setSaved] = useState<Record<string, string>>({});
  const files = deliverables(items);
  if (!files.length) return null;
  const vault = async (ws: string, path: string) => {
    const k = `${ws}/${path}`;
    setSaved((s) => ({ ...s, [k]: t("deliv.saving") }));
    const r = await fetch("/api/workspace", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "vault", ws, path }) }).then((x) => x.json()).catch(() => ({ error: t("deliv.failed") }));
    setSaved((s) => ({ ...s, [k]: r.error ? r.error : t(r.created ? "deliv.saved" : "deliv.already", { name: r.name }) }));
  };
  return <section className="result-evidence" aria-label={t("deliv.title")}><h3>{t("deliv.title")}</h3><ul>{files.map((f) => {
    const k = `${f.id}/${f.path}`;
    return <li key={k}>
      <span><b>{f.path}</b> <span className="muted">· {size(f.bytes)}</span></span>
      <span className="flex flex-wrap gap-1.5 text-xs">
        {/\.html?$/i.test(f.path) && <a className="chip" href={`${q(f.id, f.path)}&open=1`} target="_blank" rel="noopener noreferrer">{t("deliv.open")}</a>}
        <a className="chip" href={`${q(f.id, f.path)}&download=1`} download>{t("deliv.download")}</a>
        <button type="button" className="chip" onClick={() => void vault(f.id, f.path)}>{t("deliv.vault")}</button>
      </span>
      <p className="muted text-xs">{f.check ?? t("deliv.unchecked")}{saved[k] ? ` · ${saved[k]}` : ""}</p>
    </li>;
  })}</ul>
    {[...new Set(files.filter((f) => f.path === "server.mjs").map((f) => f.id))].map((ws) => <ServerCard key={`srv-${ws}`} ws={ws} />)}
    {[...new Set(files.map((f) => f.id))].map((ws) => <a key={ws} className="chip text-xs" href={`${q(ws)}&zip=1`} download>{t("deliv.zip", { ws })}</a>)}
  </section>;
}

type Srv = { running: boolean; url?: string; routes: string[]; note: string; error?: string };
/** A full-stack workspace's local demo server: Running / Stopped, Open, Start / Stop, and the API routes in server.mjs. */
function ServerCard({ ws }: { ws: string }) {
  const { t } = useT();
  const [s, setS] = useState<Srv | null>(null);
  useEffect(() => { void fetch(`${q(ws)}&server=1`).then((r) => r.json()).then(setS, () => {}); }, [ws]);
  const op = async (o: "start" | "stop") => setS(await fetch("/api/workspace", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "server", ws, op: o }) }).then((r) => r.json()).catch(() => ({ error: t("deliv.failed") })));
  if (!s) return null;
  return <div className="text-xs" aria-live="polite">
    <p><b>{t("deliv.server")}</b> <span className="muted">· {s.running ? t("deliv.running") : t("deliv.stopped")}</span></p>
    <span className="flex flex-wrap gap-1.5">
      {s.running && s.url && <a className="chip" href={s.url} target="_blank" rel="noopener noreferrer">{t("deliv.open")}</a>}
      <button type="button" className="chip" onClick={() => void op(s.running ? "stop" : "start")}>{s.running ? t("deliv.stop") : t("deliv.start")}</button>
    </span>
    <p className="muted">{t("deliv.routes")}: {s.routes?.length ? s.routes.join(", ") : "—"}{s.error ? ` · ${s.error}` : ""}</p>
    <p className="muted">{t("deliv.localOnly")}</p>
  </div>;
}
