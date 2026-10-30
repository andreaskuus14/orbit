"use client";
import type { WriteEvidence } from "@/lib/completion-pure";
import { useT } from "./i18n";

/** These receipts come from read-back checks, independently of the model's answer. */
export function ResultEvidence({ items, openMemory }: { items: WriteEvidence[]; openMemory: (id: string) => void }) {
  const { t } = useT();
  if (!items.length) return null;
  return <section className="result-evidence" aria-label={t("evid.title")}><h3>{t("evid.title")}</h3><p className="muted">{t("evid.hint")}</p><ul>{items.map((e, i) => <li key={i}>
    <span>{e.kind === "file" ? e.path ?? t("evid.file") : t("evid.saved", { kind: e.kind })}</span>
    {e.kind === "memory" ? <button type="button" className="link" onClick={() => openMemory(e.id)}>{t("evid.openMemory")}</button>
      : e.kind === "file" ? <a className="link" href={`/api/workspace?ws=${encodeURIComponent(e.id)}&file=${encodeURIComponent(e.path ?? "")}&open=1`} target="_blank" rel="noopener noreferrer">{t("evid.openFile")} <span className="sr-only">{t("evid.newTab")}</span></a> : null}
    <details><summary>{t("evid.receipt")}</summary><p>{e.kind === "file" && e.bytes !== undefined ? t("evid.bytes", { n: e.bytes.toLocaleString() }) : ""}{t("evid.ref", { id: e.id })}</p></details>
  </li>)}</ul></section>;
}
