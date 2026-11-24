"use client";
// Secondary sheet: slides over the planet shell from the right for the things that aren't the main job (all tools, settings,
// a record's details). Lives inside the shell (absolute), so the galaxy stays visible. Focus moves in and back, Esc closes
// (useDialogFocus), Tab stays inside, the scrim click closes. Open/close have a soft sound; reduced motion fades instead of sliding.
import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { DUR } from "@/lib/ui-motion-pure";
import { useDialogFocus } from "../useDialogFocus";
import { Button } from "./Button";
import { IconClose } from "./icons";
import { uiSound } from "./sound";

const FOCUSABLE = "a[href], button, input, select, textarea, [tabindex]:not([tabindex=\"-1\"])";

export function Sheet({ open, title, onClose, closeLabel, children, footer }: {
  open: boolean; title: string; onClose: () => void; closeLabel: string; children: ReactNode; footer?: ReactNode;
}) {
  const [shown, setShown] = useState(open);
  const [closing, setClosing] = useState(false);
  const ref = useRef<HTMLDivElement>(null), titleId = useId();
  useEffect(() => {
    if (open) { setShown(true); setClosing(false); uiSound("sheetOpen"); return; }
    if (!shown) return;
    setClosing(true); uiSound("sheetClose");
    const t = setTimeout(() => { setShown(false); setClosing(false); }, DUR.quick);
    return () => clearTimeout(t);
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  useDialogFocus(ref, open, onClose);
  // aria-modal: Tab and Shift+Tab stay inside the sheet (wrap from last to first and back)
  const trap = (e: KeyboardEvent) => {
    if (e.key !== "Tab" || !ref.current) return;
    const f = [...ref.current.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((x) => !x.hasAttribute("disabled") && x.offsetParent !== null);
    if (!f.length) return;
    const first = f[0], last = f[f.length - 1], at = document.activeElement;
    if (e.shiftKey && (at === first || at === ref.current)) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && at === last) { e.preventDefault(); first.focus(); }
  };
  if (!shown && !open) return null; // open renders in the same commit as the click (instant feedback); the effect only adds the sound
  const c = closing ? "" : undefined;
  return <>
    <div className="pu-sheet-scrim" data-closing={c} onClick={onClose} aria-hidden="true" />
    <div ref={ref} className="pu-sheet" data-closing={c} role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1} onKeyDown={trap}>
      <header className="pu-head">
        <div className="pu-head-text"><h3 className="pu-title" id={titleId}>{title}</h3></div>
        <Button variant="ghost" icon={<IconClose />} label={closeLabel} onClick={onClose} />
      </header>
      <div className="pu-body" tabIndex={0}>{children}</div>
      {footer && <footer className="pu-head" style={{ justifyContent: "flex-end" }}>{footer}</footer>}
    </div>
  </>;
}
