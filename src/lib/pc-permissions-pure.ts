// Toggleable PC Control Permissions (pure, tested in tests/pc-permissions.test.ts; IO: pc-permissions.ts).
// Gives the owner explicit On/Off toggles per PC capability (Terminal, Terminal auto-run without asking,
// PC apps & files, Screen & window watch, Chrome browser control), while keeping Rule 6 hard locks intact:
//   - .env / SSH keys / Journal & LIFE text never leave ORBIT or run unchecked (H1 / H5)
//   - outside text / prompt injection from web pages or files still gates terminal & PC writes (H2 / H3)
//   - destructive deletes, git push, external uploads/sends/spends/logins still wait for owner click.

export const PC_PERM_KEYS = ["terminal", "terminalAuto", "pcApps", "screenWatch", "chrome"] as const;
export type PcPermKey = (typeof PC_PERM_KEYS)[number];
export type PcPermissions = Record<PcPermKey, boolean>;

export const DEFAULT_PC_PERMS: PcPermissions = {
  terminal: true,
  terminalAuto: false, // opt-in: run direct local installs/scripts in connected folders without per-command click
  pcApps: true,
  screenWatch: true,
  chrome: true,
};

export const ALL_OFF_PC_PERMS: PcPermissions = {
  terminal: false,
  terminalAuto: false,
  pcApps: false,
  screenWatch: false,
  chrome: false,
};

export function parsePcPerms(raw: string | null): PcPermissions {
  const out: PcPermissions = { ...DEFAULT_PC_PERMS };
  if (!raw?.trim()) return out;
  try {
    const o = JSON.parse(raw) as Record<string, unknown>;
    if (!o || typeof o !== "object" || Array.isArray(o)) return out;
    for (const k of PC_PERM_KEYS) {
      if (typeof o[k] === "boolean") out[k] = o[k] as boolean;
    }
    if (!out.terminal) out.terminalAuto = false;
  } catch { /* defaults */ }
  return out;
}

export function patchPcPerms(cur: PcPermissions, patch: Record<string, unknown>): PcPermissions {
  const next: PcPermissions = { ...cur };
  for (const k of PC_PERM_KEYS) {
    if (typeof patch[k] === "boolean") next[k] = patch[k] as boolean;
  }
  if (!next.terminal) next.terminalAuto = false;
  return next;
}

export function pcPermDisabledReason(cap: Exclude<PcPermKey, "terminalAuto">, perms: PcPermissions, stopAll: boolean): string | null {
  if (stopAll) return "ORBIT is paused (Stop-all is on).";
  if (perms[cap]) return null;
  const names: Record<Exclude<PcPermKey, "terminalAuto">, string> = {
    terminal: "Terminal execution",
    pcApps: "PC apps & files",
    screenWatch: "Screen & window watch",
    chrome: "Chrome browser control",
  };
  return `${names[cap]} is turned OFF in Profile → Autonomy → PC Control Permissions.`;
}

// Commands that NEVER auto-approve even with terminalAuto ON (destructive deletes, git push, network writes,
// privilege escalation, system/registry edits, encoded payloads, shell chaining).
const NEVER_AUTO_RE =
  /[;&|`]|(?:\$\()|\b(?:rm|rmdir|del|erase|remove-item|ri|rd|format|diskpart|bcdedit|reg|regedit|shutdown|restart-computer|stop-computer|icacls|takeown|netsh|sc\.exe|set-executionpolicy|chmod\s+777|chown|mkfs|dd)\b|\bgit\s+(?:push|reset\s+--hard|clean\s+-[a-z]*f|branch\s+-D|rebase|checkout\s+--)\b|\b(?:curl|curl\.exe|wget|iwr|irm|invoke-webrequest|invoke-restmethod)\b|\b(?:powershell|pwsh)\b[^\n]*-(?:enc|encodedcommand)\b/i;

// Safe direct local dev/install/build/run commands allowed to skip Level-3 click when terminalAuto is ON
// on a clean direct owner request (not tainted by outside text, not touching private paths).
const SAFE_AUTO_PREFIX_RE =
  /^\s*(?:npm|npx|pnpm|yarn|bun|pip|pip3|uv|python|python3|py|node|tsx|cargo|rustc|go|dotnet|git\s+(?:status|diff|log|branch|switch|checkout|add|commit|stash|fetch|pull)|rojo|selene|stylua|wally|winget|choco|tsc|next|vitest|jest|pytest|ruff|mypy)\b/i;

/** Whether a Level-3 terminal command may run without clicking OK when the owner toggled `terminalAuto` ON.
 *  Strictly preserves Rule 6 & red-team H1/H2/H3/H5: never auto-runs with outside text, private paths, Stop-all,
 *  chaining, destructive deletes, git push, or network POSTs. */
export function canAutoApproveTerminal(
  command: string,
  verdict: { level: 1 | 2 | 3; private?: boolean },
  outside: boolean,
  perms: PcPermissions,
  stopAll: boolean,
): boolean {
  if (stopAll || !perms.terminal || !perms.terminalAuto) return false;
  if (verdict.level !== 3 || verdict.private || outside) return false;
  const cmd = command.trim();
  if (!cmd || cmd.length > 400) return false;
  if (NEVER_AUTO_RE.test(cmd)) return false;
  return SAFE_AUTO_PREFIX_RE.test(cmd);
}
