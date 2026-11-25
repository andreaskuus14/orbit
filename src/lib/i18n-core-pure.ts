// i18n rules with no dictionary inside, so any module (browser included) can import them without pulling ~470 kB of strings.
// Dictionaries: i18n-en-pure.ts (source + fallback) and i18n-et-pure.ts. Server code and tests: i18n-pure.ts (both loaded).
// Browser: components/i18n.tsx (only the active language is in the first-load bundle).
import type { Key } from "./i18n-en-pure.ts";
export type { Key } from "./i18n-en-pure.ts";

export type Lang = "en" | "et";
export const LANG_KEY = "orbit.lang"; // localStorage key and cookie name (the cookie lets the server render the right language)
export const parseLang = (v: unknown): Lang => (v === "et" ? "et" : "en");
/** Cookie the browser writes on every switch: one year, whole site, sent on page loads only. */
export const langCookie = (lang: Lang): string => `${LANG_KEY}=${lang}; Path=/; Max-Age=31536000; SameSite=Lax`;

export type Vars = Record<string, string | number>;
type Dict = Partial<Record<Key, string>>;
const fill = (s: string, v?: Vars) => (v ? s.replace(/\{(\w+)\}/g, (m, k: string) => (k in v ? String(v[k]) : m)) : s);

/** Lookup with fallback: Estonian when chosen and present, else English, else the key itself (never blank). */
export function lookup(en: Dict | undefined, et: Dict | undefined, lang: Lang, key: Key, vars?: Vars): string {
  return fill((lang === "et" && et?.[key]) || en?.[key] || key, vars);
}

export type PluralBase = { [K in Key]: K extends `${infer B}.one` ? B : never }[Key];
/** Count + noun: `.one` only for exactly 1 (also in Estonian: 21 takes the partitive, "21 agenti"), `.other` otherwise. */
export const pluralKey = (base: PluralBase, n: number): Key => `${base}.${Math.abs(n) === 1 ? "one" : "other"}` as Key;

/* Labels the server sends in English, keyed by the stable id it sends next to them (doctor check id, SYSTEM service/storage id).
 * Not in the dictionaries: the server's own English stays the source, tx() falls back to it. */
const ET_SERVER: Record<string, string> = {
  "check.models": "AI-mudelite nimed", "check.disk": "Vaba kettaruum", "check.env": "Seaded (.env.local)", "check.ytdlp": "Videote allalaadija (yt-dlp)",
  "check.build": "Viimase uuenduse ehitamine", "check.launcher": "Serveri stabiilsus", "check.night": "Öine käivitus", "check.quota": "YouTube'i luure eelarve",
  "check.life": "LIFE andmed (harjumused, meeldetuletused)", "check.vault": "VAULT (sinu failid)", "check.facts": "Uskumuste mälu",
  "check.claude": "Claude (CORE'i taga olev AI)", "check.supabase": "Andmebaas (Supabase)", "check.ytkey": "YouTube'i API võti",
  "check.oauth": "YouTube'i kanali ühendus", "check.ffmpeg": "Videotööriist (ffmpeg)", "check.whisper": "Kõnetuvastus (Whisper)",
  "check.hyperframes": "Hyperframes (valikuline)", "check.wake": "Häälega äratamine („Orbital wake up“)", "check.allow": "Kes saab sisse logida",
  "check.datadir": "ORBITi andmekaust", "check.workspaces": "Tööruumide kaust", "check.roblox": "Roblox Studio ühendus", "check.wakepid": "Äratuse kuulaja", "check.drill": "Taastamise harjutus", "check.durable": "Salvestatud olek ja sündmused",
  "svc.supabase": "Andmebaas (Supabase)", "svc.claude": "Claude CLI sisselogimine", "svc.resend": "E-kirjade saatmine (Resend)", "svc.higgsfield": "Higgsfield",
  "svc.ollama": "Kohalik aju (Ollama)", "svc.push": "Telefoni teavitused", "svc.calendar": "Google'i kalender",
  "disk.data": "ORBITi andmekaust", "disk.vault": "VAULT", "disk.studio": "STUDIO kaust", "disk.backup": "Varukoopiate kaust",
};
/** A server-sent English string by its stable key: Estonian when chosen and known, else the server's own text. */
export const tx = (lang: Lang, key: string, en: string): string => (lang === "et" && ET_SERVER[key]) || en;

/** Greeting for a local hour, same thresholds as morning-pure greeting(). */
export const greetKey = (hour: number): Key => (hour < 12 ? "greet.morning" : hour < 18 ? "greet.afternoon" : "greet.evening");

/** The one line CORE's prompt gains when Estonian is on. It rides in each turn's request tail, not the system prompt,
 *  so the system prompt stays identical and the pre-warmed spare CLIs (keyed by system prompt) still match. */
export const CORE_LANG_RULE: Record<Lang, string> = {
  en: "",
  et: "LANGUAGE: the user reads ORBIT in Estonian. Write your answer in natural, fluent Estonian (eesti keeles) unless they write in another language or ask for one. Keep JSON keys, tool names, tool inputs and code in English.\n\n",
};
