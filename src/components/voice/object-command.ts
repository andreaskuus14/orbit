// Voice commands about the selected object (G16): "open client Kask", "open the overdue ones", "save this version",
// "summarize this" (left to CORE, which gets the deep link via hereLink()). Rules: lib/voice-target-pure.ts.
// A change always names its interpreted target and waits for "yes"; an ambiguous reference asks which one first.
import { linkFromHash, type DeepLink } from "@/lib/deeplink-pure";
import { NAV_EVENT } from "@/lib/nav-pure";
import { translate } from "@/lib/i18n-pure";
import { currentTarget, parseIntent, resolve, spokenOrdinal, yesNo, type Rec } from "@/lib/voice-target-pure";
import { getLang } from "../i18n";

/** Fired after the owner confirmed "save this version" for exactly this record. detail: { kind, id, planet }.
 *  The owning workspace saves it; nothing listens yet (groundwork). */
export const VOICE_SAVE_VERSION = "orbit:voice-save-version";

export const hereLink = (): DeepLink | null => (typeof location === "undefined" ? null : linkFromHash(location.hash));
const t = (k: Parameters<typeof translate>[1], v?: Parameters<typeof translate>[2]) => translate(getLang(), k, v);

type Pending = { kind: "save"; target: { kind: string; id: string; planet: string } } | { kind: "pick"; options: Rec[] };
let pending: Pending | null = null;

// shortcut: only BUSINESS clients are named by voice (the one record list with names behind a deep link); add tasks/goals when needed.
async function records(): Promise<Rec[]> {
  const j = await fetch("/api/business").then((r) => (r.ok ? r.json() : null)).catch(() => null);
  return Array.isArray(j?.prospects) ? j.prospects.map((p: { id: string; name: string }) => ({ kind: "client", id: p.id, name: p.name, planet: "business" })) : [];
}
const open = (r: Rec) => dispatchEvent(new CustomEvent(NAV_EVENT, { detail: { panel: r.planet, open: { kind: r.kind, id: r.id } } }));
const list = (o: Rec[]) => o.map((r, i) => `${i + 1}. ${r.name}`).join(", ");

/** Handles the utterance (true) or leaves it to the next router (false). say() gets the spoken/visible reply. */
export function runObjectCommand(text: string, say: (msg: string) => void): boolean {
  if (pending) {
    const p = pending;
    if (p.kind === "save") {
      const yes = yesNo(text);
      if (yes === null) { pending = null; return false; } // moved on: the change is dropped, never applied later
      pending = null;
      if (yes) { dispatchEvent(new CustomEvent(VOICE_SAVE_VERSION, { detail: p.target })); say(t("vc.saved")); } else say(t("vc.cancelled"));
      return true;
    }
    const i = spokenOrdinal(text, p.options.length);
    const named = i ? null : resolve({ kind: null, name: text }, p.options, null);
    const pick = i ? p.options[i - 1] : named?.status === "one" ? named.rec : null;
    pending = null;
    if (!pick) return false;
    open(pick); say(t("vc.opening", { name: pick.name }));
    return true;
  }
  const intent = parseIntent(text);
  if (!intent || intent.act === "summarize") return false; // CORE answers, with the on-screen object in context
  const here = hereLink();
  if (intent.act === "overdue") { dispatchEvent(new CustomEvent(NAV_EVENT, { detail: { panel: "life", life: "review" } })); say(t("vc.overdue")); return true; }
  if (intent.act === "save") {
    const target = currentTarget(here);
    if (!target || !here) { say(t("vc.noTarget")); return true; }
    pending = { kind: "save", target: { ...target, planet: here.planet } };
    say(t("vc.confirmSave", { target: `${target.kind} ${target.id}` }));
    return true;
  }
  void records().then((recs) => {
    const r = resolve(intent, recs, here);
    if (r.status === "one") { open(r.rec); say(t("vc.opening", { name: r.rec.name })); }
    else if (r.status === "many") { pending = { kind: "pick", options: r.options }; say(t("vc.which", { options: list(r.options) })); }
    else say(t("vc.notFound", { name: intent.name || intent.kind || "" }));
  });
  return true;
}
