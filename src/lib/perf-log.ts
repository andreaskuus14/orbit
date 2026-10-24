// In-memory perf rings for /api/perf (server only; lost on restart). Timings and step names only, never message text.
import { corePath, type CoreTurn, type SceneWindow } from "./perf-pure";

const g = globalThis as { __orbitPerf?: unknown[]; __orbitFrames?: SceneWindow[]; __orbitCoreTurns?: CoreTurn[] };
export const longFrames = (g.__orbitPerf ??= []);
export const sceneWindows = (g.__orbitFrames ??= []);
export const coreTurns = (g.__orbitCoreTurns ??= []);

/** Called once per CORE turn by runCore: keeps the stage timings (ms since turn start) and which path answered. */
export function recordCoreTurn(tier: string, ms: Record<string, number>, total: number, trace: { step: string }[]) {
  coreTurns.push({ path: corePath(tier, trace.map((t) => t.step)), at: Date.now(), ms: { ...ms, total } });
  coreTurns.splice(0, Math.max(0, coreTurns.length - 500));
}
