// ORBIT doctor: pure verdicts and the plain-English summary. No I/O; tested in tests/doctor.test.ts.
// Every check says ok/warn/fail plus one line on what to do. Never put a secret value in detail or fix.

export type Status = "ok" | "warn" | "fail";
export type Check = { id: string; label: string; status: Status; detail: string; fix?: string };
export type Report = { status: Status; headline: string; speech: string; checks: Check[]; ms: number; at: string };

const GB = 1024 ** 3;
const DAY = 86_400_000;
export const check = (id: string, label: string, status: Status, detail: string, fix?: string): Check => ({ id, label, status, detail, ...(fix ? { fix } : {}) });

/** Claude Code model names ORBIT_MODEL / ORBIT_MODEL_SMART accept: an alias or a full claude-* id. */
export const validModel = (m: string) => /^(?:sonnet|opus|haiku|opusplan|default)(?:\[1m\])?$|^claude-[a-z0-9.-]+(?:\[1m\])?$/i.test(m.trim());

export function modelCheck(model: string, smart: string): Check {
  const bad = [["ORBIT_MODEL", model], ["ORBIT_MODEL_SMART", smart]].filter(([, v]) => !validModel(v));
  return bad.length
    ? check("models", "AI model names", "fail", `Not a Claude model name: ${bad.map(([k, v]) => `${k}="${v.slice(0, 40)}"`).join(", ")}`,
      `In .env.local set ${bad.map(([k]) => k).join(" and ")} to sonnet, opus or haiku (or delete the line), then restart ORBIT.`)
    : check("models", "AI model names", "ok", `${model} (everyday), ${smart} (important decisions)`);
}

export function diskCheck(freeBytes: number, where: string): Check {
  const gb = freeBytes / GB, txt = `${gb.toFixed(1)} GB free on ${where}`;
  if (gb < 5) return check("disk", "Free disk space", "fail", txt, "Delete old clips or videos in the studio inbox, or empty the Recycle Bin: rendering needs at least 5 GB.");
  if (gb < 20) return check("disk", "Free disk space", "warn", txt, "Getting low: delete old clips you've already posted, or empty the Recycle Bin.");
  return check("disk", "Free disk space", "ok", txt);
}

/** Required names fail when missing, optional ones are only listed. Names only, never values. */
export function envCheck(env: Record<string, string | undefined>, required: string[], optional: Record<string, string>): Check {
  const has = (k: string) => !!env[k]?.trim();
  const miss = required.filter((k) => !has(k));
  const off = Object.entries(optional).filter(([k]) => !has(k)).map(([k, what]) => `${k} (${what})`);
  if (miss.length) return check("env", "Settings (.env.local)", "fail", `Missing: ${miss.join(", ")}`, `Add ${miss.join(" and ")} to .env.local (copy them from .env.example and Supabase → Project Settings → API), then restart ORBIT.`);
  return check("env", "Settings (.env.local)", "ok", off.length ? `All required settings present. Not set (optional): ${off.join(", ")}` : "All settings present");
}

/** yt-dlp versions are dates (2025.09.26): YouTube breaks old ones within weeks. */
export function ytdlpCheck(found: boolean, version: string | null, pausedUntil: number, now: number): Check {
  const L = "Video downloader (yt-dlp)";
  if (!found) return check("ytdlp", L, "warn", "Not installed: \"Add from link\" and the scout's downloads won't work", "Run: winget install yt-dlp.yt-dlp, then restart ORBIT.");
  const m = version && /^(\d{4})\.(\d{2})\.(\d{2})/.exec(version);
  const age = m ? (now - Date.UTC(+m[1], +m[2] - 1, +m[3])) / DAY : null;
  const v = version ? `version ${version}` : "version unknown";
  if (pausedUntil > now) {
    const t = new Date(pausedUntil).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    return check("ytdlp", L, "warn", `${v}. YouTube blocked the last download, so YouTube downloads are paused until ${t}`, "Run: winget upgrade yt-dlp.yt-dlp (or yt-dlp -U). Then just wait; ORBIT retries by itself.");
  }
  if (age != null && age > 60) return check("ytdlp", L, "warn", `${v} is ${Math.round(age)} days old; YouTube often breaks old versions`, "Run: winget upgrade yt-dlp.yt-dlp (or yt-dlp -U).");
  return check("ytdlp", L, "ok", v);
}

/** BUILD_FAILED marker + the first error-looking line of orbit-build.log. */
export function buildCheck(failed: boolean, buildLog: string, production: boolean): Check {
  const L = "Last update build";
  if (!failed) return production ? check("build", L, "ok", "The last build worked") : check("build", L, "warn", "ORBIT is running the slower development server",
    "Close ORBIT (npm run app:stop) and start it from the desktop shortcut for the fast version.");
  const line = buildLog.split(/\r?\n/).map((l) => l.trim()).find((l) => /error|failed/i.test(l) && !/^>/.test(l)) ?? "";
  const where = line ? ` First error: ${line.slice(0, 200)}` : "";
  return production
    ? check("build", L, "warn", `The last update failed to build, so ORBIT is still running the previous version.${where}`, "Ask Claude Code to fix the errors in orbit-build.log, then run: npm run app:rebuild")
    : check("build", L, "fail", `The build failed and there is no working version, so ORBIT runs in slow development mode.${where}`, "Ask Claude Code to fix the errors in orbit-build.log, then run: npm run app:rebuild");
}

/** orbit-launcher.log lines "yyyy-MM-dd HH:mm:ss  [orbit] msg" (local time): crashes in the last 24 h. */
export function launcherCheck(log: string, now: Date): Check {
  const L = "Server stability";
  const recent = log.split(/\r?\n/).filter((l) => {
    const m = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})/.exec(l);
    return m && now.getTime() - new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]).getTime() < DAY;
  });
  if (recent.some((l) => l.includes("GAVE UP"))) return check("launcher", L, "fail", "The server crashed over and over and the launcher gave up", "Look at the end of orbit-server.log (or ask Claude Code to), fix the cause, then start ORBIT again.");
  const crashes = recent.filter((l) => l.includes("exited unexpectedly")).length;
  return crashes ? check("launcher", L, "warn", `The server crashed and restarted ${crashes} time${crashes > 1 ? "s" : ""} in the last 24 hours`, "If it keeps happening, ask Claude Code to look at orbit-server.log.")
    : check("launcher", L, "ok", "No crashes in the last 24 hours");
}

/** Task Scheduler can't be queried reliably from Node: orbit-night.log's age stands in for "the overnight run happens". */
export function nightCheck(lastWrite: number | null, now: number): Check {
  const L = "Overnight run";
  if (lastWrite == null) return check("night", L, "ok", "Not seen (optional: it isn't set up, or has never run)", "If you want clips made while you sleep, run: npm run night:install");
  const days = (now - lastWrite) / DAY;
  return days < 1.5 ? check("night", L, "ok", `Last seen ${days < 1 ? `${Math.max(1, Math.round(days * 24))} h` : "1 day"} ago`)
    : check("night", L, "warn", `Not seen for ${Math.round(days)} days`, "Leave the PC asleep (not shut down) and signed in at night. To set it up again, run: npm run night:install");
}

export function quotaCheck(budget: number, used: number): Check {
  const left = Math.max(0, budget - used), txt = `${left} of ${budget} scout units left today`;
  return left < 100 ? check("quota", "YouTube scout budget", "warn", txt, "Nothing to fix: the budget resets at midnight Pacific time.") : check("quota", "YouTube scout budget", "ok", txt);
}

/** life.json: missing = not used yet; unreadable or broken JSON = fail (LIFE won't load and won't overwrite it). */
export function lifeCheck(state: "missing" | "ok" | "bad", why = ""): Check {
  const L = "LIFE data (habits, reminders)";
  if (state === "missing") return check("life", L, "ok", "Not used yet");
  if (state === "ok") return check("life", L, "ok", "Readable");
  return check("life", L, "fail", `life.json can't be read${why ? ` (${why.slice(0, 120)})` : ""}, so LIFE is stuck`, "Fix or move %LOCALAPPDATA%\\orbit\\life.json, then reload LIFE.");
}

/** Vault folder: missing = not used yet; not writable = fail; above 90% of either limit = warn. */
export function vaultCheck(found: boolean, writable: boolean, bytes: number, count: number, maxBytes: number, maxFiles: number): Check {
  const L = "VAULT (your files)";
  if (!found) return check("vault", L, "ok", "Not used yet");
  const txt = `${(bytes / GB).toFixed(2)} of ${(maxBytes / GB).toFixed(0)} GB, ${count} of ${maxFiles} files`;
  if (!writable) return check("vault", L, "fail", `${txt}; ORBIT can't write to the vault folder, so uploads fail`, "Check the vault folder isn't read-only (right-click → Properties) and that no other program locks it.");
  if (bytes > maxBytes * 0.9 || count > maxFiles * 0.9) return check("vault", L, "warn", `${txt}: almost full`, "Delete or download-and-remove files you no longer need in VAULT.");
  return check("vault", L, "ok", txt);
}

/** Belief memory needs migration 0008; error is the cheap select's result. */
export function factsCheck(missing: boolean, message: string | null): Check {
  const L = "Belief memory";
  if (missing) return check("facts", L, "warn", "Off: the memory_facts table doesn't exist yet", "Run supabase/migrations/0008_memory_facts.sql in the Supabase SQL editor to turn on belief memory.");
  if (message != null) return check("facts", L, "warn", `Couldn't read beliefs: ${message.slice(0, 150)}`, "Check your internet; if it lasts, ask Claude Code to look at the memory_facts table.");
  return check("facts", L, "ok", "On");
}

const rank: Record<Status, number> = { ok: 0, warn: 1, fail: 2 };

/** Worst first, then the original order. */
export const sortChecks = (cs: Check[]) => cs.map((c, i) => [c, i] as const).sort((a, b) => rank[b[0].status] - rank[a[0].status] || a[1] - b[1]).map(([c]) => c);

export function summarize(checks: Check[], ms: number, at = new Date().toISOString()): Report {
  const fails = checks.filter((c) => c.status === "fail"), warns = checks.filter((c) => c.status === "warn");
  const status: Status = fails.length ? "fail" : warns.length ? "warn" : "ok";
  const n = (k: number, w: string) => `${k} ${w}${k === 1 ? "" : "s"}`;
  const headline = status === "ok" ? `Everything is working (${checks.length} checks).`
    : [fails.length && n(fails.length, "problem"), warns.length && n(warns.length, "warning")].filter(Boolean).join(" and ") + ` out of ${checks.length} checks.`;
  // Spoken: the headline, then the worst few with what to do (fix lines without commands read better aloud).
  const top = [...fails, ...warns].slice(0, 3).map((c) => `${c.label}: ${c.detail.split(". ")[0].replace(/\.$/, "")}.${c.fix ? ` ${c.fix}` : ""}`);
  const speech = status === "ok" ? "I checked everything. ORBIT is working fine." : [`I found ${headline.replace(/ out of.*/, "")}.`, ...top].join(" ");
  return { status, headline, speech, checks: sortChecks(checks), ms, at };
}
