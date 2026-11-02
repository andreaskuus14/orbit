// "Check before promising" (review 1c4cd6c): what each kind of request needs, evaluated against data ORBIT already has
// (the doctor's last checks, env names, local token files). Pure, client-safe; tested in tests/capability.test.ts. IO: capability.ts.
// Used by CORE's prompt (missing things for the routed modules), mission/agent start (blocked up front) and the Doctor panel.
import type { Lang } from "./i18n-pure.ts";

export type Dep = "claude" | "youtube_key" | "youtube_oauth" | "resend" | "calendar" | "higgsfield" | "ollama" | "phone" | "ffmpeg" | "whisper";
export type CapId = "think" | "youtube_stats" | "youtube_upload" | "clips" | "email_send" | "calendar" | "media" | "local_brain" | "phone" | "arch";
type Cap = { id: CapId; deps: Dep[]; modules: string[]; intent: RegExp };

/** What ORBIT knows without probing: the doctor's last check statuses (by id), env, and local connection files. */
export type Facts = {
  checks: Record<string, "ok" | "warn" | "fail">; env: Record<string, string | undefined>;
  ytConnected: boolean; ytExpired: boolean; calendar: boolean; pushProblem: string | null; phones: number;
};
/** true = there, false = missing, null = unknown (no doctor run yet): unknown never blocks. */
export type DepState = Record<Dep, boolean | null>;

// intent: action words EN + ET. shortcut: keyword intents miss oddly worded asks and can over-match; upgrade to the CORE router if that bites.
export const CAPS: Cap[] = [
  { id: "think", deps: ["claude"], modules: [], intent: /[\s\S]/ },
  { id: "youtube_stats", deps: ["youtube_key"], modules: ["STUDIO"], intent: /youtube.{0,30}(stat|views|subscri|analytic)|channel stats|\bscout\b|kanali (stat|vaat)|vaatamis|tellij/i },
  { id: "youtube_upload", deps: ["youtube_oauth"], modules: ["STUDIO"], intent: /\bupload|(publish|post|schedule).{0,30}(youtube|short|video)|lae .{0,20}üles|avalda|ajasta/i },
  { id: "clips", deps: ["ffmpeg", "whisper"], modules: ["STUDIO"], intent: /\bclips?\b|\bshorts?\b|caption|subtit|\bcut\b.{0,20}video|klipp|lühivideo|subtiitr|lõika/i },
  { id: "email_send", deps: ["resend"], modules: ["BUSINESS"], intent: /\bsend\b.{0,30}\b(e-?mails?|mail)\b|\be-?mail (him|her|them|the client|the lead)|saada .{0,30}(e-?kir|meil|kiri)/i },
  { id: "calendar", deps: ["calendar"], modules: ["LIFE"], intent: /calendar|meeting|appointment|kalend|kohtumi/i },
  { id: "media", deps: ["higgsfield"], modules: ["HIGGSFIELD"], intent: /(generate|make|create|draw|render).{0,30}(image|picture|photo|video)|higgsfield|(genereeri|loo|tee|joonista).{0,30}(pilt|pildi|foto|video)/i },
  { id: "local_brain", deps: ["ollama"], modules: [], intent: /local (brain|model)|\bollama\b|offline model|kohalik (aju|mudel)/i },
  { id: "phone", deps: ["phone"], modules: [], intent: /(call|ring|notify|ping|text) me\b|my phone|push notif|helista mulle|telefon/i },
  { id: "arch", deps: [], modules: ["ARCH"], intent: /\barch\b|floor ?plan|korruseplaan|arhitekt/i },
];

const st = (s: "ok" | "warn" | "fail" | undefined) => (s === undefined ? null : s !== "fail");
const has = (env: Facts["env"], ...k: string[]) => k.every((x) => !!env[x]?.trim());

export function evaluate(f: Facts): DepState {
  const claude = st(f.checks.claude);
  return {
    claude,
    youtube_key: has(f.env, "YOUTUBE_API_KEY") && st(f.checks.ytkey) !== false,
    youtube_oauth: f.ytConnected && !f.ytExpired && has(f.env, "YOUTUBE_OAUTH_CLIENT_ID", "YOUTUBE_OAUTH_CLIENT_SECRET"),
    resend: has(f.env, "RESEND_API_KEY", "ORBIT_MAIL_FROM"),
    calendar: f.calendar,
    higgsfield: f.env.ORBIT_HIGGSFIELD_DRY_RUN === "1" ? true : claude, // runs through Claude Code's MCP connector; its sign-in isn't checked
    ollama: has(f.env, "ORBIT_LOCAL_LLM_MODEL") || has(f.env, "ORBIT_LOCAL_MODEL"),
    phone: !f.pushProblem && f.phones > 0,
    ffmpeg: st(f.checks.ffmpeg),
    whisper: st(f.checks.whisper),
  };
}

export type Missing = { id: CapId; deps: Dep[] };
const missingOf = (caps: Cap[], s: DepState): Missing[] =>
  caps.map((c) => ({ id: c.id, deps: c.deps.filter((d) => s[d] === false) })).filter((m) => m.deps.length);

/** Everything ORBIT can't do right now (Doctor panel). */
export const cantDo = (s: DepState) => missingOf(CAPS, s);
/** Missing capabilities a request asks for (intent), plus — for CORE — those of its routed modules. "think" only by intent from tasks. */
export function missingFor(text: string, s: DepState, modules: string[] = []): Missing[] {
  return missingOf(CAPS.filter((c) => c.intent.test(text) || c.modules.some((m) => modules.includes(m))), s);
}

const T: Record<Lang, { cap: Record<CapId, string>; why: Record<Dep, string>; fix: Record<Dep, string>; blocked: string; heads: string; title: string; none: string }> = {
  en: {
    cap: { think: "Thinking (CORE, agents, missions)", youtube_stats: "YouTube stats and the Video Scout", youtube_upload: "Uploading and scheduling to YouTube", clips: "Cutting clips with captions",
      email_send: "Sending email (after your approval)", calendar: "Reading your Google Calendar", media: "Making images and video (Higgsfield)", local_brain: "Local brain (private offline model)",
      phone: "Notifying your phone", arch: "ARCH studio" },
    why: { claude: "Claude Code isn't reachable on the ORBIT PC", youtube_key: "no working YouTube API key", youtube_oauth: "your YouTube channel isn't connected (or the sign-in expired)",
      resend: "email sending isn't set up", calendar: "Google Calendar isn't connected", higgsfield: "Higgsfield runs through Claude Code, which isn't reachable",
      ollama: "the local brain is off", phone: "no phone is set up for notifications", ffmpeg: "the video tool (ffmpeg) is missing", whisper: "the speech-to-text library is missing" },
    fix: { claude: "Install Claude Code, run: claude (sign in), then restart ORBIT.", youtube_key: "Add YOUTUBE_API_KEY to .env.local (Google Cloud → Credentials), then restart ORBIT.",
      youtube_oauth: "Open STUDIO → Stats and click Connect YouTube (needs YOUTUBE_OAUTH_CLIENT_ID and _SECRET in .env.local).",
      resend: "Add RESEND_API_KEY and ORBIT_MAIL_FROM to .env.local, then restart ORBIT. Every email still waits for your click.",
      calendar: "LIFE → Today → Connect Google Calendar (needs GCAL_OAUTH_CLIENT_ID and _SECRET in .env.local).",
      higgsfield: "Get Claude Code working, then: claude mcp add -s user --transport http higgsfield https://mcp.higgsfield.ai/mcp and sign in via /mcp.",
      ollama: "Run tools\\ollama\\setup.ps1 in PowerShell (installs Ollama, pulls the model, sets ORBIT_LOCAL_LLM_MODEL), then restart ORBIT.",
      phone: "Set REMOTE_VAPID_PUBLIC/_PRIVATE (docs/PHONE.md), then open Remote on the phone and turn notifications on.",
      ffmpeg: "In the ORBIT folder run: npm install (or set ORBIT_FFMPEG to ffmpeg.exe).", whisper: "In the ORBIT folder run: npm install." },
    blocked: "Not started: ORBIT can't do this right now.", heads: "Heads-up: {what}, so the step that needs it will stop for you. Fix: {fix}", title: "What ORBIT can't do right now", none: "Nothing missing: every capability ORBIT checks is available.",
  },
  et: {
    cap: { think: "Mõtlemine (CORE, agendid, missioonid)", youtube_stats: "YouTube'i statistika ja videoskaut", youtube_upload: "YouTube'i üleslaadimine ja ajastamine", clips: "Klippide lõikamine subtiitritega",
      email_send: "E-kirjade saatmine (pärast sinu kinnitust)", calendar: "Google'i kalendri lugemine", media: "Piltide ja video loomine (Higgsfield)", local_brain: "Kohalik aju (privaatne võrguühenduseta mudel)",
      phone: "Telefoni teavitamine", arch: "ARCH stuudio" },
    why: { claude: "Claude Code ei ole ORBIT-i arvutis kättesaadav", youtube_key: "töötavat YouTube API võtit pole", youtube_oauth: "sinu YouTube'i kanal pole ühendatud (või sisselogimine aegus)",
      resend: "e-kirjade saatmine pole seadistatud", calendar: "Google'i kalender pole ühendatud", higgsfield: "Higgsfield töötab Claude Code'i kaudu, mis pole kättesaadav",
      ollama: "kohalik aju on välja lülitatud", phone: "ühtegi telefoni pole teavituste jaoks seadistatud", ffmpeg: "videotööriist (ffmpeg) puudub", whisper: "kõnetuvastuse teek puudub" },
    fix: { claude: "Paigalda Claude Code, käivita: claude (logi sisse), siis taaskäivita ORBIT.", youtube_key: "Lisa YOUTUBE_API_KEY faili .env.local (Google Cloud → Credentials), siis taaskäivita ORBIT.",
      youtube_oauth: "Ava STUDIO → Stats ja vajuta Connect YouTube (vajab .env.local-is YOUTUBE_OAUTH_CLIENT_ID ja _SECRET).",
      resend: "Lisa RESEND_API_KEY ja ORBIT_MAIL_FROM faili .env.local, siis taaskäivita ORBIT. Iga kiri ootab ikka sinu klikki.",
      calendar: "LIFE → Today → Connect Google Calendar (vajab .env.local-is GCAL_OAUTH_CLIENT_ID ja _SECRET).",
      higgsfield: "Pane Claude Code tööle, siis: claude mcp add -s user --transport http higgsfield https://mcp.higgsfield.ai/mcp ja logi sisse /mcp kaudu.",
      ollama: "Käivita PowerShellis tools\\ollama\\setup.ps1 (paigaldab Ollama, tõmbab mudeli, seab ORBIT_LOCAL_LLM_MODEL), siis taaskäivita ORBIT.",
      phone: "Sea REMOTE_VAPID_PUBLIC/_PRIVATE (docs/PHONE.md), siis ava telefonis Remote ja lülita teavitused sisse.",
      ffmpeg: "Käivita ORBIT-i kaustas: npm install (või sea ORBIT_FFMPEG ffmpeg.exe-le).", whisper: "Käivita ORBIT-i kaustas: npm install." },
    blocked: "Ei alustatud: ORBIT ei saa seda praegu teha.", heads: "Teadmiseks: {what}, seega samm, mis seda vajab, peatub ja ootab sind. Parandus: {fix}", title: "Mida ORBIT praegu teha ei saa", none: "Midagi ei puudu: kõik ORBIT-i kontrollitavad võimed on olemas.",
  },
};

export const capTitle = (lang: Lang) => T[lang].title;
export const capNone = (lang: Lang) => T[lang].none;
/** One Doctor row: label, why, fix (fixes deduped when two deps share one). */
export const capRow = (m: Missing, lang: Lang) => ({ label: T[lang].cap[m.id], why: m.deps.map((d) => T[lang].why[d]).join("; "), fix: m.deps.map((d) => T[lang].fix[d]).join(" ") });

/** Up-front refusal for a mission/agent task, or "" when nothing it asks for is missing. */
export function blockedReason(missing: Missing[], lang: Lang): string {
  if (!missing.length) return "";
  return `${T[lang].blocked} ${missing.map((m) => { const r = capRow(m, lang); return `${r.label}: ${r.why}. ${r.fix}`; }).join(" ")}`;
}

/** Mission/agent start. Keyword-guessed needs never hard-block: only a known-down Claude Code (the engine itself) refuses up front;
 *  anything else starts with a heads-up note on the task/mission. */
export function startCheck(missing: Missing[], lang: Lang): { block: string; headsUp: string } {
  const rest = missing.filter((m) => m.id !== "think");
  const deps = [...new Set(rest.flatMap((m) => m.deps))];
  return {
    block: blockedReason(missing.filter((m) => m.id === "think"), lang),
    headsUp: deps.length ? T[lang].heads.replace("{what}", deps.map((d) => T[lang].why[d]).join("; ")).replace("{fix}", deps.map((d) => T[lang].fix[d]).join(" ")) : "",
  };
}

/** A task's title and request with the heads-up on them: "⚠ " on the title (visible in the task card), the note under the request (the agent sees it too). */
export const withHeadsUp = (title: string, request: string, headsUp: string) =>
  headsUp ? { title: `⚠ ${title}`.slice(0, 200), request: `${request}\n\n${headsUp}` } : { title: title.slice(0, 200), request };

/** CORE prompt line: only the missing things, or "" (prompt text is English; CORE answers in the owner's language). */
export function coreNote(missing: Missing[]): string {
  if (!missing.length) return "";
  return `CAPABILITIES RIGHT NOW (ORBIT's own checks): can't do ${missing.map((m) => { const r = capRow(m, "en"); return `${r.label} (${r.why})`; }).join("; ")}. If the user asks for any of these, say so and how to fix it BEFORE promising or starting it.\n\n`;
}

/** Language for server-side replies when the client didn't say: Estonian letters or common words → et. shortcut: heuristic; pass lang from the client to be exact. */
export const guessLang = (text: string): Lang => (/[õäöü]|\b(ja|ning|palun|tee|mulle|kas)\b/i.test(text) ? "et" : "en");
