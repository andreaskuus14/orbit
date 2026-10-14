import type { ReactNode } from "react";
import { COUNTRIES, displayName } from "@/lib/geo";

// Colour-codes plain text so answers and briefings are easier to scan:
// numbers/money/percentages, places, and verification labels. Pure presentation; the text is unchanged.
const PLACES = [...new Set(COUNTRIES.flatMap((c) => [displayName(c.name), ...c.terms.filter((t) => /^[A-Z][a-z]/.test(t) && t.length > 3)]))]
  .sort((a, b) => b.length - a.length).map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
const RE = new RegExp(
  [
    String.raw`(?<num>(?:[$€£¥]\s?)?\d+(?:[,.]\d+)*(?:\s?(?:%|percent|million|billion|trillion|bn\b|m\b|k\b))?(?:\s(?:USD|EUR|dollars|euros))?)`,
    String.raw`(?<ok>\bConfirmed\b|\bVerified\b)`,
    String.raw`(?<warn>\bSingle source\b|\bUnverified\b|\bUnconfirmed\b)`,
    String.raw`(?<bad>\bDisputed\b|\bContradicted\b|\bFalse\b)`,
    `(?<place>(?<![\\p{L}])(?:${PLACES.join("|")})(?![\\p{L}]))`,
  ].join("|"),
  "gu",
);

export function highlight(text: string, key: string | number = 0): ReactNode[] {
  const out: ReactNode[] = [];
  let last = 0, n = 0;
  for (const m of text.matchAll(RE)) {
    const g = m.groups ?? {};
    // Lone small numbers ("2 people", list counters) stay plain; years and figures get colour.
    if (g.num && /^\d{1,2}$/.test(g.num)) continue;
    if (m.index! > last) out.push(text.slice(last, m.index));
    const cls = g.num ? "hl-num" : g.ok ? "hl-ok" : g.warn ? "hl-warn" : g.bad ? "hl-bad" : "hl-place";
    out.push(<span key={`${key}-${n++}`} className={cls}>{m[0]}</span>);
    last = m.index! + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}
