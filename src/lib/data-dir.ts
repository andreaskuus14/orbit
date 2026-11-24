import os from "node:os";
import path from "node:path";

/** ORBIT's local data folder (same rule as translate.ts, life.ts, …): ORBIT_DATA_DIR, else %LOCALAPPDATA%\orbit, else ~/.orbit. */
export const orbitDataDir = () =>
  process.env.ORBIT_DATA_DIR?.trim() || (process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, "orbit") : path.join(os.homedir(), ".orbit"));

/** Map caches (tiles, buildings, places, regions): under the data dir, not the repo (no OneDrive sync, survives a re-clone). */
export const earthCacheDir = (...parts: string[]) => path.join(orbitDataDir(), "cache", "earth", ...parts);
