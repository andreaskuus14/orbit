"use client";
// Buttons: primary (the planet's accent, at most one per view), secondary (default), ghost (toolbars, "…"), danger.
// Press feedback is instant (CSS, 120 ms). `busy` keeps the width, shows a spinner and sets aria-busy; it doesn't disable
// focus. Icon-only buttons need a `label` (screen readers + tooltip). No sound: buttons are used too often (design-language.md).
import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";

export type ButtonProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, "aria-label"> & {
  variant?: "primary" | "secondary" | "ghost" | "danger";
  size?: "sm" | "md" | "lg";
  busy?: boolean;
  icon?: ReactNode;        // leading icon (16 px)
  label?: string;          // required when there is no visible text (icon-only)
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "secondary", size = "md", busy = false, icon, label, children, className, type = "button", onClick, ...rest }, ref) {
  const iconOnly = !children;
  return (
    <button ref={ref} type={type} className={`pu-btn${className ? " " + className : ""}`} data-variant={variant} data-size={size} data-icon={iconOnly ? "" : undefined}
      aria-label={label} title={iconOnly ? label : undefined} aria-busy={busy || undefined}
      onClick={(e) => { if (busy) { e.preventDefault(); return; } onClick?.(e); }} {...rest}>
      {icon}{children && <span>{children}</span>}
      {busy && <span className="pu-spin" aria-hidden="true" />}
    </button>
  );
});
