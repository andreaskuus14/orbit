// Original music for STUDIO videos with ACE-Step (open source, runs on the owner's GPU, free). The owner points ORBIT at his
// ACE-Step install with ORBIT_ACESTEP_CMD, a command template with {prompt}, {seconds} and {out}, e.g.
//   ORBIT_ACESTEP_CMD=python C:\ace\generate.py --prompt {prompt} --duration {seconds} --output {out}
// Each placeholder becomes one argument (no shell), so a prompt can never inject a command. Without it, or when it fails, STUDIO
// keeps using the music folder. Disk side: music.ts. Tests: tests/music.test.ts.

/** A music prompt from the story: an instrumental bed that suits the style, never vocals (they'd fight the narration). */
export function musicPrompt(o: { idea: string; style: string; format?: string }): string {
  const mood = /horror|creepy|dark|thriller/i.test(o.idea + o.style) ? "tense, dark ambient, low drones"
    : /funny|comedy|silly|drama/i.test(o.idea + o.style + (o.format ?? "")) ? "playful, light pizzicato strings and soft percussion"
    : /epic|war|battle|history/i.test(o.idea + o.style) ? "cinematic, warm strings, slow build, soft timpani"
    : "calm, warm lo-fi piano and soft pads";
  return `instrumental background music for a short video, ${mood}, no vocals, steady, loopable, mixed quietly`;
}
/** argv from the template: split on spaces outside quotes; {prompt}/{seconds}/{out} are substituted inside one argument each. */
export function acestepArgv(template: string, v: { prompt: string; seconds: number; out: string }): string[] | null {
  const parts = template.match(/"[^"]*"|'[^']*'|\S+/g)?.map((p) => p.replace(/^(["'])(.*)\1$/, "$2")) ?? [];
  if (parts.length < 2 || !parts.some((p) => p.includes("{out}"))) return null; // must write somewhere ORBIT controls
  const sec = String(Math.max(10, Math.min(240, Math.round(v.seconds))));
  return parts.map((p) => p.replaceAll("{prompt}", v.prompt).replaceAll("{seconds}", sec).replaceAll("{out}", v.out));
}
