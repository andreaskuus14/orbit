import { NAV_EVENT, navReply, type NavTarget } from "../lib/nav-pure.ts";
import { loadVoiceSettings, saveVoiceSettings } from "./voice/bus.ts";

export const STOP_ALL_CHANGED = "orbit:stop-all-changed";
export const COMMAND_REPLY_EVENT = "orbit:command-reply";

/** Shared by the HUD button and instant commands. Confirm success before reporting it. */
export async function changeStopAll(on: boolean): Promise<string | undefined> {
  const r = await fetch("/api/stop-all", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ on }) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || `Couldn't switch Stop-all (${r.status})`);
  if (j.stop?.on !== on) throw new Error("Couldn't confirm Stop-all. Try again.");
  dispatchEvent(new Event(STOP_ALL_CHANGED));
  return j.warning;
}

/** No model calls: use the same settings, endpoint and navigation event as the app's controls. */
export async function runNavCommand(t: NavTarget): Promise<string> {
  if (t.stopAll) return await changeStopAll(true) || navReply(t);
  if (t.voice !== undefined) saveVoiceSettings({ ...loadVoiceSettings(), speak: t.voice });
  else dispatchEvent(new CustomEvent(NAV_EVENT, { detail: t }));
  return navReply(t);
}
