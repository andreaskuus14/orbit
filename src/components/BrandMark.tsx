"use client";
import { useEffect, useRef, useState } from "react";

/** The ORBIT logo image (/brand/orbit-mark.png, only on the owner's PC) or, when it is missing, a text mark of the same size.
 *  The effect also catches a 404 that happened before hydration, when onError wasn't attached yet. */
export function BrandMark({ size, className }: { size: number; className?: string }) {
  const [failed, setFailed] = useState(false);
  const img = useRef<HTMLImageElement>(null);
  useEffect(() => { const i = img.current; if (i?.complete && !i.naturalWidth) setFailed(true); }, []);
  if (failed) return <span aria-hidden className={`brand grid shrink-0 place-items-center ${className ?? ""}`} style={{ width: size, height: size, fontSize: size * 0.5 }}>O</span>;
  // eslint-disable-next-line @next/next/no-img-element
  return <img ref={img} src="/brand/orbit-mark.png" alt="" width={size} height={size} className={className} onError={() => setFailed(true)} />;
}
