// "Starts with Windows", IO (rules: autostart-pure.ts). Runs only the two fixed scripts in tools/autostart (no admin, no input).
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { TASK_NAME, autostartView, type Autostart } from "./autostart-pure";

const WIN = process.platform === "win32";
const run = (file: string, args: string[], ms: number) =>
  new Promise<{ ok: boolean; out: string }>((r) => execFile(file, args, { timeout: ms, windowsHide: true }, (e, out, err) => r({ ok: !e, out: `${out}${err}`.trim().slice(-600) })));

export async function autostartState(): Promise<Autostart> {
  if (!WIN) return autostartView(null, false);
  const task = (await run("schtasks.exe", ["/Query", "/TN", TASK_NAME], 5000)).ok;
  const startup = path.join(process.env.APPDATA ?? "", "Microsoft", "Windows", "Start Menu", "Programs", "Startup", "ORBIT server.lnk");
  return autostartView(task, existsSync(startup));
}

/** The owner's click in OPERATIONS: register or remove the sign-in task. */
export async function setAutostart(on: boolean): Promise<Autostart & { log: string }> {
  if (!WIN) return { ...autostartView(null, false), log: "" };
  const script = path.join(process.cwd(), "tools", "autostart", on ? "enable.ps1" : "disable.ps1");
  const r = await run("powershell.exe", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", script], 30_000);
  return { ...(await autostartState()), log: r.out };
}
