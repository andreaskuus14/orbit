// Which engine runs CORE turns: Profile → CORE engine (<ORBIT data dir>/core-engine.json), else ORBIT_CORE_ENGINE, else the JSON loop.
// cli = CORE's own JSON tool loop over `claude -p` (default); mcp = Claude Code's native loop with ORBIT's tools (core-mcp.ts);
// sdk = the Agent SDK prototype (core-sdk.ts). Read on every turn from memory, so a switch applies to the next message.
import { readFileSync } from "node:fs";
import { mkdir, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { orbitDataDir } from "./data-dir.ts";
import { parseEngine, pickEngine, type Engine } from "./core-mcp-pure.ts";

const file = () => path.join(orbitDataDir(), "core-engine.json");
const g = globalThis as unknown as { __orbitEngine?: { saved: Engine | null } };
const saved = () => (g.__orbitEngine ??= { saved: (() => { try { return parseEngine(JSON.parse(readFileSync(file(), "utf8")).engine); } catch { return null; } })() }).saved;

export const envEngine = () => pickEngine(null, process.env.ORBIT_CORE_ENGINE);
export const coreEngine = (): Engine => pickEngine(saved(), process.env.ORBIT_CORE_ENGINE);

/** null = back to the env/default. Refuses anything else than json/cli, mcp, sdk. */
export async function setCoreEngine(raw: unknown): Promise<Engine | string> {
  const e = raw === null ? null : parseEngine(raw);
  if (raw !== null && !e) return "engine must be json, mcp or sdk";
  await mkdir(path.dirname(file()), { recursive: true });
  await writeFile(file() + ".tmp", JSON.stringify({ engine: e, at: new Date().toISOString() }));
  await rename(file() + ".tmp", file());
  g.__orbitEngine = { saved: e };
  return coreEngine();
}
