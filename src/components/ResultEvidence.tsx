"use client";
import type { WriteEvidence } from "@/lib/completion-pure";

/** These receipts come from read-back checks, independently of the model's answer. */
export function ResultEvidence({ items, openMemory }: { items: WriteEvidence[]; openMemory: (id: string) => void }) {
  if (!items.length) return null;
  return <section className="result-evidence" aria-label="Checked results"><h3>Checked results</h3><p className="muted">Saved and read back successfully. This doesn't check the quality of the content.</p><ul>{items.map((e, i) => <li key={i}>
    <span>{e.kind === "file" ? e.path ?? "Workspace file" : `${e.kind[0].toUpperCase() + e.kind.slice(1)} saved`}</span>
    {e.kind === "memory" ? <button type="button" className="link" onClick={() => openMemory(e.id)}>Open memory</button>
      : e.kind === "file" ? <a className="link" href={`/api/workspace?ws=${encodeURIComponent(e.id)}&file=${encodeURIComponent(e.path ?? "")}&open=1`} target="_blank" rel="noopener noreferrer">Open file <span className="sr-only">in a new tab</span></a> : null}
    <details><summary>Receipt details</summary><p>{e.kind === "file" && e.bytes !== undefined ? `${e.bytes.toLocaleString()} bytes read back · ` : ""}Reference: {e.id}</p></details>
  </li>)}</ul></section>;
}
