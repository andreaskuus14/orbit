// ORBIT doctor: pure verdicts and the plain-English summary. No I/O; tested in tests/doctor.test.ts.
// Every check says ok/warn/fail plus one line on what to do. Never put a secret value in detail or fix.

import { CAPS, type Missing } from "./capability-pure.ts";
import type { FailedGroup, ModelRow, Svc } from "./system-health-pure.ts";
import { plural, translate, type Lang } from "./i18n-pure.ts";

export type Status = "ok" | "warn" | "fail";
export type Check = { id: string; label: string; status: Status; detail: string; fix?: string; retry?: { key: string; label: string }[] }; // retry: dead-letter events (durable-pure durableCheck)
export type Report = { status: Status; headline: string; speech: string; checks: Check[]; ms: number; at: string };

// Clipboard output crosses the support boundary. Select known IDs and states instead of redacting free text.
const SHARE_CHECKS = ["doctor", "claude", "models", "supabase", "ytkey", "quota", "oauth", "tools", "ffmpeg", "ytdlp", "whisper",
  "hyperframes", "disk", "build", "version", "migrations", "launcher", "night", "life", "vault", "facts", "durable", "drill", "latency", "wake", "env", "allow"];
const SHARE_SERVICES = ["supabase", "claude", "resend", "higgsfield", "ollama", "push", "calendar"];
const SHARE_ROLES = ["main", "fast", "smart", "deep"];
const SHARE_JOB_KINDS = ["task", "mission", "night", "clip"];

export function doctorShareText(report: Report & {
  system?: { services: Svc[]; models: ModelRow[]; failed: FailedGroup[] } | null;
  cantDo?: Missing[] | null;
}): string {
  const state = (value: string | undefined, allowed: readonly string[]) => allowed.find((entry) => entry === value) ?? "unknown";
  const version = report.checks.find((c) => c.id === "version")?.detail;
  const commit = /^Running ([0-9a-f]{7}) \(built /i.exec(version ?? "")?.[1] ?? "unknown";
  const at = new Date(report.at);
  const sections = [
    "ORBIT Doctor · support snapshot",
    `Checked at: ${Number.isFinite(at.getTime()) ? at.toISOString() : "unknown"}`,
    `Running commit: ${commit}`,
    `Overall: ${state(report.status, ["ok", "warn", "fail"])}`,
    `Checks: ${SHARE_CHECKS.flatMap((id) => {
      const row = report.checks.find((c) => c.id === id);
      return row ? [`${id}=${state(row.status, ["ok", "warn", "fail"])}`] : [];
    }).join(", ") || "unavailable"}`,
  ];
  const system = report.system;
  if (system) {
    sections.push(
      `Services: ${SHARE_SERVICES.map((id) => `${id}=${state(system.services.find((row) => row.id === id)?.state, ["ok", "down", "off"])}`).join(", ")}`,
      `Models: ${SHARE_ROLES.map((role) => `${role}=${state(system.models.find((row) => row.role === role)?.state, ["ok", "failing", "unused", "limited"])}`).join(", ")}`,
      `Failed jobs (7 days): ${SHARE_JOB_KINDS.map((kind) => {
        const count = system.failed.find((row) => row.kind === kind)?.count;
        return `${kind}=${typeof count === "number" && Number.isSafeInteger(count) && count >= 0 ? count : "unknown"}`;
      }).join(", ")}`,
    );
  } else {
    sections.push("Services, models and failed jobs: unavailable");
  }
  sections.push(`Missing capabilities: ${report.cantDo ? CAPS.filter((cap) => report.cantDo?.some((row) => row.id === cap.id)).map((cap) => cap.id).join(", ") || "none reported" : "unavailable"}`);
  return sections.join("\n");
}

const GB = 1024 ** 3;
const DAY = 86_400_000;
export const check = (id: string, label: string, status: Status, detail: string, fix?: string): Check => ({ id, label, status, detail, ...(fix ? { fix } : {}) });

/** Claude Code model names ORBIT_MODEL / ORBIT_MODEL_SMART / ORBIT_MODEL_DEEP accept: an alias (fable only if the plan has it) or a full claude-* id. */
export const validModel = (m: string) => /^(?:sonnet|opus|haiku|fable|opusplan|default)(?:\[1m\])?$|^claude-[a-z0-9.-]+(?:\[1m\])?$/i.test(m.trim());

export function modelCheck(model: string, smart: string, fast = "haiku", deep = "opus", effort = ""): Check {
  const bad = [["ORBIT_MODEL", model], ["ORBIT_MODEL_SMART", smart], ["ORBIT_MODEL_FAST", fast], ["ORBIT_MODEL_DEEP", deep]].filter(([, v]) => !validModel(v));
  if (bad.length) return check("models", "AI model names", "fail", `Not a Claude model name: ${bad.map(([k, v]) => `${k}="${v.slice(0, 40)}"`).join(", ")}`,
    `In .env.local set ${bad.map(([k]) => k).join(" and ")} to sonnet, opus or haiku (or delete the line), then restart ORBIT.`);
  const names = `${model} (everyday), ${smart} (important decisions), ${fast} (quick replies), ${deep} (deep answers)`;
  return effort.trim() && !/^(low|medium|high|xhigh|max)$/.test(effort.trim())
    ? check("models", "AI model names", "warn", `${names}. ORBIT_DEEP_EFFORT="${effort.slice(0, 20)}" is not a valid effort, so deep answers run without it`,
      "In .env.local set ORBIT_DEEP_EFFORT to low, medium, high, xhigh or max (or delete the line), then restart ORBIT.")
    : check("models", "AI model names", "ok", names);
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

export function quotaCheck(budget: number, used: number, callers = ""): Check {
  const left = Math.max(0, budget - used), txt = `${left} of ${budget} scout units left today${callers ? `. ${callers}` : ""}`;
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

/** "2 problems and 1 warning out of 12 checks." The server sends English; the client re-renders it from the checks in its language. */
export function headlineOf(checks: Pick<Check, "status">[], lang: Lang = "en"): string {
  const fails = checks.filter((c) => c.status === "fail").length, warns = checks.filter((c) => c.status === "warn").length;
  if (!fails && !warns) return translate(lang, "doc.head.ok", { n: checks.length });
  return [fails && plural(lang, "doc.head.problems", fails), warns && plural(lang, "doc.head.warnings", warns)].filter(Boolean).join(translate(lang, "doc.head.and"))
    + translate(lang, "doc.head.outOf", { n: checks.length });
}

export function summarize(checks: Check[], ms: number, at = new Date().toISOString()): Report {
  const fails = checks.filter((c) => c.status === "fail"), warns = checks.filter((c) => c.status === "warn");
  const status: Status = fails.length ? "fail" : warns.length ? "warn" : "ok";
  const headline = headlineOf(checks);
  // Spoken: the headline, then the worst few with what to do (fix lines without commands read better aloud).
  const top = [...fails, ...warns].slice(0, 3).map((c) => `${c.label}: ${c.detail.split(". ")[0].replace(/\.$/, "")}.${c.fix ? ` ${c.fix}` : ""}`);
  const speech = status === "ok" ? "I checked everything. ORBIT is working fine." : [`I found ${headline.replace(/ out of.*/, "")}.`, ...top].join(" ");
  return { status, headline, speech, checks: sortChecks(checks), ms, at };
}

/** Roadmap 21: foreground CORE latency (start → first token, total) over the last turns since the server started.
 *  Informational only: numeric targets wait for measurements on the actual PC. */
export function latencyCheck(turns: { ms: Record<string, number> }[], last = 50): Check {
  const L = "CORE response time";
  const recent = turns.slice(-last);
  const mid = (k: string) => { const s = recent.map((t) => t.ms[k]).filter(Number.isFinite).sort((a, b) => a - b); return s.length ? s[Math.floor((s.length - 1) / 2)] : null; };
  if (!recent.length) return check("latency", L, "ok", "No CORE turns since ORBIT started");
  const ack = mid("ack"), first = mid("first_token"), total = mid("total");
  const sec = (v: number | null) => (v === null ? "n/a" : `${(v / 1000).toFixed(1)} s`);
  return check("latency", L, "ok", `Median of last ${recent.length} turns: first sign of work ${sec(ack)}, first words ${sec(first)}, full answer ${sec(total)}`);
}
