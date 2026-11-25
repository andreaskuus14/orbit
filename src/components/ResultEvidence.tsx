"use client";
import type { WriteEvidence } from "@/lib/completion-pure";
import { useT } from "./i18n";

/** These receipts come from read-back checks, independently of the model's answer. */
export function ResultEvidence({ items, openMemory }: { items: WriteEvidence[]; openMemory: (id: string) => void }) {
  const { t } = useT();
  if (!items.length) return null;
  return <section className="result-evidence" aria-label={t("rev.title")}><h3>{t("rev.title")}</h3><p className="muted">{t("rev.help")}</p><ul>{items.map((e, i) => <li key={i}>
    <span>{e.kind === "file" ? e.path ?? t("rev.wsFile") : t(`rev.saved.${e.kind}`)}</span>
    {e.kind === "memory" ? <button type="button" className="link" onClick={() => openMemory(e.id)}>{t("rev.openMem")}</button>
      : e.kind === "file" ? <a className="link" href={`/api/workspace?ws=${encodeURIComponent(e.id)}&file=${encodeURIComponent(e.path ?? "")}&open=1`} target="_blank" rel="noopener noreferrer">{t("rev.openFile")} <span className="sr-only">{t("rev.newTab")}</span></a> : null}
    <details><summary>{t("rev.details")}</summary><p>{e.kind === "file" && e.bytes !== undefined ? `${t("rev.bytes", { n: e.bytes.toLocaleString() })} · ` : ""}{t("rev.ref", { id: e.id })}</p></details>
  </li>)}</ul></section>;
}
