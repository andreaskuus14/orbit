import { writeFile } from "node:fs/promises";
import path from "node:path";

// The self-update request flag scripts/launch.ps1's supervisor checks every 5 s (pull main fast-forward, build into .next-build, swap,
// health-check, roll back to .next-prev). Written by POST /api/system/update (owner click) and by an approved night-repair patch.
export const updateFlag = () => path.join(process.cwd(), "orbit-update.request");
/** true when queued; false outside the production server (npm run dev has no supervisor). rebuild: build even if main didn't move. */
export async function requestUpdate(rebuild: boolean): Promise<boolean> {
  if (process.env.NODE_ENV !== "production") return false;
  await writeFile(updateFlag(), `${new Date().toISOString()}${rebuild ? " rebuild" : ""}`, "utf8"); // launch.ps1 looks for "rebuild"
  return true;
}
