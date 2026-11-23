"use client";
// The planet shell (reports/design-language.md § Shell): one calm surface per planet.
//   header: accent dot, planet name, one status line, "…" menu, close
//   main job first: one ask box ("What do you need?") + 2–3 suggestions → ORBIT does it
//   then sections in this order: Needs you → Working on it → Results (Section + Card/Row/WorkCard)
//   everything else lives in the "…" menu or a Sheet, never in tab rows.
// All text comes in as props (the caller's i18n), so EN/ET stay in the caller's keys.
import { useState, type FormEvent, type KeyboardEvent, type ReactNode } from "react";
import type { ShellId } from "@/lib/planet-ui-pure";
import "@/app/planet-ui.css";
import { Button } from "./Button";
import { Chip } from "./Chip";
import { IconClose, IconSend } from "./icons";
import { MoreMenu, type MenuItem } from "./MoreMenu";
import { uiSound } from "./sound";

export type AskProps = {
  label: string; placeholder: string; sendLabel: string;
  onSubmit: (text: string) => void | Promise<void>;
  suggestions?: string[]; busy?: boolean;
};

export function PlanetShell({ planet, title, status, menu, menuLabel, onClose, closeLabel, ask, children, sheet, className }: {
  planet: ShellId; title: string; status?: ReactNode;
  menu?: MenuItem[]; menuLabel?: string;
  onClose?: () => void; closeLabel?: string;
  ask?: AskProps; children?: ReactNode; sheet?: ReactNode; className?: string;
}) {
  return (
    <section className={`pu pu-shell${className ? " " + className : ""}`} data-planet={planet} aria-label={title}>
      <header className="pu-head">
        <span className="pu-mark" aria-hidden="true" />
        <div className="pu-head-text">
          <h2 className="pu-title">{title}</h2>
          {status && <p className="pu-status">{status}</p>}
        </div>
        <div className="pu-head-actions">
          {menu && menu.length > 0 && menuLabel && <MoreMenu items={menu} label={menuLabel} />}
          {onClose && closeLabel && <Button variant="ghost" icon={<IconClose />} label={closeLabel} onClick={onClose} />}
        </div>
      </header>
      <div className="pu-body">
        {ask && <Ask {...ask} />}
        {children}
      </div>
      {sheet}
    </section>
  );
}

/** The main job: one box. Enter sends, Shift+Enter is a new line. A suggestion fills the box (he still presses send). */
export function Ask({ label, placeholder, sendLabel, onSubmit, suggestions, busy }: AskProps) {
  const [text, setText] = useState("");
  const send = async (e?: FormEvent) => {
    e?.preventDefault();
    const v = text.trim();
    if (!v || busy) return;
    uiSound("send"); setText("");
    await onSubmit(v);
  };
  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => { if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); void send(); } };
  return (
    <form className="pu-ask" onSubmit={send}>
      <div className="pu-ask-field">
        <textarea className="pu-ask-input" rows={1} value={text} placeholder={placeholder} aria-label={label}
          onChange={(e) => { setText(e.target.value); e.target.style.height = "auto"; e.target.style.height = `${e.target.scrollHeight}px`; }} onKeyDown={onKey} />
        <Button type="submit" variant="primary" icon={<IconSend />} label={sendLabel} busy={busy} disabled={!text.trim() && !busy} />
      </div>
      {suggestions && suggestions.length > 0 && (
        <div className="pu-chips">{suggestions.slice(0, 3).map((s) => <Chip key={s} onClick={() => setText(s)}>{s}</Chip>)}</div>
      )}
    </form>
  );
}

/** A titled group inside the shell. `count` shows next to the title; `action` sits on the right (one ghost button). */
export function Section({ title, count, action, children, id }: { title: string; count?: number; action?: ReactNode; children: ReactNode; id?: string }) {
  const hid = id ? `${id}-h` : undefined;
  return (
    <section className="pu-section" aria-labelledby={hid}>
      <div className="pu-section-head">
        <h3 className="pu-section-title" id={hid}>{title}</h3>
        {count !== undefined && count > 0 && <span className="pu-count">{count}</span>}
        {action && <span className="pu-section-action">{action}</span>}
      </div>
      {children}
    </section>
  );
}
