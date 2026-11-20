import { readFileSync } from "node:fs";
import { mkdir, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { orbitDataDir } from "./data-dir.ts";

// Owner presence stamps: <ORBIT data dir>/presence.json {ui, voice} (ms epoch). The scheduler may run in another process than the web
// server, so the stamps live in a file; writes are throttled (one per 30 s per kind), reads cached for 5 s. CORE turns need no stamp:
// the usage meter already knows when the last "core" call ran (usage-meter.ts presence()). Nothing private is stored: only times.
export type Kind = "ui" | "voice";
const file = () => path.join(orbitDataDir(), "presence.json");
const g = globalThis as unknown as { __orbitPresence?: { p: { ui?: number; voice?: number }; read: number; wrote: number } };
const S = () => (g.__orbitPresence ??= { p: {}, read: 0, wrote: 0 });

/** The owner is using ORBIT right now (a signed-in UI heartbeat, or a voice turn). Never throws. */
export function notePresence(kind: Kind, now = Date.now()) {
  try {
    const s = S();
    s.p = { ...readStamps(now), [kind]: now };
    if (now - s.wrote < 30_000) return;
    s.wrote = now;
    void mkdir(path.dirname(file()), { recursive: true }).then(() => writeFile(file() + ".tmp", JSON.stringify(s.p))).then(() => rename(file() + ".tmp", file()))
      .catch((e) => console.error("[orbit] presence not saved:", e instanceof Error ? e.message : e));
  } catch { /* presence is advisory */ }
}

function readStamps(now: number) {
  const s = S();
  if (now - s.read >= 5_000) {
    s.read = now;
    try {
      const o = JSON.parse(readFileSync(file(), "utf8")) as { ui?: unknown; voice?: unknown };
      const n = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : undefined);
      // the newer of the file (another process) and this process's own stamp
      s.p = { ui: Math.max(n(o.ui) ?? 0, s.p.ui ?? 0) || undefined, voice: Math.max(n(o.voice) ?? 0, s.p.voice ?? 0) || undefined };
    } catch { /* no file yet */ }
  }
  return s.p;
}

export const presenceStamps = (now = Date.now()) => readStamps(now);
