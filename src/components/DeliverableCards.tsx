"use client";
// Deliverable cards under a CORE answer: each workspace file it wrote, with Open preview, Download, Save to VAULT and Download all (.zip).
import { useState } from "react";
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
    {[...new Set(files.map((f) => f.id))].map((ws) => <a key={ws} className="chip text-xs" href={`${q(ws)}&zip=1`} download>{t("deliv.zip", { ws })}</a>)}
  </section>;
}
