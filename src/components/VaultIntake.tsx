"use client";

// VAULT → open an incoming invoice / purchase order → Extract fields. Runs on this PC only (local OCR + local model).
// Read-only: shows fields with a link to their page and an "uncertain" badge; the owner can correct a value. No payments, no invoices.
import { useEffect, useState } from "react";
import type { Sidecar } from "@/lib/vault-intake-pure";

const LABEL: Record<string, string> = { supplier: "Supplier", buyer: "Buyer", document_no: "Document no", date: "Date", due_date: "Due date", currency: "Currency",
  net: "Net", vat: "VAT", gross: "Gross", line_item: "Line item", iban: "IBAN", reference: "Reference" };
const post = (body: unknown) => fetch("/api/vault", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

export function VaultIntake({ name, src, pdf }: { name: string; src: string; pdf: boolean }) {
  const [s, setS] = useState<Sidecar | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [edit, setEdit] = useState<{ i: number; v: string } | null>(null);

  useEffect(() => {
    const ac = new AbortController();
    fetch(`/api/vault?file=${encodeURIComponent(name)}&intake=1`, { signal: ac.signal }).then((r) => r.json()).then((j) => setS(j.intake ?? null), () => {});
    return () => ac.abort();
  }, [name]);

  async function send(body: unknown) {
    setErr(""); setBusy(true);
    try {
      const r = await post(body); const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || `Request failed (${r.status})`);
      setS(j.intake); setEdit(null);
    } catch (e) { setErr(e instanceof Error ? e.message : "Intake failed"); } finally { setBusy(false); }
  }

  const unsure = s?.fields.filter((f) => f.uncertain).length ?? 0;
  return (
    <div className="card space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <button className="btn" disabled={busy} onClick={() => send({ action: "intake", name })}>{busy ? "Reading on this PC…" : s ? "Extract fields again" : "Extract invoice / PO fields"}</button>
        <span className="muted text-xs">Local model and OCR on this PC only. Read-only: nothing is paid or created.</span>
      </div>
      {err && <p className="error whitespace-pre-line">{err}</p>}
      {s && (
        <>
          <p className="muted text-xs">{s.fields.length} fields · {unsure} uncertain · {s.pages.filter((p) => p.ocr).length} of {s.pages.length} pages OCR'd · {s.model} · {new Date(s.at).toLocaleString()}</p>
          {s.partial && <p className="error">Partial: the document was longer than the model reads at once; fields after the cut are missing.</p>}
          {s.stale && <p className="error">The file was replaced after this extraction: extract the fields again.</p>}
          {!s.fields.length && <p className="muted">No fields found.</p>}
          <table className="w-full text-xs">
            <tbody>
              {s.fields.map((f, i) => (
                <tr key={i} className="align-top">
                  <td className="pr-2 font-semibold">{LABEL[f.field] ?? f.field}</td>
                  <td className="pr-2 break-words">
                    {edit?.i === i
                      ? <form onSubmit={(e) => { e.preventDefault(); void send({ action: "intake-fix", name, index: i, value: edit.v }); }} className="flex gap-1">
                          <input className="input" aria-label={`Correct ${LABEL[f.field] ?? f.field}`} value={edit.v} onChange={(e) => setEdit({ i, v: e.target.value })} autoFocus />
                          <button className="chip" disabled={busy}>Save</button><button type="button" className="chip" onClick={() => setEdit(null)}>Cancel</button>
                        </form>
                      : <>{f.value} {f.uncertain && <span className="chip danger" title={f.why.join("; ")}>uncertain</span>}{f.corrected && <span className="chip">corrected</span>}</>}
                    {f.quote && <div className="muted">“{f.quote}”</div>}
                  </td>
                  <td className="whitespace-nowrap">
                    {pdf ? <a className="link" href={`${src}#page=${f.page}`} target="_blank" rel="noreferrer noopener">p. {f.page}</a> : <span>p. {f.page}</span>}
                    {edit?.i !== i && <> · <button className="link" onClick={() => setEdit({ i, v: f.value })}>Correct</button></>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </div>
  );
}
