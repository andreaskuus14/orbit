"use client";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import {
  buildGenUiSrcDoc,
  DEFAULT_GEN_UI_HEIGHT,
  parseGenUiMessage,
  validateGenUiHtml,
  type GenUiAction,
  type GenUiBlock,
} from "@/lib/gen-ui-pure";

export type GenUiFrameProps = {
  block: GenUiBlock;
  onAction?: (action: Exclude<GenUiAction, { type: "resize" }>) => void;
};

/** Offline-sandboxed interactive micro-app frame ("Living Canvas") for CORE & agent replies.
 *  Runs inside `sandbox="allow-scripts"` (no same-origin, no forms, no popups, no top-nav, connect-src 'none'). */
export function GenUiFrame({ block, onAction }: GenUiFrameProps) {
  const rawId = useId();
  const nonce = useMemo(() => `oui_${rawId.replace(/[^a-zA-Z0-9_-]/g, "")}_${block.id.replace(/[^a-zA-Z0-9_-]/g, "")}`, [rawId, block.id]);
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const [height, setHeight] = useState<number>(block.height ?? DEFAULT_GEN_UI_HEIGHT);
  const [expanded, setExpanded] = useState(false);
  const [showSource, setShowSource] = useState(false);
  const [copied, setCopied] = useState(false);
  // "ask" and "copy" come from widget code, which can carry injected content: they only happen after his click on this chip.
  const [pending, setPending] = useState<Exclude<GenUiAction, { type: "resize" }> | null>(null);

  const validation = useMemo(() => (block.streaming ? null : validateGenUiHtml(block.html)), [block.html, block.streaming]);
  const srcDoc = useMemo(
    () => (validation?.ok ? buildGenUiSrcDoc(block.html, nonce) : ""),
    [block.html, nonce, validation],
  );

  useEffect(() => {
    const onMessage = (ev: MessageEvent) => {
      if (iframeRef.current && ev.source !== iframeRef.current.contentWindow) return;
      const action = parseGenUiMessage(ev.data, nonce);
      if (!action) return;
      if (action.type === "resize") {
        setHeight(action.height);
        return;
      }
      if (action.type === "ask" || action.type === "copy") { setPending(action); return; }
      onAction?.(action);
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [nonce, onAction]);

  const confirmPending = () => {
    const a = pending;
    setPending(null);
    if (!a) return;
    if (a.type === "copy" && typeof navigator !== "undefined" && navigator.clipboard) void navigator.clipboard.writeText(a.text).catch(() => {});
    onAction?.(a);
  };

  const copyHtml = () => {
    if (typeof navigator === "undefined" || !navigator.clipboard) return;
    void navigator.clipboard.writeText(block.html).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    }).catch(() => {});
  };

  return (
    <section
      aria-label={block.title}
      style={{
        border: "1px solid rgba(148, 163, 184, 0.22)",
        borderRadius: 12,
        background: "rgba(7, 11, 20, 0.85)",
        overflow: "hidden",
        margin: "10px 0",
        ...(expanded ? { position: "fixed", inset: 20, zIndex: 90, display: "flex", flexDirection: "column" } : {}),
      }}
    >
      <header
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 8,
          padding: "8px 12px",
          borderBottom: "1px solid rgba(148, 163, 184, 0.16)",
          background: "rgba(15, 23, 42, 0.7)",
          fontSize: 12,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
          <strong style={{ color: "#e2e8f0", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {block.title}
          </strong>
          <span
            style={{
              fontSize: 10,
              padding: "2px 6px",
              borderRadius: 999,
              background: "rgba(56, 189, 248, 0.14)",
              color: "#7dd3fc",

            }}
          >
            {block.streaming ? "Building…" : `Offline · ${block.kind}`}
          </span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <button
            type="button"
            aria-label={showSource ? "Show interactive view" : "Show widget source"}
            onClick={() => setShowSource((v) => !v)}
            style={{ fontSize: 11, padding: "4px 8px", borderRadius: 6 }}
          >
            {showSource ? "Preview" : "Source"}
          </button>
          <button
            type="button"
            aria-label="Copy widget HTML"
            onClick={copyHtml}
            style={{ fontSize: 11, padding: "4px 8px", borderRadius: 6 }}
          >
            {copied ? "Copied" : "Copy"}
          </button>
          <button
            type="button"
            aria-label={expanded ? "Exit fullscreen" : "Expand interactive view"}
            onClick={() => setExpanded((v) => !v)}
            style={{ fontSize: 11, padding: "4px 8px", borderRadius: 6 }}
          >
            {expanded ? "Close" : "Expand"}
          </button>
        </div>
      </header>

      {pending && (pending.type === "ask" || pending.type === "copy") ? (
        <div role="status" style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 12px", fontSize: 12, color: "#e2e8f0", background: "rgba(251, 191, 36, 0.12)" }}>
          <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {pending.type === "ask" ? `This widget wants to ask CORE: "${pending.prompt}"` : "This widget wants to copy text to your clipboard."}
          </span>
          <button type="button" onClick={confirmPending} style={{ fontSize: 11, padding: "4px 8px", borderRadius: 6 }}>{pending.type === "ask" ? "Ask" : "Copy"}</button>
          <button type="button" onClick={() => setPending(null)} style={{ fontSize: 11, padding: "4px 8px", borderRadius: 6 }}>No</button>
        </div>
      ) : null}

      {block.streaming ? (
        <div style={{ padding: 16, color: "#94a3b8", fontSize: 13 }}>
          Streaming interactive canvas…
        </div>
      ) : !validation?.ok ? (
        <div role="alert" style={{ padding: 14, color: "#fca5a5", fontSize: 13 }}>
          <strong>Blocked by offline sandbox:</strong> {validation?.reason ?? "Invalid widget"}
        </div>
      ) : showSource ? (
        <pre
          style={{
            margin: 0,
            padding: 12,
            overflow: "auto",
            maxHeight: expanded ? "100%" : 420,
            fontSize: 12,
            color: "#cbd5e1",
            background: "#020617",
          }}
        >
          <code>{block.html}</code>
        </pre>
      ) : (
        <iframe
          ref={iframeRef}
          title={block.title}
          sandbox="allow-scripts"
          referrerPolicy="no-referrer"
          srcDoc={srcDoc}
          style={{
            width: "100%",
            height: expanded ? "100%" : height,
            flex: expanded ? 1 : undefined,
            border: 0,
            display: "block",
            background: "#070b14",
          }}
        />
      )}
    </section>
  );
}
