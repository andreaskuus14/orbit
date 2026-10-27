"use client";
import { useEffect, useRef, type RefObject } from "react";

// a11y for hand-made dialogs/drawers (native <dialog>.showModal() does this itself): while `open`, focus moves in
// (unless already inside, or the user is typing in a field), Esc calls onClose, and on close focus goes back to whatever had it before.
// The element needs tabIndex={-1}. Esc listens in the capture phase and preventDefaults, so Orbit's window Esc
// (which skips defaultPrevented keys) doesn't also close the panel underneath: one Esc does one thing.
export function useDialogFocus(ref: RefObject<HTMLElement | null>, open = true, onClose?: () => void) {
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    if (!open) return;
    const el = ref.current, opener = document.activeElement as HTMLElement | null;
    const typing = !!opener && (/^(INPUT|TEXTAREA|SELECT)$/.test(opener.tagName) || opener.isContentEditable); // opened from the command bar: keep the caret
    if (el && !typing && !el.contains(opener)) el.focus({ preventScroll: true });
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented || !close.current) return;
      if (document.querySelector("dialog[open], :popover-open")) return; // that overlay is on top: its own Esc closes it
      e.preventDefault(); close.current();
    };
    addEventListener("keydown", onKey, true);
    return () => {
      removeEventListener("keydown", onKey, true);
      const now = document.activeElement; // only hand focus back if it is still ours (or lost), never steal it
      if (opener?.isConnected && opener !== document.body && (!now || now === document.body || el?.contains(now))) opener.focus({ preventScroll: true });
    };
  }, [open, ref]);
}
