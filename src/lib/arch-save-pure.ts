// ARCH durable save (ARC01) and revision-aware AI edits (ARC02). Pure: no React, no fetch.
import type { Op, Part, Scene } from "./arch-pure.ts";

/** What the save badge shows. "local" = kept in this browser only (server unreachable or not signed in). */
export type SaveState = { status: "idle" | "saving" | "saved" | "failed" | "local" | "conflict"; rev: number; error?: string; serverRev?: number };
export type SaveEvent = { type: "start" | "ok" | "fail" | "local" | "conflict"; rev: number; error?: string; serverRev?: number };
/** Only network/5xx failures get a plain Retry; a "conflict" (409, newer copy elsewhere) needs an explicit choice. */
export const canRetry = (s: SaveState) => s.status === "failed";

/** "saved" only when the newest started revision is confirmed; a late ok for an older rev never hides a newer save or failure. */
export function saveStep(s: SaveState, e: SaveEvent): SaveState {
  if (e.type === "start") return e.rev >= s.rev ? { status: "saving", rev: e.rev } : s;
  if (e.rev < s.rev) return s; // answer for an older save: the newer one decides
  if (e.type === "ok") return { status: "saved", rev: e.rev };
  if (e.type === "conflict") return { status: "conflict", rev: e.rev, serverRev: e.serverRev, error: e.error };
  if (e.type === "local") return { status: "local", rev: e.rev, error: e.error };
  return { status: "failed", rev: e.rev, error: e.error };
}

export type Saved = { rev: number; scene: Scene; prices?: unknown; site?: unknown; variants?: unknown; at?: string };
/** Which copy to open: the higher revision wins, ties go to the local one (it is what he last saw on this PC). */
export function pickNewer(local: Saved | null, server: Saved | null): Saved | null {
  const ok = (x: Saved | null) => (x?.scene?.parts && Array.isArray(x.scene.parts) ? x : null);
  const l = ok(local), s = ok(server);
  if (!l || !s) return l ?? s;
  return (s.rev ?? 0) > (l.rev ?? 0) ? s : l;
}

/** Server-side: accept a save unless a newer revision is already stored. */
export const acceptSave = (stored: { rev?: number } | null | undefined, rev: unknown): rev is number =>
  typeof rev === "number" && Number.isInteger(rev) && rev >= 0 && rev >= (stored?.rev ?? 0);

const same = (a: Part | undefined, b: Part | undefined) => !!a && !!b && JSON.stringify(a) === JSON.stringify(b);
const targets = (o: Op): string | undefined => ("id" in o ? o.id : "host" in o ? o.host : undefined);

/**
 * An AI reply computed against `base` lands on `cur`. Same scene (or same rev) → apply.
 * Otherwise apply only if every part it touches still exists unchanged since `base` (and the plot is untouched for plot ops);
 * else "conflict" and the user decides. Plain adds need nothing.
 */
export function staleCheck(base: Scene, baseRev: number, cur: Scene, curRev: number, ops: Op[]): "apply" | "conflict" {
  if (base === cur || baseRev === curRev) return "apply";
  for (const o of ops) {
    if (o.op === "plot") { if (JSON.stringify(base.plot) !== JSON.stringify(cur.plot)) return "conflict"; continue; }
    const id = targets(o);
    if (id && !same(base.parts.find((p) => p.id === id), cur.parts.find((p) => p.id === id))) return "conflict";
  }
  return "apply";
}
