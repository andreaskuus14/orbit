import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { orbitDataDir } from "../data-dir";
import { parseHistory, type History } from "./baseline-pure";

// Reach history: <data dir>/reach-history.json, plain numbers per source and day (capped in baseline-pure.ts: 30 days, 120 sources).
const file = () => path.join(orbitDataDir(), "reach-history.json");

export async function loadHistory(): Promise<History> {
  const raw = await readFile(file(), "utf8").catch(() => null);
  if (raw === null) return {};
  try { return parseHistory(JSON.parse(raw)); } catch { return {}; }
}

export async function saveHistory(h: History): Promise<void> {
  await mkdir(path.dirname(file()), { recursive: true });
  await writeFile(file() + ".tmp", JSON.stringify(h));
  await rename(file() + ".tmp", file());
}
