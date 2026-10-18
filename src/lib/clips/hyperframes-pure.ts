// Hyperframes effects layer (pure, tested in tests/hyperframes.test.ts): one clip's captions, hook card and payoff pop-ups as a
// transparent 1080x1920 HTML composition that the optional hyperframes CLI renders to an alpha MOV (I/O: hyperframes.ts).
// CSS keyframes only (hyperframes' css adapter seeks them per clip): no GSAP, no script, no fonts or files from the network at render.
import { IN, captionGroups, cleanWords, type Word } from "./pure.ts";
import { PLAYBOOK_MIN, type Playbook } from "./study-pure.ts";

export const HF_VERSION = "0.8.171";
export const HF_INSTALL = `npm i -D hyperframes@${HF_VERSION} and npx hyperframes browser ensure`;
const HOOK_SEC = 1.5, POP_SEC = 1.2, POP_GAP = 3, POP_MAX = 3;
const EMOJI = ["🔥", "😱", "😂", "💀"];

/** Text → safe HTML text: entities for & < > " ', control chars dropped, one line. */
export const esc = (s: string) => s.replace(/[\x00-\x1f\x7f]+/g, " ").replace(/\s+/g, " ").trim()
  .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
const n3 = (x: number) => String(Math.round(Math.max(0, x) * 1000) / 1000);

export type FxIn = { hook: string; words: Word[]; duration: number; style?: "karaoke" | "classic";
  playbook?: Pick<Playbook, "n" | "effects" | "payoffAt"> | null };
export type FxPlan = { captions: "karaoke" | "classic" | null; hook: boolean; emoji: boolean; popups: boolean };

/** Which effects are on: captions when there are words (the job's caption option already emptied them when off), the hook card when
 *  there's a hook, emoji / text pop-ups only when the viral playbook (≥ PLAYBOOK_MIN studies) shows those effects are common. */
export function fxPlan(o: FxIn): FxPlan {
  const pb = o.playbook && o.playbook.n >= PLAYBOOK_MIN ? o.playbook : null, has = (l: string) => !!pb?.effects.some((e) => e.label === l);
  return { captions: cleanWords(o.words).length ? o.style ?? "karaoke" : null, hook: !!o.hook.trim(), emoji: has("emoji"), popups: has("text pop-up") };
}
export const fxAny = (p: FxPlan) => !!(p.captions || p.hook || p.emoji || p.popups);

export type CapEvent = { start: number; end: number; words: string[]; on: number; loud: boolean };
/** Caption events with exactly buildAss's timing: karaoke = one event per word (on = its index), classic = one per group (on = -1). */
export function captionEvents(words: Word[], duration: number, style: "karaoke" | "classic"): CapEvent[] {
  const groups = captionGroups(cleanWords(words)), ev: CapEvent[] = [];
  let last = 0;
  groups.forEach((g, gi) => {
    const nextGroup = groups[gi + 1]?.[0].start ?? Infinity, text = g.map((w) => w.text.toUpperCase());
    if (style === "classic") {
      const start = Math.max(last, g[0].start), end = Math.min(duration, Math.max(g[g.length - 1].end, start + 0.3), nextGroup);
      if (end - start < 0.05 || start >= duration) return;
      last = end; ev.push({ start, end, words: text, on: -1, loud: false });
      return;
    }
    g.forEach((w, i) => {
      const start = Math.max(last, w.start);
      const end = Math.min(duration, i < g.length - 1 ? g[i + 1].start : Math.min(Math.max(w.end, start + 0.3), nextGroup));
      if (end - start < 0.05 || start >= duration) return;
      last = end; ev.push({ start, end, words: text, on: i, loud: !!w.loud });
    });
  });
  return ev;
}

/** Payoff moments: shouted words (≥ 3 s apart, after the hook card, max 3); none → the word nearest the playbook's typical payoff. */
export function payoffs(words: Word[], duration: number, payoffAt = 0): { t: number; text: string }[] {
  const ws = cleanWords(words).filter((w) => w.start >= HOOK_SEC && w.start <= duration - 0.5), out: { t: number; text: string }[] = [];
  for (const w of ws) if (w.loud && out.length < POP_MAX && (!out.length || w.start - out[out.length - 1].t >= POP_GAP)) out.push({ t: w.start, text: w.text });
  if (!out.length && payoffAt > 0 && ws.length) {
    const at = payoffAt * duration, w = ws.reduce((a, b) => (Math.abs(b.start - at) < Math.abs(a.start - at) ? b : a));
    out.push({ t: w.start, text: w.text });
  }
  return out;
}

const clip = (id: string, cls: string, start: number, dur: number, inner: string) =>
  `<div id="${id}" class="clip ${cls}" data-start="${n3(start)}" data-duration="${n3(dur)}" data-track-index="1">${inner}</div>`;

/** The whole composition (null when no effect is on). Deterministic: same input → same bytes. */
export function buildComposition(o: FxIn): string | null {
  const plan = fxPlan(o), dur = Math.max(0.1, o.duration);
  if (!fxAny(plan)) return null;
  const parts: string[] = [];
  if (plan.hook) parts.push(clip("hook", "hook", 0, Math.min(HOOK_SEC, dur), `<div class="hook-in">${esc(o.hook.toUpperCase())}</div>`));
  if (plan.captions) captionEvents(o.words, dur, plan.captions).forEach((e, i) => {
    const len = e.words.join(" ").length + 3, fs = len > 13 ? Math.floor((96 * 13) / len) : 96; // like buildAss: long lines shrink to fit
    const ws = e.words.map((w, j) => `<span class="w${j === e.on ? (e.loud ? " on loud" : " on") : ""}">${esc(w)}</span>`).join(" ");
    parts.push(clip(`c${i}`, `cap ${e.on < 0 ? "classic" : "karaoke"}`, e.start, e.end - e.start, `<div class="line" style="font-size:${fs}px">${ws}</div>`));
  });
  if (plan.emoji || plan.popups) payoffs(o.words, dur, o.playbook?.payoffAt).forEach((p, i) => {
    const d = Math.min(POP_SEC, dur - p.t);
    if (plan.emoji) parts.push(clip(`e${i}`, "emoji", p.t, d, `<div class="pop">${EMOJI[i % EMOJI.length]}</div>`));
    if (plan.popups) parts.push(clip(`p${i}`, "popup", p.t, d, `<div class="pop">${esc(p.text.toUpperCase())}!</div>`));
  });
  return `<!doctype html>
<html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=1080, height=1920"><title>ORBIT effects</title>
<style>
html,body{margin:0;background:transparent}
#root{position:relative;width:100%;height:100%;overflow:hidden;font-family:Montserrat,sans-serif;font-weight:900;color:#fff}
.clip{position:absolute;left:0;right:0;display:flex;justify-content:center;text-align:center}
.hook{top:260px;padding:0 80px}
.hook-in{display:block;background:#ff2e63;padding:18px 30px;border-radius:18px;font-size:84px;line-height:1.1;animation:hook-in 380ms cubic-bezier(.34,1.56,.64,1) both}
.cap{bottom:640px;left:70px;right:150px}
.line{display:block;line-height:1.15;paint-order:stroke fill;-webkit-text-stroke:18px #000;text-shadow:0 6px 0 rgba(0,0,0,.5)}
.w{display:inline-block}
.karaoke .on{color:#ffe500;animation:bounce 220ms cubic-bezier(.34,1.56,.64,1) both}
.karaoke .loud{color:#ff2e63;animation-name:bounce-big}
.classic .line{animation:rise 160ms ease-out both}
.emoji{top:430px;left:auto;right:110px;font-size:190px;line-height:1}
.popup{top:600px;font-size:120px;paint-order:stroke fill;-webkit-text-stroke:22px #000;color:#ffe500}
.pop{display:block;animation:pop ${POP_SEC * 1000}ms ease-out both}
@keyframes hook-in{from{opacity:0;transform:scale(.6)}to{opacity:1;transform:scale(1)}}
@keyframes bounce{0%{transform:scale(.8) translateY(14px)}60%{transform:scale(1.22) translateY(-6px)}100%{transform:scale(1.15) translateY(0)}}
@keyframes bounce-big{0%{transform:scale(.8) translateY(18px)}60%{transform:scale(1.45) translateY(-10px)}100%{transform:scale(1.35) translateY(0)}}
@keyframes rise{from{opacity:0;transform:translateY(24px)}to{opacity:1;transform:translateY(0)}}
@keyframes pop{0%{opacity:0;transform:scale(0) rotate(-12deg)}18%{opacity:1;transform:scale(1.25) rotate(6deg)}30%{transform:scale(1) rotate(-4deg)}80%{opacity:1}100%{opacity:0;transform:scale(1.05) rotate(-4deg)}}
</style></head><body>
<div id="root" data-composition-id="orbit-fx" data-start="0" data-width="1080" data-height="1920" data-fps="30" data-duration="${n3(dur)}">
${parts.join("\n")}
</div>
</body></html>
`;
}

/** hyperframes argv after the bin script: render the project dir to a ProRes 4444 MOV (alpha; ffmpeg's native prores decoder keeps it,
 *  unlike VP9 WebM alpha which needs libvpx forced as decoder). Spawned without a shell. */
export const hfRenderArgs = (projectDir: string, out: string) =>
  ["render", projectDir, "--format", "mov", "--fps", "30", "--output", out, "--quiet"];

/** ffmpeg argv: the alpha layer over the rendered clip (audio copied). The layer ending early just stops drawing. */
export const overlayArgs = (video: string, layer: string, out: string) => [
  "-hide_banner", "-nostdin", "-y", ...IN, video, ...IN, layer,
  "-filter_complex", "[0:v][1:v]overlay=0:0:format=auto:eof_action=pass,format=yuv420p[v]", "-map", "[v]", "-map", "0:a?",
  "-c:v", "libx264", "-preset", "veryfast", "-crf", "21", "-r", "30", "-c:a", "copy", "-movflags", "+faststart", out,
];

/** ffmpeg argv: the fallback when the overlay pass fails: burn the usual ASS captions onto the (caption-less) clip instead. */
export const burnAssArgs = (video: string, ass: string, out: string) => {
  if (!/^[\w.-]+\.ass$/.test(ass)) throw new Error("unsafe ass file name");
  return ["-hide_banner", "-nostdin", "-y", ...IN, video, "-vf", `ass=${ass}`, "-map", "0:v", "-map", "0:a?",
    "-c:v", "libx264", "-preset", "veryfast", "-crf", "21", "-r", "30", "-c:a", "copy", "-movflags", "+faststart", out];
};
