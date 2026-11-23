"use client";
// One VAULT file in the sheet: a real preview (picture, video, audio, the text, or the first words of a PDF / Word file from the
// content index), plain facts, the invoice / order fields read on this PC, what ORBIT changed on it (TIME MACHINE Undo), and the
// actions: Download, Rename (inline), Ask ORBIT (primary) and "…" for the rest. Trash is instant with Undo in the toast.
// A journal-looking file is never offered to a model (no Ask, no notes, no Memory copy, no podcast).
import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Button, Card, Empty, Loading, MoreMenu, Row, toast, type MenuItem } from "./ui";
import { useT } from "./i18n";
import { VOICE_ASK } from "./voice/bus";
import { VaultTextCompare } from "./VaultTextCompare";
import { call, rawUrl, thumbUrl, type VFile } from "./VaultBits";
import type { Sidecar } from "@/lib/vault-intake-pure";
import { MEMORY_MAX, memoryType } from "@/lib/vault-pure";
import { fileActions, fileDate, plainError, size, type VaultChange } from "@/lib/vault-ui-pure";

export type Ctx = {
  run: <T>(title: string, fn: (step: (done: number, total: number, now?: string) => void) => Promise<T>, kind?: string) => Promise<T | undefined>;
  load: () => Promise<void>; files: VFile[]; changes: VaultChange[]; setOpen: (name: string | null) => void;
  untrash: (x: { id: string; name: string }) => Promise<void>; undoChange: (c: VaultChange) => Promise<void>;
};
const JSON_POST = (body: unknown): RequestInit => ({ method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
/** An invoice / order by its words (EN + ET): only then does the fields block show by itself; otherwise it is in "…". */
const looksLikeInvoice = (text: string) => /\b(invoice|arve|order|tellimus|IBAN|VAT|käibemaks|due date|maksetähtaeg|receipt|kviitung)\b/i.test(text.slice(0, 3000));
const FIELD = ["supplier", "buyer", "document_no", "date", "due_date", "currency", "net", "vat", "gross", "line_item", "iban", "reference"] as const;

export function VaultFileSheet({ file, ctx }: { file: VFile; ctx: Ctx }) {
  const { t, lang } = useT();
  const a = fileActions(file, MEMORY_MAX);
  const src = rawUrl(file.name);
  const [text, setText] = useState<{ text: string; more: boolean } | null | "none">(null);
  const [renaming, setRenaming] = useState(false);
  const [newName, setNewName] = useState(file.name);
  const [memAsk, setMemAsk] = useState(false);
  const [busy, setBusy] = useState("");
  const [compare, setCompare] = useState(false);
  const [fieldsOn, setFieldsOn] = useState(false);
  const words = { localOff: t("vlt.err.localOff"), cloudDown: t("vlt.err.cloudDown") };
  const fail = (e: unknown, fallback = t("vlt.err.generic")) => toast({ tone: "error", text: plainError(e instanceof Error ? e.message : "", fallback, words) });

  useEffect(() => { // text previews: the file's own first 20 KB, or the indexed words of a PDF / Word file (no OCR here)
    if (a.preview !== "text" && a.preview !== "doctext") return;
    const ac = new AbortController();
    const url = a.preview === "text" ? `/api/vault?file=${encodeURIComponent(file.name)}&preview=1` : `/api/vault?file=${encodeURIComponent(file.name)}&text=1`;
    call<{ text: string; truncated?: boolean }>(url, { signal: ac.signal })
      .then((r) => { if (ac.signal.aborted) return; setText(r.text.trim() ? { text: r.text, more: !!r.truncated || r.text.length >= 3000 } : "none"); if (a.fields && looksLikeInvoice(r.text)) setFieldsOn(true); })
      .catch(() => { if (!ac.signal.aborted) setText("none"); });
    return () => ac.abort();
  }, [file.name, a.preview]);

  const mine = useMemo(() => ctx.changes.filter((c) => c.name === file.name), [ctx.changes, file.name]);
  const syncText = file.sync === "failed" ? t("vlt.tag.failed") : file.sync === "pending" ? t("vlt.tag.pending") : file.cloud ? t("vlt.fact.cloud") : t("vlt.tag.local");
  const covText = file.cov === "indexed" ? t("vlt.cov.indexed") : file.cov === "partial" ? t("vlt.cov.partial") : file.cov === "failed" ? t("vlt.cov.failed") : null;

  async function rename(e: FormEvent) {
    e.preventDefault();
    const to = newName.trim();
    if (!to || to === file.name) { setRenaming(false); return; }
    setBusy("rename");
    try {
      const r = await call<{ name: string; cloud?: string }>("/api/vault", JSON_POST({ action: "rename", name: file.name, to }));
      await ctx.load(); ctx.setOpen(r.name); setRenaming(false);
      const back = file.name;
      toast({ tone: "done", text: t("vlt.renamed", { name: r.name }), action: { label: t("vlt.changes.undo"), onClick: () => void call("/api/vault", JSON_POST({ action: "rename", name: r.name, to: back })).then(() => ctx.load().then(() => ctx.setOpen(back)), (er) => fail(er)) } });
    } catch (er) { fail(er); } finally { setBusy(""); }
  }
  async function trash() {
    setBusy("trash");
    try {
      const r = await call<{ id?: string }>("/api/vault", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: file.name }) });
      ctx.setOpen(null); await ctx.load();
      toast({ text: t("vlt.trashed", { name: file.name }), action: r.id ? { label: t("vlt.changes.undo"), onClick: () => void ctx.untrash({ id: r.id!, name: file.name }) } : undefined });
    } catch (er) { fail(er); setBusy(""); }
  }
  const skill = () => ctx.run(t("vlt.job.skill", { name: file.name }), async (step) => {
    step(0, 1, t("vlt.skill.now"));
    const r = await call<{ skill: string; chapters: number; skipped: number }>("/api/vault", JSON_POST({ action: "skill", name: file.name }));
    await ctx.load();
    toast({ tone: "done", text: t("vlt.skill.done", { name: r.skill, n: r.chapters }) });
  }, "skill");
  const toMemory = () => { setMemAsk(false); void ctx.run(t("vlt.job.memory", { name: file.name }), async () => {
    const blob = await (await fetch(src)).blob();
    const fd = new FormData(); fd.set("file", new File([blob], file.name, { type: memoryType(file.name) ?? "" }));
    const res = await fetch("/api/memories/upload", { method: "POST", body: fd });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(json.error || "");
    toast({ tone: "done", text: t("vlt.mem.done", { name: file.name }) });
  }, "mem"); };
  const markdown = () => ctx.run(t("vlt.job.md", { name: file.name }), async () => {
    const res = await fetch("/api/local-ai", JSON_POST({ action: "doc", file: file.name }));
    const j = await res.json().catch(() => ({})) as { saved?: string; error?: string };
    if (!res.ok || j.error || !j.saved) throw new Error(j.error || "");
    await ctx.load();
    toast({ tone: "done", text: t("vlt.md.done", { name: j.saved }), action: { label: t("common.open"), onClick: () => ctx.setOpen(j.saved!) } });
  }, "md");
  const askOrbit = () => dispatchEvent(new CustomEvent(VOICE_ASK, { detail: { text: t("vlt.ask.text", { name: file.name }) } }));

  const others = ctx.files.filter((f) => f.type === "text" && f.name !== file.name).map((f) => f.name);
  const more: MenuItem[] = [
    ...(a.compare && others.length ? [{ label: t("vlt.act.compare"), onSelect: () => setCompare(true) }] : []),
    ...(a.fields && !fieldsOn ? [{ label: t("vlt.act.fields"), onSelect: () => setFieldsOn(true) }] : []),
    ...(a.skill ? [{ label: t("vlt.act.skill"), onSelect: () => void skill() }] : []),
    ...(a.markdown ? [{ label: t("vlt.act.md"), onSelect: () => void markdown() }] : []),
    ...(a.memory ? [{ label: t("vlt.act.memory"), onSelect: () => setMemAsk(true) }] : []),
    ...(a.fields || a.skill || a.markdown || a.memory || a.compare ? ["separator" as const] : []),
    { label: t("vault.moveToTrash"), danger: true, onSelect: () => void trash() },
  ];

  return (
    <div className="vlt-file">
      {renaming ? (
        <form className="vlt-rename" onSubmit={rename}>
          <label className="pu-sr" htmlFor="vlt-rename">{t("vlt.rename.label")}</label>
          <input id="vlt-rename" className="vlt-input" value={newName} onChange={(e) => setNewName(e.target.value)} autoFocus maxLength={200}
            onFocus={(e) => { const dot = e.target.value.lastIndexOf("."); e.target.setSelectionRange(0, dot > 0 ? dot : e.target.value.length); }}
            onKeyDown={(e) => { if (e.key === "Escape") { e.stopPropagation(); setRenaming(false); setNewName(file.name); } }} />
          <Button size="sm" onClick={() => { setRenaming(false); setNewName(file.name); }}>{t("vlt.cancel")}</Button>
          <Button size="sm" type="submit" variant="primary" busy={busy === "rename"}>{t("vlt.save")}</Button>
        </form>) : null}

      <div className="vlt-preview" data-kind={a.preview}>
        {a.preview === "image" && <img src={file.size > 3_000_000 ? thumbUrl(file, 640) : src} alt={file.name} decoding="async" />}
        {a.preview === "video" && <video src={src} controls preload="metadata" />}
        {a.preview === "audio" && <audio src={src} controls preload="metadata" />}
        {(a.preview === "text" || a.preview === "doctext") && (text === null ? <Loading rows={3} label={t("vlt.preview.loading")} />
          : text === "none" ? <Empty title={t("vlt.preview.noText")} text={file.type === "pdf" ? t("vlt.preview.scan") : undefined} />
          : <pre className="vlt-page" tabIndex={0} aria-label={t("vlt.preview.label")}>{text.text}{text.more ? "\n…" : ""}</pre>)}
        {a.preview === "none" && <Empty title={t("vlt.preview.none")} text={t("vlt.preview.noneText")} />}
      </div>

      <p className="vlt-facts pu-num">{size(file.size, lang)} · {fileDate(file.mtime, lang)} · {syncText}{covText ? ` · ${covText}` : ""}</p>
      {file.type === "pdf" && <a className="vlt-link" href={src} target="_blank" rel="noreferrer noopener">{t("vlt.preview.openPdf")}</a>}

      {memAsk && <Card tone="needs" title={t("vlt.mem.ask")} sub={t("vlt.mem.askSub")}
        actions={<><Button size="sm" onClick={() => setMemAsk(false)}>{t("vlt.cancel")}</Button><Button size="sm" variant="primary" onClick={toMemory}>{t("vlt.mem.yes")}</Button></>} />}

      {a.fields && <Fields name={file.name} src={src} pdf={file.type === "pdf"} run={ctx.run} show={fieldsOn} onFound={() => setFieldsOn(true)} />}

      {compare && <div className="vlt-legacy"><VaultTextCompare name={file.name} others={others} /></div>}

      {mine.length > 0 && <div className="vlt-block">
        <h4 className="vlt-h">{t("vlt.changes")}</h4>
        <ul className="pu-list">{mine.map((c) => <li key={c.id}><Row title={c.made ? t("vlt.changes.made", { name: c.name }) : c.redo ? t("vlt.changes.removed", { name: c.name }) : c.title} sub={`${fileDate(Date.parse(c.at), lang)}${c.why ? ` · ${c.why}` : ""}`}
          trail={c.open ? <Button size="sm" variant="ghost" onClick={() => void ctx.undoChange(c)}>{c.redo ? t("vlt.changes.redo") : t("vlt.changes.undo")}</Button> : <span>{t("vlt.changes.wasUndone")}</span>} /></li>)}</ul>
      </div>}

      <div className="vlt-sheet-foot">
        <a className="pu-btn" data-variant="secondary" data-size="md" href={src} download={file.name}><span>{t("vlt.act.download")}</span></a>
        {!renaming && <Button onClick={() => { setNewName(file.name); setRenaming(true); }}>{t("vlt.act.rename")}</Button>}
        <span className="vlt-grow" />
        {a.ask && <Button variant="primary" onClick={askOrbit}>{t("vlt.find.ask")}</Button>}
        <MoreMenu items={more} label={t("vlt.act.more")} />
      </div>
      {busy === "trash" && <p className="pu-sr" role="status">{t("vlt.trashing")}</p>}
    </div>
  );
}

/** Invoice / order fields, read on this PC only (local OCR + local model). Read-only: nothing is paid or created. */
function Fields({ name, src, pdf, run, show, onFound }: { name: string; src: string; pdf: boolean; run: Ctx["run"]; show: boolean; onFound: () => void }) {
  const { t } = useT();
  const [s, setS] = useState<Sidecar | null | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [edit, setEdit] = useState<{ i: number; v: string } | null>(null);
  useEffect(() => {
    const ac = new AbortController();
    call<{ intake: Sidecar | null }>(`/api/vault?file=${encodeURIComponent(name)}&intake=1`, { signal: ac.signal }).then((j) => { setS(j.intake ?? null); if (j.intake) onFound(); }, () => setS(null));
    return () => ac.abort();
  }, [name]); // eslint-disable-line react-hooks/exhaustive-deps
  const send = async (body: unknown, title: string) => {
    setBusy(true);
    await run(title, async () => { const j = await call<{ intake: Sidecar }>("/api/vault", JSON_POST(body)); setS(j.intake); setEdit(null); }, "fields");
    setBusy(false);
  };
  const label = (f: string) => ((FIELD as readonly string[]).includes(f) ? t(`vlt.f.${f}` as "vlt.f.supplier") : f);
  if (s === undefined || (!show && !s)) return null;
  const unsure = s?.fields.filter((f) => f.uncertain).length ?? 0;
  return (
    <div className="vlt-block">
      <div className="vlt-block-head">
        <h4 className="vlt-h">{t("vlt.f.title")}</h4>
        <Button size="sm" busy={busy} onClick={() => void send({ action: "intake", name }, t("vlt.job.fields", { name }))}>{s ? t("vlt.f.again") : t("vlt.f.read")}</Button>
      </div>
      {!s ? <p className="vlt-note">{t("vlt.f.note")}</p> : <>
        <p className="vlt-note pu-num">{t("vlt.f.summary", { n: s.fields.length, u: unsure })}</p>
        {s.partial && <p className="vlt-note" data-tone="warn">{t("vlt.f.partial")}</p>}
        {s.stale && <p className="vlt-note" data-tone="warn">{t("vlt.f.stale")}</p>}
        {!s.fields.length ? <p className="vlt-note">{t("vlt.f.none")}</p> : (
          <dl className="vlt-fields">{s.fields.map((f, i) => (
            <div key={i} className="vlt-field">
              <dt>{label(f.field)}</dt>
              <dd>
                {edit?.i === i ? (
                  <form className="vlt-rename" onSubmit={(e) => { e.preventDefault(); void send({ action: "intake-fix", name, index: i, value: edit.v }, t("vlt.job.fix")); }}>
                    <input className="vlt-input" aria-label={t("vlt.f.correctLabel", { field: label(f.field) })} value={edit.v} onChange={(e) => setEdit({ i, v: e.target.value })} autoFocus
                      onKeyDown={(e) => { if (e.key === "Escape") { e.stopPropagation(); setEdit(null); } }} />
                    <Button size="sm" onClick={() => setEdit(null)}>{t("vlt.cancel")}</Button><Button size="sm" type="submit" variant="primary" busy={busy}>{t("vlt.save")}</Button>
                  </form>
                ) : <>
                  <span className="vlt-field-v">{f.value}</span>
                  {f.uncertain && <span className="vlt-tag" data-tone="warn" title={f.why.join("; ")}>{t("vlt.f.unsure")}</span>}
                  {f.corrected && <span className="vlt-tag">{t("vlt.f.corrected")}</span>}
                </>}
                {f.quote && <span className="vlt-quote">“{f.quote}”</span>}
              </dd>
              <span className="vlt-field-act">
                {pdf ? <a className="vlt-link" href={`${src}#page=${f.page}`} target="_blank" rel="noreferrer noopener">{t("vlt.f.page", { n: f.page })}</a> : <span>{t("vlt.f.page", { n: f.page })}</span>}
                {edit?.i !== i && <button type="button" className="vlt-link" onClick={() => setEdit({ i, v: f.value })}>{t("vlt.f.correct")}</button>}
              </span>
            </div>))}</dl>)}
      </>}
    </div>
  );
}
