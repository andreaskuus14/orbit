// Remote home screen wording and order (layout only: no I/O).
import { plural, translate, type Lang } from "./i18n-pure.ts";

/** The one big line at the top of the phone. */
export function headline(waiting: number, paused: boolean, lang: Lang = "en"): string {
  if (paused) return translate(lang, "remote.paused");
  if (!waiting) return translate(lang, "remote.quiet");
  return plural(lang, "remote.need", waiting);
}

// Money first (largest quote first), then messages that leave the house, then clips.
const RANK: Record<string, number> = { spend: 0, send: 1, invoice: 1, nego: 2, clip: 3 };

/** "Needs you" stack, biggest first. Stable: equal items keep the server's order. */
export function biggestFirst<T extends { kind: string; credits?: number }>(items: T[]): T[] {
  return items.map((it, i) => ({ it, i }))
    .sort((a, b) => (RANK[a.it.kind] ?? 9) - (RANK[b.it.kind] ?? 9) || (b.it.credits ?? 0) - (a.it.credits ?? 0) || a.i - b.i)
    .map((x) => x.it);
}
