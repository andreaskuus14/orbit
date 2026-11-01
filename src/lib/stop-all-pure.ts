// Global Stop-all (kill switch): pure rules, tested in tests/stop-all.test.ts. Server glue: stop-all.ts; API: /api/stop-all.

export const PAUSED_MSG = "ORBIT is paused (Stop-all is on)";
export type StopState = { on: boolean; at: string };
export const STOP_OFF: StopState = { on: false, at: "" };
export const STOP_ALL_EVENT = "orbit:stop-all";
export type StopAllDetail = { on: boolean; host?: string | null }; // host: last scheduler heartbeat (host-heartbeat.ts)
// A newly mounted listener asks the sole poller to replay its known state.
export const STOP_ALL_REQUEST_EVENT = "orbit:stop-all-request";

/** CORE tools that start agents, plans, goals, scout runs or uploads. Read-only tools and memory/LIFE/workspace writes still work. */
export const STARTS_WORK = ["ask_agent", "plan_task", "create_goal", "start_mission", "run_scout", "run_niche", "schedule_approved", "higgsfield_draft", "ws_picture_draft", "ws_run", "local_3d", "local_tts", "roblox_export"];

/** The tool result CORE gets instead of running the tool, or "" when it may run. */
export const coreToolRefusal = (on: boolean, tool: string) => (on && STARTS_WORK.includes(tool) ? `Error: ${PAUSED_MSG}` : "");

/** stop-all.json text → state. Missing or unreadable = off (the file is only ever written atomically). */
export function parseStop(raw: string | null): StopState {
  try {
    const o = JSON.parse(raw ?? "");
    if (o && typeof o === "object" && typeof o.on === "boolean") return { on: o.on, at: typeof o.at === "string" ? o.at : "" };
  } catch { /* off */ }
  return STOP_OFF;
}
