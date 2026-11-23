// Crisp 16 px stroke icons for the planet UI (1.5 px strokes on a 16 grid, currentColor, no emoji). Decorative: aria-hidden.
import type { SVGProps } from "react";

const I = ({ d, ...p }: { d: string } & SVGProps<SVGSVGElement>) => (
  <svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false" {...p}><path d={d} /></svg>
);
export const IconMore = (p: SVGProps<SVGSVGElement>) => (
  <svg viewBox="0 0 16 16" width="16" height="16" fill="currentColor" aria-hidden="true" focusable="false" {...p}><circle cx="3.5" cy="8" r="1.25" /><circle cx="8" cy="8" r="1.25" /><circle cx="12.5" cy="8" r="1.25" /></svg>
);
export const IconClose = (p: SVGProps<SVGSVGElement>) => <I d="M4 4l8 8M12 4l-8 8" {...p} />;
export const IconSend = (p: SVGProps<SVGSVGElement>) => <I d="M8 13V3M3.5 7.5L8 3l4.5 4.5" {...p} />;
export const IconCheck = (p: SVGProps<SVGSVGElement>) => <I d="M3 8.5l3 3 7-7" {...p} />;
export const IconAlert = (p: SVGProps<SVGSVGElement>) => <I d="M8 5v3.5M8 11h.01M8 1.75l6.5 12H1.5z" {...p} />;
export const IconChevron = (p: SVGProps<SVGSVGElement>) => <I d="M6 3.5L10.5 8 6 12.5" {...p} />;
export const IconBack = (p: SVGProps<SVGSVGElement>) => <I d="M10 3.5L5.5 8l4.5 4.5" {...p} />;
export const IconPlus = (p: SVGProps<SVGSVGElement>) => <I d="M8 3v10M3 8h10" {...p} />;
