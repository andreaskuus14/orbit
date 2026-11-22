"use client";
// A CORE answer, artifact-style: code blocks with their own Copy and fold, real tables, ORBIT's own pictures / video / audio / PDFs
// shown inline with Open and Download, 3D models and outside links as a plain card, and a long answer folded behind "Show all".
// Blocks come from core-chat-pure.ts (chatBlocks); prose goes through the shared Markdown renderer.
import { memo, useState } from "react";
import { CODE_FOLD, chatBlocks, isLong, type Block } from "@/lib/core-chat-pure";
import { Markdown, inline, type CiteRender } from "./Markdown";
import { useT } from "./i18n";

const dl = (url: string) => (url.startsWith("/api/workspace") && !/[?&]download=1/.test(url) ? `${url}&download=1` : url);

// While an answer streams, it is re-split every frame: blocks whose content didn't change skip their render (only the last one grows).
const same = (a: { b: unknown }, z: { b: unknown }) => JSON.stringify(a.b) === JSON.stringify(z.b);
const Prose = memo(Markdown);

const Code = memo(function Code({ b }: { b: Extract<Block, { kind: "code" }> }) {
  const { t } = useT();
  const [copied, setCopied] = useState(false);
  const lines = b.code.split("\n").length;
  const [open, setOpen] = useState(lines <= CODE_FOLD);
  return (
    <figure className="chat-code">
      <figcaption>
        <span>{b.lang || t("chat.code")}</span>
        {!b.open && <button type="button" className="chat-mini" aria-label={t("chat.copyCode")}
          onClick={() => void navigator.clipboard?.writeText(b.code).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); })}>{copied ? `✓ ${t("cf.copied")}` : t("common.copy")}</button>}
      </figcaption>
      <pre className={open || b.open ? "" : "chat-folded"}><code>{b.code}</code></pre>
      {!b.open && lines > CODE_FOLD && <button type="button" className="chat-mini chat-more" aria-expanded={open} onClick={() => setOpen((o) => !o)}>{open ? t("chat.less") : t("chat.allLines", { n: lines })}</button>}
    </figure>
  );
}, same);

const Table = memo(function Table({ b, openMemory, cite }: { b: Extract<Block, { kind: "table" }>; openMemory?: (id: string) => void; cite?: CiteRender }) {
  const { t } = useT();
  const copy = () => void navigator.clipboard?.writeText([b.head, ...b.rows].map((r) => r.join("\t")).join("\n"));
  return (
    <div className="chat-table">
      <div className="chat-table-scroll">
        <table>
          <thead><tr>{b.head.map((h, i) => <th key={i} style={{ textAlign: b.align[i] }}>{inline(h, openMemory, undefined, cite)}</th>)}</tr></thead>
          <tbody>{b.rows.map((r, i) => <tr key={i}>{r.map((c, j) => <td key={j} style={{ textAlign: b.align[j] }}>{inline(c, openMemory, undefined, cite)}</td>)}</tr>)}</tbody>
        </table>
      </div>
      <button type="button" className="chat-mini" onClick={copy} title={t("chat.copyTableTitle")}>{t("chat.copyTable")}</button>
    </div>
  );
}, same);

const Media = memo(function Media({ b }: { b: Extract<Block, { kind: "media" }> }) {
  const { t } = useT();
  const icon = { image: "🖼", video: "🎬", audio: "🎵", pdf: "📄", model: "🧊", file: "📎" }[b.media];
  const actions = <span className="flex gap-1.5">
    <a className="chat-mini" href={b.url} target="_blank" rel="noopener noreferrer">{t("deliv.open")}</a>
    {b.inline && <a className="chat-mini" href={dl(b.url)} download>{t("deliv.download")}</a>}
  </span>;
  return (
    <figure className="chat-media">
      {b.inline && b.media === "image" && <a href={b.url} target="_blank" rel="noopener noreferrer"><img src={b.url} alt={b.label} loading="lazy" decoding="async" /></a>}
      {b.inline && b.media === "video" && <video src={b.url} controls preload="metadata" playsInline />}
      {b.inline && b.media === "audio" && <audio src={b.url} controls preload="metadata" />}
      {b.inline && b.media === "pdf" && <object data={b.url} type="application/pdf" aria-label={b.label}><p className="muted text-xs">{t("chat.pdfNoPreview")}</p></object>}
      <figcaption><span className="min-w-0 truncate" title={b.label}>{icon} {b.label}</span>{actions}</figcaption>
    </figure>
  );
}, same);

/** The rich answer. streaming: still arriving (no fold, an unfinished code block shows as it grows). */
export const ChatAnswer = memo(function ChatAnswer({ text, openMemory, streaming = false, cite }: { text: string; openMemory?: (id: string) => void; streaming?: boolean; cite?: CiteRender }) {
  const { t } = useT();
  const long = !streaming && isLong(text);
  const [all, setAll] = useState(false);
  const blocks = chatBlocks(text);
  return (
    <div className={`chat-answer${long && !all ? " chat-folded-answer" : ""}`}>
      {blocks.map((b, i) => b.kind === "text" ? <Prose key={i} text={b.text} openMemory={openMemory} cite={cite} />
        : b.kind === "code" ? <Code key={i} b={b} />
        : b.kind === "table" ? <Table key={i} b={b} openMemory={openMemory} cite={cite} />
        : <Media key={i} b={b} />)}
      {long && <button type="button" className="chat-mini chat-more" aria-expanded={all} onClick={() => setAll((a) => !a)}>{all ? t("chat.less") : t("chat.showAll")}</button>}
    </div>
  );
});
