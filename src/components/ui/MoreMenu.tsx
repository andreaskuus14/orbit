"use client";
// The "…" menu: everything that isn't the planet's main job (all tools, settings, help). Keyboard: Enter/Space/ArrowDown
// opens, arrows/Home/End move, letters jump, Esc closes and returns focus, Tab closes. Click outside closes.
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { menuMove, menuSeek } from "@/lib/planet-ui-pure";
import { Button } from "./Button";
import { IconMore } from "./icons";
import { uiSound } from "./sound";

export type MenuItem = { label: string; onSelect: () => void; icon?: ReactNode; hint?: string; danger?: boolean; disabled?: boolean } | "separator";

export function MoreMenu({ items, label, align = "end" }: { items: MenuItem[]; label: string; align?: "start" | "end" }) {
  const [open, setOpen] = useState(false);
  const [at, setAt] = useState(-1);
  const wrap = useRef<HTMLDivElement>(null), btn = useRef<HTMLButtonElement>(null), refs = useRef<(HTMLButtonElement | null)[]>([]);
  const id = useId();
  const real = items.filter((x): x is Exclude<MenuItem, "separator"> => x !== "separator");
  const disabled = real.map((x) => !!x.disabled);

  const show = (first: "Home" | "End" = "Home") => { setOpen(true); setAt(menuMove(disabled, -1, first)); uiSound("menu"); };
  const hide = (focusBack = true) => { setOpen(false); setAt(-1); if (focusBack) btn.current?.focus(); };
  useEffect(() => { if (open && at >= 0) refs.current[at]?.focus(); }, [open, at]);
  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => { if (!wrap.current?.contains(e.target as Node)) hide(false); };
    addEventListener("pointerdown", away, true);
    return () => removeEventListener("pointerdown", away, true);
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); hide(); return; }
    if (e.key === "Tab") { hide(false); return; }
    if (e.key === "ArrowDown" || e.key === "ArrowUp" || e.key === "Home" || e.key === "End") { e.preventDefault(); setAt(menuMove(disabled, at, e.key)); return; }
    if (e.key.length === 1 && /\S/.test(e.key)) setAt(menuSeek(real.map((x) => x.label), disabled, at, e.key));
  };
  let n = -1;
  return (
    <div className="pu-menu-wrap" ref={wrap}>
      <Button ref={btn} variant="ghost" icon={<IconMore />} label={label} aria-haspopup="menu" aria-expanded={open} aria-controls={open ? id : undefined}
        onClick={() => (open ? hide() : show())} onKeyDown={(e) => { if (!open && (e.key === "ArrowDown" || e.key === "ArrowUp")) { e.preventDefault(); show(e.key === "ArrowUp" ? "End" : "Home"); } }} />
      {open && (
        <ul className="pu-menu" id={id} role="menu" aria-label={label} data-align={align} onKeyDown={onKey}>
          {items.map((it, k) => {
            if (it === "separator") return <li key={`s${k}`} role="separator" className="pu-menu-sep" />;
            const i = ++n;
            return (
              <li key={it.label} role="none">
                <button type="button" role="menuitem" ref={(el) => { refs.current[i] = el; }} tabIndex={i === at ? 0 : -1} disabled={it.disabled}
                  className="pu-menu-item" data-danger={it.danger ? "" : undefined} onClick={() => { hide(); it.onSelect(); }}>
                  {it.icon}<span>{it.label}</span>{it.hint && <kbd>{it.hint}</kbd>}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
