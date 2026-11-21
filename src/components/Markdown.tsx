"use client";
// Small Markdown renderer for agent and CORE output (its own module so the phone chat doesn't load all of AgentsPanels).
import { Fragment, type ReactNode } from "react";
import { highlight } from "./Highlight";
import { useT } from "./i18n";

export const safeHref = (u: string) => (/^https?:\/\//i.test(u) ? u : "#");

export function inline(text: string, openMemory?: (id: string) => void, memLabel = "memory"): ReactNode[] {
  return text.split(/(\[[^\]]+\]\(https?:\/\/[^)\s]+\)|\[m:[0-9a-f-]{36}\]|\*\*[^*]+\*\*|`[^`]+`)/gi).map((part, i) => {
    const link = part.match(/^\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)$/);
    if (link) return <a key={i} className="link" href={safeHref(link[2])} target="_blank" rel="noreferrer noopener">{link[1]}</a>;
    const mem = part.match(/^\[m:([0-9a-f-]{36})\]$/i);
    if (mem) return <button key={i} className="chip" onClick={() => openMemory?.(mem[1])}>{memLabel}</button>;
    if (part.startsWith("**") && part.endsWith("**")) return <strong key={i} className="hl-strong">{part.slice(2, -2)}</strong>;
    if (part.startsWith("`") && part.endsWith("`")) return <code key={i} className="rounded bg-black/40 px-1">{part.slice(1, -1)}</code>;
    return <Fragment key={i}>{highlight(part, i)}</Fragment>;
  });
}

export function Markdown({ text, openMemory }: { text: string; openMemory?: (id: string) => void }) {
  const mem = useT().t("ops.memory");
  const out: ReactNode[] = [];
  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const t = lines[i].trimEnd();
    if (t.trim().startsWith("```")) {
      const code: string[] = [];
      for (i++; i < lines.length && !lines[i].trim().startsWith("```"); i++) code.push(lines[i]);
      out.push(<pre key={i} className="overflow-x-auto rounded-lg bg-black/50 p-3 text-xs"><code>{code.join("\n")}</code></pre>);
      continue;
    }
    const s = t.trim();
    if (!s) continue;
    if (/^\|.*\|$/.test(s)) { out.push(<p key={i} className="font-mono text-xs">{s}</p>); continue; }
    if (s.startsWith("### ")) out.push(<h4 key={i} className="mt-3 font-semibold">{inline(s.slice(4), openMemory, mem)}</h4>);
    else if (s.startsWith("## ") || s.startsWith("# ")) out.push(<h3 key={i} className="h3 mt-4">{s.replace(/^#+\s/, "")}</h3>);
    else if (/^([-*]|\d+\.)\s/.test(s)) out.push(<p key={i} className="pl-4">{/^\d/.test(s) ? `${s.split(".")[0]}.` : "•"} {inline(s.replace(/^([-*]|\d+\.)\s/, ""), openMemory, mem)}</p>);
    else out.push(<p key={i}>{inline(s, openMemory, mem)}</p>);
  }
  return <div className="space-y-2 text-sm leading-relaxed">{out}</div>;
}

