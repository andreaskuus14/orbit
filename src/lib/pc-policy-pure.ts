// PC control policy (JARVIS phase 1): what ORBIT may do on the laptop through the local helper (tools/voice/orbit_voice.py),
// and how. Three levels:
//   1 runs now: open/focus an app, read a file or list a folder inside a connected folder, run a named build/test/render task,
//     media keys.
//   2 runs with a snapshot and Undo (OPERATIONS → Activity): move/rename a file inside connected folders, a code edit committed on
//     its own git branch.
//   3 waits for his explicit OK every time: delete (to the Recycle Bin), install, system settings. Voice "yes, do it" or a click.
// Sends, posts, payments/spends and logins are never PC actions: sends/posts/spends run only through ORBIT's own approval cards
// with his click (AGENTS.md rule 6), and ORBIT never logs in to outside platforms. Pure; tests/pc-policy.test.ts.
// Passwords/keys and his VAULT/journal/LIFE files are never touched, even inside a connected folder (command-policy-pure sensitivePath).
import { sensitivePath } from "./command-policy-pure.ts";

export type PcLevel = 1 | 2 | 3;
export const PC_ACTIONS = [
  "open_app", "focus_app", "read_file", "list_folder", "run_task", "media_key",
  "move_file", "rename_file", "code_edit",
  "delete_file", "install_app", "system_setting",
  "send", "publish", "spend", "login",
] as const;
export type PcAction = (typeof PC_ACTIONS)[number];

/** level, and click: true = only his click confirms (voice is not enough). */
export const PC_LEVEL: Record<PcAction, { level: PcLevel; click?: true; never?: string }> = {
  open_app: { level: 1 }, focus_app: { level: 1 }, read_file: { level: 1 }, list_folder: { level: 1 }, run_task: { level: 1 }, media_key: { level: 1 },
  move_file: { level: 2 }, rename_file: { level: 2 }, code_edit: { level: 2 },
  delete_file: { level: 3 }, install_app: { level: 3 }, system_setting: { level: 3 },
  send: { level: 3, click: true, never: "Sending goes through ORBIT's own approval cards (BUSINESS, Remote), with your click on the exact message." },
  publish: { level: 3, click: true, never: "Publishing goes through STUDIO review, with your Approve click on that clip." },
  spend: { level: 3, click: true, never: "Spending only happens from your Approve click on the exact quote." },
  login: { level: 3, click: true, never: "ORBIT never logs in to outside sites or apps for you: do that step yourself." },
};

export const MEDIA_KEYS = ["play_pause", "next", "previous", "volume_up", "volume_down", "mute"] as const;
export const RUN_TASKS = ["test", "build", "lint", "render"] as const; // npm scripts of that name in a connected folder's package.json
export const SETTINGS = ["dark_mode"] as const;
/** Known apps (lowercase name → Windows start target). More via ORBIT_PC_APPS (JSON {"name": "C:\\path\\app.exe"}). */
export const DEFAULT_APPS: Record<string, string> = {
  "vs code": "code", code: "code", "visual studio code": "code", notepad: "notepad", explorer: "explorer", "file explorer": "explorer",
  chrome: "chrome", edge: "msedge", "roblox studio": "RobloxStudioBeta", blender: "blender", obs: "obs64", spotify: "spotify",
  terminal: "wt", calculator: "calc", "task manager": "taskmgr",
};

export type PcRequest = { action: PcAction; args: Record<string, unknown> };
/** privatePaths: ORBIT's data folder (VAULT, LIFE) and ORBIT_PRIVATE_FOLDERS: never read, listed or changed, even under a connected folder. */
export type PcCtx = { stopAll: boolean; folders: readonly string[]; apps?: Record<string, string>; privatePaths?: readonly string[] };
/** run: "now" (level 1), "snapshot" (level 2: runs, Undo kept), "confirm" (level 3: queued for his OK), "refuse". */
export type PcVerdict =
  | { run: "now" | "snapshot"; level: 1 | 2; args: Record<string, string>; summary: string }
  | { run: "confirm"; level: 3; click: boolean; args: Record<string, string>; summary: string }
  | { run: "refuse"; level: PcLevel; reason: string };

const str = (v: unknown, max = 500) => (typeof v === "string" ? v.trim().slice(0, max) : "");

/** Windows-or-POSIX path → normalized lowercase forward-slash form for prefix checks; null when it isn't absolute or climbs (..). */
export function normPath(p: string): string | null {
  const s = p.trim().replace(/\\/g, "/").replace(/\/+/g, "/");
  if (!s || s.length > 400 || /[\0<>|"?*]/.test(s.replace(/^[a-z]:/i, ""))) return null;
  if (!/^[a-z]:\//i.test(s) && !s.startsWith("/")) return null;
  const parts = s.split("/");
  if (parts.some((x) => x === ".." || x === ".")) return null;
  return s.replace(/\/$/, "").toLowerCase();
}

/** True when `p` is one of the connected folders or inside one. */
export function insideFolders(p: string, folders: readonly string[]): boolean {
  const n = normPath(p);
  if (!n) return false;
  return folders.some((f) => { const r = normPath(f); return !!r && (n === r || n.startsWith(r + "/")); });
}

/** ORBIT_PC_FOLDERS ("C:\\Users\\me\\Games;D:\\Renders") → the connected folders. System folders are never connectable. */
export function parseFolders(raw: string | undefined): string[] {
  const SYSTEM = /^(?:[a-z]:\/(?:windows|program files(?: \(x86\))?|programdata)(?:\/|$)|[a-z]:\/?$|\/(?:etc|bin|usr|sys|proc)?$)/i;
  return (raw ?? "").split(";").map((x) => x.trim()).filter((x) => { const n = normPath(x); return !!n && !SYSTEM.test(n) && !/\/appdata(\/|$)/.test(n); }).slice(0, 20);
}

/** ORBIT_PC_APPS JSON → extra app names (lowercase). Bad JSON = none. */
export function parseApps(raw: string | undefined): Record<string, string> {
  try {
    const o = JSON.parse(raw ?? "") as unknown;
    if (!o || typeof o !== "object" || Array.isArray(o)) return {};
    return Object.fromEntries(Object.entries(o as Record<string, unknown>).filter(([k, v]) => typeof v === "string" && k.length <= 40 && v.length <= 300).map(([k, v]) => [k.toLowerCase().trim(), v as string]));
  } catch { return {}; }
}

const FILE_NAME = /^[^\\/:*?"<>|\0]{1,200}$/;

/** One requested PC action → what happens. Never throws. */
export function pcDecide(req: { action?: unknown; args?: unknown }, ctx: PcCtx): PcVerdict {
  const action = String(req.action ?? "") as PcAction;
  const spec = PC_LEVEL[action];
  if (!spec) return { run: "refuse", level: 3, reason: `Unknown PC action. Known: ${PC_ACTIONS.filter((a) => !PC_LEVEL[a].never).join(", ")}.` };
  if (spec.never) return { run: "refuse", level: spec.level, reason: spec.never };
  if (ctx.stopAll) return { run: "refuse", level: spec.level, reason: "Stop-all is on: ORBIT does nothing on the PC until you turn it off." };
  const a = (req.args && typeof req.args === "object" ? req.args : {}) as Record<string, unknown>;
  const no = (reason: string): PcVerdict => ({ run: "refuse", level: spec.level, reason });
  // red-team H1: a connected parent (his home, Projects) must not open .env files, keys or ORBIT's own VAULT/LIFE data
  const touchy = (p: string) => sensitivePath(p.replace(/\\/g, "/"), ctx.privatePaths ?? []);
  const inside = (p: string) => insideFolders(p, ctx.folders) && !touchy(p);
  const noFolders = "No folders are connected: set ORBIT_PC_FOLDERS in .env.local (folders separated by ;).";
  const ok = (args: Record<string, string>, summary: string): PcVerdict =>
    spec.level === 3 ? { run: "confirm", level: 3, click: !!spec.click, args, summary } : { run: spec.level === 1 ? "now" : "snapshot", level: spec.level, args, summary } as PcVerdict;

  for (const k of ["path", "from", "to", "folder", "repo"]) {
    const v = str(a[k], 400), t = v && touchy(v);
    if (t) return no(t === "secret" ? "That's a password, key or login file: ORBIT never opens or moves those." : "That's your private VAULT, journal or LIFE data: ORBIT never opens or moves it from the PC tools.");
  }
  if (action === "code_edit" && touchy(`/${str(a.file, 300)}`)) return no("That's a password, key or private file: ORBIT never edits it.");
  if (action === "rename_file" && touchy(`/${str(a.name, 200)}`)) return no("That name is a password, key or private file name.");
  switch (action) {
    case "open_app": case "focus_app": {
      const name = str(a.app, 60).toLowerCase();
      if (!name) return no("Which app?");
      if (action === "focus_app") return /^[\w .-]{1,60}$/.test(name) ? ok({ app: name }, `bring ${name} to the front`) : no("That app name has odd characters.");
      const target = { ...DEFAULT_APPS, ...(ctx.apps ?? {}) }[name];
      if (!target) return no(`I only open known apps (${Object.keys({ ...DEFAULT_APPS, ...(ctx.apps ?? {}) }).slice(0, 12).join(", ")}…). Add more with ORBIT_PC_APPS.`);
      return ok({ app: name, target }, `open ${name}`);
    }
    case "read_file": case "list_folder": {
      const p = str(a.path, 400);
      if (!ctx.folders.length) return no(noFolders);
      if (!inside(p)) return no("That path isn't inside a connected folder.");
      return ok({ path: p }, `${action === "read_file" ? "read" : "list"} ${p}`);
    }
    case "run_task": {
      const folder = str(a.folder, 400), task = str(a.task, 20);
      if (!ctx.folders.length) return no(noFolders);
      if (!inside(folder)) return no("That project isn't inside a connected folder.");
      if (!(RUN_TASKS as readonly string[]).includes(task)) return no(`Tasks I can run: ${RUN_TASKS.join(", ")} (its npm script).`);
      return ok({ folder, task }, `run ${task} in ${folder}`);
    }
    case "media_key": {
      const key = str(a.key, 20);
      return (MEDIA_KEYS as readonly string[]).includes(key) ? ok({ key }, key.replace("_", " ")) : no(`Media keys: ${MEDIA_KEYS.join(", ")}.`);
    }
    case "move_file": case "rename_file": {
      const from = str(a.from, 400);
      const to = action === "rename_file" ? renameTarget(from, str(a.name, 200)) : str(a.to, 400);
      if (!ctx.folders.length) return no(noFolders);
      if (!to) return no("The new name can't contain \\ / : * ? \" < > |.");
      if (!inside(from) || !inside(to)) return no("Both places must be inside connected folders.");
      if (normPath(from) === normPath(to)) return no("That's the same place.");
      return ok({ from, to }, `${action === "move_file" ? "move" : "rename"} ${from} → ${to}`);
    }
    case "code_edit": {
      const repo = str(a.repo, 400), file = str(a.file, 300), find = typeof a.find === "string" ? a.find.slice(0, 4000) : "", replace = typeof a.replace === "string" ? a.replace.slice(0, 4000) : "";
      if (!ctx.folders.length) return no(noFolders);
      if (!inside(repo)) return no("That repository isn't inside a connected folder.");
      if (!file || file.includes("..") || /^[a-z]:|^[\\/]/i.test(file)) return no("file must be a path inside the repository.");
      if (!find) return no("find must be the exact text to change.");
      return ok({ repo, file, find, replace }, `edit ${file} on a new branch in ${repo}`);
    }
    case "delete_file": {
      const p = str(a.path, 400);
      if (!ctx.folders.length) return no(noFolders);
      if (!inside(p) || ctx.folders.some((f) => normPath(f) === normPath(p))) return no("I only delete things inside connected folders (never a connected folder itself).");
      return ok({ path: p }, `move ${p} to the Recycle Bin`);
    }
    case "install_app": {
      const id = str(a.id, 100);
      return /^[\w][\w.+-]{1,99}$/.test(id) ? ok({ id }, `install ${id} with winget`) : no("install needs a winget package id, like Mozilla.Firefox.");
    }
    case "system_setting": {
      const setting = str(a.setting, 30), value = str(a.value, 10);
      if (!(SETTINGS as readonly string[]).includes(setting)) return no(`Settings I can change: ${SETTINGS.join(", ")}.`);
      if (value !== "on" && value !== "off") return no("value must be on or off.");
      return ok({ setting, value }, `turn ${setting.replace("_", " ")} ${value}`);
    }
  }
  return no("Not available.");
}

/** rename_file: the same folder with the new file name; "" when the name isn't a plain file name. */
export function renameTarget(from: string, name: string): string {
  if (!FILE_NAME.test(name) || name === "." || name === "..") return "";
  const i = Math.max(from.lastIndexOf("/"), from.lastIndexOf("\\"));
  return i < 0 ? "" : from.slice(0, i + 1) + name;
}

/** Outside text and PC changes (jarvis runPcTool). This answer read a page/file/window title (tainted): only reads run, injected
 *  text can't change his PC. An earlier turn of the chat did (earlier, red-team H2): changes wait for his OK like level 3. */
export const PC_READS: readonly string[] = ["read_file", "list_folder", "focus_app", "media_key"];
export function pcOutside(action: unknown, tainted: boolean, earlier: boolean): "ok" | "refuse" | "confirm" {
  if (PC_READS.includes(String(action))) return "ok";
  return tainted ? "refuse" : earlier ? "confirm" : "ok";
}

// ---- His OK for a level-3 action -------------------------------------------------------------------------------------------

export const CONFIRM_MS = 2 * 60_000; // a waiting level-3 action expires after this
const YES = /^(?:yes|yeah|yep|sure|ok(?:ay)?|confirm(?:ed)?|go ahead|do it|please do|jah|tee seda)\b(?:[\s,.!]+(?:do it|go ahead|please|confirm(?:ed)?|now))*[\s.!]*$/i;
const NO = /^(?:no|nope|don't|do not|cancel|stop|wait|never ?mind|ei|ära)\b/i;

/** His spoken reply while a level-3 action waits: "yes" only for a whole, plain yes ("yes, do it"), never inside another sentence. */
export function confirmReply(text: string): "yes" | "no" | null {
  const t = text.trim().replace(/^(?:hey\s+)?orbit[\s,.!]+/i, "");
  if (NO.test(t)) return "no";
  return YES.test(t) ? "yes" : null;
}

export type Pending = { id: string; action: PcAction; args: Record<string, string>; summary: string; click: boolean; at: number };

/** Can this confirmation run it? click = his click in ORBIT or on the orb; voice = a spoken yes. */
export function confirmAllowed(p: Pending | undefined, how: "click" | "voice", now: number, stopAll: boolean): { ok: true } | { ok: false; reason: string } {
  if (!p) return { ok: false, reason: "Nothing is waiting for your OK." };
  if (stopAll) return { ok: false, reason: "Stop-all is on." };
  if (now - p.at > CONFIRM_MS) return { ok: false, reason: "That one timed out. Ask again." };
  if (how === "voice" && p.click) return { ok: false, reason: "This one needs your click, not your voice." };
  return { ok: true };
}

/** The line ORBIT says when a level-3 action waits for him. */
export const askLine = (p: Pick<Pending, "summary" | "click">) =>
  p.click ? `I need your click to ${p.summary}. It's on the orb and in ORBIT.` : `Should I ${p.summary}? Say "yes, do it", or click Allow.`;
