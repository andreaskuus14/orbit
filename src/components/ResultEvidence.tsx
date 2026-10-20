"use client";
import type { WriteEvidence } from "@/lib/completion-pure";

/** These receipts come from read-back checks, independently of the model's answer. */
export function ResultEvidence({ items, openMemory }: { items: WriteEvidence[]; openMemory: (id: string) => void }) {
  if (!items.length) return null;
  return <section className="result-evidence" aria-label="Checked results"><h3>Checked results</h3><ul>{items.map((e, i) => <li key={i}>
    <span>{e.kind === "file" ? `${e.path} · ${e.bytes} bytes read back` : `${e.kind[0].toUpperCase() + e.kind.slice(1)} read back · ${e.id.slice(0, 8)}`}</span>
    {e.kind === "memory" ? <button className="link" onClick={() => openMemory(e.id)}>Open memory</button>
      : e.kind === "file" ? <a className="link" href={`/api/workspace?ws=${encodeURIComponent(e.id)}&file=${encodeURIComponent(e.path ?? "")}&open=1`} target="_blank" rel="noopener noreferrer">Open file</a> : null}
  </li>)}</ul></section>;
}
