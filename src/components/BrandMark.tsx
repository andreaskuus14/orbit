"use client";
import { useEffect, useRef, useState } from "react";

/** The ORBIT logo image (/brand/orbit-mark.png, only on the owner's PC) or, when it is missing, a text mark of the same size.
 *  The effect also catches a 404 that happened before hydration, when onError wasn't attached yet. */
export function BrandMark({ size, className }: { size: number; className?: string }) {
  const [failed, setFailed] = useState(false);
  const img = useRef<HTMLImageElement>(null);
  useEffect(() => { const i = img.current; if (i?.complete && !i.naturalWidth) setFailed(true); }, []);
  // Fallback: a small orbit mark (a core and one tilted orbit), crisp at any size; the old fallback was a monospace "O" that read as a zero.
  if (failed) return (
    <svg aria-hidden="true" focusable="false" className={`brand-mark shrink-0 ${className ?? ""}`} width={size} height={size} viewBox="0 0 28 28">
      <rect width="28" height="28" rx="8" fill="#0d121c" stroke="rgba(255,255,255,.12)" />
      <ellipse cx="14" cy="14" rx="10" ry="4.2" fill="none" stroke="#9fdcff" strokeOpacity=".75" strokeWidth="1.2" transform="rotate(-24 14 14)" />
      <circle cx="14" cy="14" r="3.6" fill="#eef4ff" /><circle cx="21.7" cy="9.9" r="1.4" fill="#9fdcff" />
    </svg>);
  // eslint-disable-next-line @next/next/no-img-element
  return <img ref={img} src="/brand/orbit-mark.png" alt="" width={size} height={size} className={className} onError={() => setFailed(true)} />;
}
