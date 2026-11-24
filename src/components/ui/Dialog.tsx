"use client";
// In-app replacements for the browser's confirm() / prompt(): askConfirm() and askText() return promises and show one
// small kit dialog (glass, accent of the page's planet when inside one). The host mounts itself on first use, so no page
// has to add anything. Esc or the scrim = cancel; Enter in the field = OK. Labels come from the caller or common.* keys.
import { useEffect, useId, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { useDialogFocus } from "../useDialogFocus";
import { useT } from "../i18n";
import { Button } from "./Button";
import "@/app/planet-ui.css";

type Opts = { ok?: string; cancel?: string; danger?: boolean; value?: string; placeholder?: string };
type Req = Opts & { text: string; field: boolean; done: (v: string | null) => void };

let push: ((r: Req) => void) | null = null;
const waiting: Req[] = [];
function open(r: Req) {
  if (typeof document === "undefined") return r.done(null);
  if (push) return push(r);
  waiting.push(r);
  if (waiting.length > 1) return;
  const el = document.createElement("div");
  document.body.appendChild(el);
  createRoot(el).render(<DialogHost />);
}

/** Yes/no question. Resolves true only on OK. */
export function askConfirm(text: string, o: Opts = {}) {
  return new Promise<boolean>((res) => open({ ...o, text, field: false, done: (v) => res(v !== null) }));
}
/** One line of text. Resolves the text, or null on cancel. */
export function askText(text: string, o: Opts = {}) {
  return new Promise<string | null>((res) => open({ ...o, text, field: true, done: res }));
}

function DialogHost() {
  const { t } = useT();
  const [q, setQ] = useState<Req[]>([]);
  useEffect(() => {
    push = (r) => setQ((l) => [...l, r]);
    setQ(waiting.splice(0));
    return () => { push = null; };
  }, []);
  const cur = q[0];
  const [val, setVal] = useState("");
  useEffect(() => { setVal(cur?.value ?? ""); }, [cur]);
  const ref = useRef<HTMLDivElement>(null), input = useRef<HTMLInputElement>(null), id = useId();
  const finish = (v: string | null) => { if (!cur) return; cur.done(v); setQ((l) => l.slice(1)); };
  useDialogFocus(ref, !!cur, () => finish(null));
  useEffect(() => { if (cur?.field) input.current?.select(); }, [cur]);
  if (!cur) return null;
  return (
    <div className="pu pu-dialog-wrap">
      <div className="pu-sheet-scrim" onClick={() => finish(null)} aria-hidden="true" />
      <div ref={ref} className="pu-dialog" role="alertdialog" aria-modal="true" aria-labelledby={id} tabIndex={-1}>
        <form onSubmit={(e) => { e.preventDefault(); finish(cur.field ? val : ""); }}>
          <p id={id} className="pu-dialog-text">{cur.text}</p>
          {cur.field && <input ref={input} className="pu-dialog-input" value={val} placeholder={cur.placeholder} aria-labelledby={id} onChange={(e) => setVal(e.target.value)} />}
          <div className="pu-dialog-actions">
            <Button type="button" variant="ghost" onClick={() => finish(null)}>{cur.cancel ?? t("common.cancel")}</Button>
            <Button type="submit" variant={cur.danger ? "danger" : "primary"}>{cur.ok ?? t("common.ok")}</Button>
          </div>
        </form>
      </div>
    </div>
  );
}
