// "Starts with Windows" (tools/autostart): a per-user Task Scheduler task "ORBIT" at sign-in, or the older Startup-folder shortcut
// (scripts/install-shortcut.ps1 -Autostart). IO: autostart.ts.
export const TASK_NAME = "ORBIT";
export const ENABLE_CMD = "powershell -NoProfile -ExecutionPolicy Bypass -File tools\\autostart\\enable.ps1";
export const DISABLE_CMD = "powershell -NoProfile -ExecutionPolicy Bypass -File tools\\autostart\\disable.ps1";

export type Autostart = { on: boolean | null; how: "task" | "shortcut" | null; text: string; command: string };

/** task: the scheduled task exists (null = couldn't check: not Windows); shortcut: the Startup shortcut exists. */
export function autostartView(task: boolean | null, shortcut: boolean): Autostart {
  if (task === null) return { on: null, how: null, text: "Only on the Windows PC ORBIT runs on.", command: ENABLE_CMD };
  if (task) return { on: true, how: "task", text: "On: ORBIT's server starts when you sign in to Windows (Task Scheduler task \"ORBIT\").", command: DISABLE_CMD };
  if (shortcut) return { on: true, how: "shortcut", text: "On (Startup-folder shortcut). Turning it on again moves it to Task Scheduler.", command: DISABLE_CMD };
  return { on: false, how: null, text: "Off: start ORBIT yourself after signing in.", command: ENABLE_CMD };
}
