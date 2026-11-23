"use client";
// Toasts: short "it happened" notes at the bottom centre ("Saved", "3 Shorts ready · Open"). toast() from anywhere;
// one <Toaster/> per page shows them. At most 3, newest at the bottom; hover or focus pauses the timer; errors stay longer
// and are announced assertively. done/error tones play their sound. A toast never asks for approval: that's a Card.
import { useCallback, useEffect, useRef, useState } from "react";
import { pushToast, toastMs } from "@/lib/planet-ui-pure";
import { Button } from "./Button";
import { IconAlert, IconCheck, IconClose } from "./icons";
import { uiSound } from "./sound";

export const TOAST_EVENT = "orbit:ui-toast";
export type ToastInput = { text: string; tone?: "info" | "done" | "error"; action?: { label: string; onClick: () => void }; id?: string };
type T = ToastInput & { id: string; closing?: boolean };

let seq = 0;
/** Show a toast. Same id replaces the earlier one (e.g. "Saving…" → "Saved"). */
export function toast(t: ToastInput) {
  if (typeof window === "undefined") return;
  dispatchEvent(new CustomEvent<ToastInput>(TOAST_EVENT, { detail: { ...t, id: t.id ?? `t${++seq}` } }));
}

export function Toaster({ dismissLabel }: { dismissLabel: string }) {
  const [list, setList] = useState<T[]>([]);
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const close = useCallback((id: string) => {
    setList((l) => l.map((x) => (x.id === id ? { ...x, closing: true } : x)));
    setTimeout(() => setList((l) => l.filter((x) => x.id !== id)), 200);
  }, []);
  const arm = useCallback((t: T) => {
    clearTimeout(timers.current.get(t.id));
    timers.current.set(t.id, setTimeout(() => close(t.id), toastMs({ tone: t.tone, action: !!t.action, text: t.text })));
  }, [close]);
  useEffect(() => {
    const on = (e: Event) => {
      const t = (e as CustomEvent<T>).detail;
      setList((l) => pushToast(l, t)); arm(t);
      if (t.tone === "done") uiSound("done"); else if (t.tone === "error") uiSound("error");
    };
    addEventListener(TOAST_EVENT, on);
    const ts = timers.current;
    return () => { removeEventListener(TOAST_EVENT, on); ts.forEach(clearTimeout); };
  }, [arm]);
  const pause = (id: string) => clearTimeout(timers.current.get(id));
  return (
    <div className="pu pu-toasts" aria-live="polite">
      {list.map((t) => (
        <div key={t.id} className="pu-toast" data-closing={t.closing ? "" : undefined} role={t.tone === "error" ? "alert" : "status"}
          onMouseEnter={() => pause(t.id)} onMouseLeave={() => arm(t)} onFocus={() => pause(t.id)} onBlur={() => arm(t)}>
          {t.tone === "done" && <span style={{ color: "var(--pu-good)", display: "flex" }}><IconCheck /></span>}
          {t.tone === "error" && <span style={{ color: "var(--pu-bad)", display: "flex" }}><IconAlert /></span>}
          <span className="pu-toast-text">{t.text}</span>
          {t.action && <Button size="sm" onClick={() => { close(t.id); t.action!.onClick(); }}>{t.action.label}</Button>}
          <Button size="sm" variant="ghost" icon={<IconClose />} label={dismissLabel} onClick={() => close(t.id)} />
        </div>
      ))}
    </div>
  );
}
