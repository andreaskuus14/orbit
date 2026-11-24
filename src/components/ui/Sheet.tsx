"use client";
// Secondary sheet: slides over the planet shell from the right for the things that aren't the main job (all tools, settings,
// a record's details). Lives inside the shell (absolute), so the galaxy stays visible. Focus moves in and back, Esc closes
// (useDialogFocus), the scrim click closes. Open/close have a soft sound; reduced motion fades instead of sliding.
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { DUR } from "@/lib/ui-motion-pure";
import { useDialogFocus } from "../useDialogFocus";
import { Button } from "./Button";
import { IconClose } from "./icons";
import { uiSound } from "./sound";

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
  if (!shown && !open) return null; // open renders in the same commit as the click (instant feedback); the effect only adds the sound
  const c = closing ? "" : undefined;
  return <>
    <div className="pu-sheet-scrim" data-closing={c} onClick={onClose} aria-hidden="true" />
    <div ref={ref} className="pu-sheet" data-closing={c} role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1}>
      <header className="pu-head">
        <div className="pu-head-text"><h3 className="pu-title" id={titleId}>{title}</h3></div>
        <Button variant="ghost" icon={<IconClose />} label={closeLabel} onClick={onClose} />
      </header>
      <div className="pu-body">{children}</div>
      {footer && <footer className="pu-head" style={{ justifyContent: "flex-end" }}>{footer}</footer>}
    </div>
  </>;
}
