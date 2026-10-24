// A line of the alien script (alien-script-pure) as inline SVG: decorative, always aria-hidden. `text` is transliterated
// glyph by glyph; `codes` draws given glyphs (serials). Sized in px by the glyph radius r; strokes use currentColor.
import { encode, linePath } from "@/lib/alien-script-pure";

export function AlienScript({ text = "", codes, r = 3.4, stroke = 0.85, className }: { text?: string; codes?: number[]; r?: number; stroke?: number; className?: string }) {
  const { d, w, h } = linePath(codes ?? encode(text), r);
  return (
    <svg aria-hidden="true" focusable="false" className={className} width={w} height={h} viewBox={`0 0 ${w} ${h}`}
      fill="none" stroke="currentColor" strokeWidth={stroke} strokeLinecap="round"><path d={d} pathLength={1} /></svg>
  );
}
