"use client";
import { useCallback, useEffect, useRef, useState } from "react";

// Clip Factory → "AI Story": idea → Claude's script (editable) → Higgsfield price → Approve → Short in the review queue.
// Server: /api/studio/clips/story (src/lib/clips/story.ts). Nothing is generated before the Approve click.

// Mirrors src/lib/clips/story-pure.ts.
type Scene = { visual: string; narration: string; sec: number; camera: string };
type Story = { title: string; hook: string; scenes: Scene[] };
type Item = { key: string; kind: "image" | "video" | "audio"; scene: number; credits?: number; jobId?: string; status?: "pending" | "done" | "failed"; file?: string; error?: string };
type ErrKind = "not_connected" | "credits" | "paid_plan" | "other";
type StoryJob = { id: string; createdAt: string; status: "draft" | "quoted" | "generating" | "assembling" | "done" | "failed"; step: string;
  opts: { idea: string; style: string; length: number; voice: string; motion: "stills" | "video" }; story: Story; items: Item[];
  quote?: { total: number; balance: number | null; plan: string | null; fingerprint: string }; clipJob?: string; error?: { kind: ErrKind; message: string }; warnings: string[] };
type Data = { stories: StoryJob[]; running: string | null; dryRun: boolean };

const API = "/api/studio/clips/story";
const LENGTHS = [30, 45, 60];
const VOICES: [string, string][] = [["kokoro:af_heart", "Heart (local, free)"], ["kokoro:af_bella", "Bella (local)"], ["kokoro:am_michael", "Michael (local)"], ["kokoro:am_fenrir", "Fenrir (local)"],
  ["kokoro:bf_emma", "Emma, British (local)"], ["kokoro:bm_george", "George, British (local)"], ["none", "No voice (captions only)"], ["hf", "Higgsfield voice (credits)…"]];
const CONNECT = "claude mcp add -s user --transport http higgsfield https://mcp.higgsfield.ai/mcp";
const HELP: Record<ErrKind, string> = {
  not_connected: `Higgsfield isn't connected to Claude Code on this PC. In a terminal run: ${CONNECT} — then start claude, type /mcp, pick higgsfield and sign in with your Higgsfield account. Then get the cost again.`,
  credits: "Not enough Higgsfield credits for this story. Top up on higgsfield.ai, or use fewer scenes / a local voice.",
  paid_plan: "This model needs a paid Higgsfield plan. Switch Motion to \"Stills\" (images + Ken Burns), or set ORBIT_HIGGSFIELD_*_MODEL to a model your plan includes.",
  other: "",
};
const ICON = { pending: "⏳", done: "✓", failed: "⚠" } as const;
const busyStatus = (s: StoryJob["status"]) => s === "generating" || s === "assembling";

async function api<T>(body?: unknown): Promise<T> {
  const res = await fetch(API, body ? { method: "POST", cache: "no-store", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : { cache: "no-store" });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error || `Request failed (${res.status})`);
  return json as T;
}

export default function StoryPanel({ active, seed, onOpenClip, onChanged }: { active: boolean; seed?: { idea?: string; story?: string } | null /* Pipeline board: prefill an idea or select a story */; onOpenClip: (job: string, clip: string) => void; onChanged: () => void }) {
  const [d, setD] = useState<Data | null>(null);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState("");
  const [sel, setSel] = useState<string | null>(null);
  const [draft, setDraft] = useState<Story | null>(null); // the owner's unsaved edits of the selected story
  const [f, setF] = useState({ idea: "", style: "", length: 45, voice: "kokoro:af_heart", hfVoice: "", motion: "stills" as "stills" | "video" });

  useEffect(() => {
    if (seed?.story) { setSel(seed.story); setDraft(null); }
    const idea = seed?.idea;
    if (idea) setF((x) => ({ ...x, idea }));
  }, [seed]);
  const load = useCallback(async () => {
    try { setD(await api<Data>()); } catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
  }, []);
  useEffect(() => { if (active) void load(); }, [active, load]);
  const job = d?.stories.find((s) => s.id === sel) ?? d?.stories[0] ?? null;
  const working = !!job && busyStatus(job.status);
  useEffect(() => { // poll while a story is being made
    if (!active || !working) return;
    const t = setInterval(() => void load(), 2500);
    return () => clearInterval(t);
  }, [active, working, load]);
  const wasWorking = useRef(false); // finished → refresh Clip Factory so the new clip shows in Clips
  useEffect(() => { if (wasWorking.current && !working) onChanged(); wasWorking.current = working; }, [working, onChanged]);

  async function act(name: string, body: unknown) {
    setBusy(name); setErr("");
    try {
      const r = await api<{ story: StoryJob }>(body);
      setSel(r.story.id); setDraft(null);
      setD((x) => x && { ...x, stories: [r.story, ...x.stories.filter((s) => s.id !== r.story.id)] });
      return r.story;
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); return null; }
    finally { setBusy(""); }
  }
  const voice = f.voice === "hf" ? `hf:${f.hfVoice.trim()}` : f.voice;
  const write = () => act("write", { action: "write", idea: f.idea, style: f.style, length: f.length, voice, motion: f.motion });
  async function getCost() {
    if (!job) return;
    if (draft && !(await act("edit", { action: "edit", id: job.id, story: draft }))) return;
    await act("quote", { action: "quote", id: job.id });
  }

  const story = draft ?? job?.story ?? null;
  const editable = !!job && !working && job.status !== "done" && !job.items.some((i) => i.jobId);
  const setScene = (i: number, p: Partial<Scene>) => story && setDraft({ ...story, scenes: story.scenes.map((s, k) => (k === i ? { ...s, ...p } : s)) });
  const unpaid = job?.items.filter((i) => !i.jobId) ?? [];
  const total = Math.round(unpaid.reduce((s, i) => s + (i.credits ?? 0), 0) * 100) / 100;
  const priced = !!job?.quote && !draft && unpaid.every((i) => typeof i.credits === "number");
  const short = job?.quote?.balance != null && job.quote.balance < total;

  return (
    <div className="space-y-3">
      <section className="card" aria-label="AI story">
        <h3 className="hud-title studio-title mb-2 !text-[0.7rem]">AI STORY</h3>
        <p className="muted mb-2 text-xs">Claude writes a short story, Higgsfield makes the pictures, ORBIT narrates and edits it into a Short. You see the price first; nothing is generated until you approve.{d?.dryRun && " (Dry run: fake Higgsfield, no credits.)"}</p>
        <form className="space-y-2" onSubmit={(e) => { e.preventDefault(); void write(); }}>
          <textarea className="field w-full !px-2 !py-1 !text-xs" rows={3} maxLength={1000} placeholder="Your idea, e.g. a lighthouse keeper finds a letter from himself, dated tomorrow" value={f.idea} onChange={(e) => setF({ ...f, idea: e.target.value })} aria-label="Story idea" id="story-idea" />
          <input className="field w-full !px-2 !py-1 !text-xs" maxLength={200} placeholder="Style (optional), e.g. moody watercolor, Pixar-like 3D" value={f.style} onChange={(e) => setF({ ...f, style: e.target.value })} aria-label="Visual style" />
          <div className="flex flex-wrap items-center gap-1.5 text-xs">
            <span className="muted">Length</span>
            {LENGTHS.map((l) => <button key={l} type="button" className="chip num" aria-pressed={f.length === l} onClick={() => setF({ ...f, length: l })}>{l} s</button>)}
            <span className="muted ml-2">Motion</span>
            <button type="button" className="chip" aria-pressed={f.motion === "stills"} onClick={() => setF({ ...f, motion: "stills" })}>Stills + Ken Burns</button>
            <button type="button" className="chip" aria-pressed={f.motion === "video"} onClick={() => setF({ ...f, motion: "video" })} title="Video models usually need a paid Higgsfield plan">Video clips (paid plans)</button>
          </div>
          <div className="flex flex-wrap items-center gap-1.5 text-xs">
            <label className="muted" htmlFor="story-voice">Voice</label>
            <select id="story-voice" className="field !px-2 !py-1 !text-xs" value={f.voice} onChange={(e) => setF({ ...f, voice: e.target.value })}>
              {VOICES.map(([v, t]) => <option key={v} value={v}>{t}</option>)}
            </select>
            {f.voice === "hf" && <input className="field !px-2 !py-1 !text-xs" maxLength={80} placeholder="Higgsfield voice id" value={f.hfVoice} onChange={(e) => setF({ ...f, hfVoice: e.target.value })} aria-label="Higgsfield voice id" />}
            <button type="submit" className="btn ml-auto" disabled={!!busy || f.idea.trim().length < 3 || (f.voice === "hf" && !f.hfVoice.trim())}>{busy === "write" ? "Writing…" : "✍ Write story"}</button>
          </div>
        </form>
        {err && <p className="error mt-2 text-xs" role="alert">{err}</p>}
      </section>

      {job && story && (
        <section className="card" aria-label="Story script">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <h3 className="hud-title studio-title !text-[0.7rem]">SCRIPT</h3>
            {d && d.stories.length > 1 && (
              <select className="field !px-2 !py-1 !text-xs" value={job.id} onChange={(e) => { setSel(e.target.value); setDraft(null); }} aria-label="Pick a story">
                {d.stories.map((s) => <option key={s.id} value={s.id}>{s.story.title} · {s.status}</option>)}
              </select>
            )}
          </div>
          <fieldset disabled={!editable || !!busy} className="space-y-2">
            <input className="field w-full !px-2 !py-1 !text-sm" value={story.title} maxLength={100} onChange={(e) => setDraft({ ...story, title: e.target.value })} aria-label="Title" />
            <input className="field w-full !px-2 !py-1 !text-xs" value={story.hook} maxLength={80} onChange={(e) => setDraft({ ...story, hook: e.target.value })} aria-label="Hook text" />
            <ol className="space-y-2">
              {story.scenes.map((s, i) => {
                const items = job.items.filter((it) => it.scene === i);
                return (
                  <li key={i} className="rounded border p-2 text-xs" style={{ borderColor: "rgba(255,214,224,0.12)" }}>
                    <div className="mb-1 flex flex-wrap items-center gap-2">
                      <b>Scene {i + 1}</b>
                      <input className="field w-16 !px-1 !py-0.5 !text-xs" type="number" min={2.5} max={12} step={0.5} value={s.sec} onChange={(e) => setScene(i, { sec: Number(e.target.value) })} aria-label={`Scene ${i + 1} seconds`} />
                      <span className="muted">s</span>
                      <input className="field min-w-0 flex-1 !px-1 !py-0.5 !text-xs" maxLength={80} value={s.camera} onChange={(e) => setScene(i, { camera: e.target.value })} aria-label={`Scene ${i + 1} camera`} />
                      {items.map((it) => (
                        <span key={it.key} className="muted num whitespace-nowrap" title={it.error}>
                          {it.status ? ICON[it.status] : ""} {it.kind}{typeof it.credits === "number" && !it.jobId ? ` · ${it.credits} cr` : ""}
                        </span>
                      ))}
                    </div>
                    <textarea className="field w-full !px-2 !py-1 !text-xs" rows={2} maxLength={1200} value={s.visual} onChange={(e) => setScene(i, { visual: e.target.value })} aria-label={`Scene ${i + 1} picture prompt`} />
                    <textarea className="field mt-1 w-full !px-2 !py-1 !text-xs" rows={2} maxLength={400} value={s.narration} onChange={(e) => setScene(i, { narration: e.target.value })} aria-label={`Scene ${i + 1} narration`} />
                  </li>
                );
              })}
            </ol>
          </fieldset>

          <div className="mt-2 space-y-2 text-xs" role="status">
            <p className="muted">{job.step}{job.quote && !draft ? ` · plan: ${job.quote.plan ?? "?"} · balance: ${job.quote.balance ?? "?"} credits` : ""}</p>
            {job.error && <p className="error" role="alert">{HELP[job.error.kind] || job.error.message}{job.error.kind !== "other" && <span className="muted block">{job.error.message}</span>}</p>}
            {job.error?.kind === "not_connected" && <button className="chip" onClick={() => navigator.clipboard?.writeText(CONNECT)}>Copy connect command</button>}
            {job.warnings.map((w) => <p key={w} className="muted">⚠ {w}</p>)}
          </div>
          <div className="mt-2 flex flex-wrap gap-2">
            {job.status !== "done" && !working && <button className="chip" onClick={() => void getCost()} disabled={!!busy}>{busy === "quote" || busy === "edit" ? "Asking Higgsfield…" : draft ? "Save & get cost" : "💰 Get cost"}</button>}
            {job.status !== "done" && !working && priced && (
              <button className="btn" disabled={!!busy || short} onClick={() => void act("approve", { action: "approve", id: job.id, credits: total })}>
                {busy === "approve" ? "Starting…" : total ? `✓ Approve & generate (${total} credits)` : "✓ Resume (no new credits)"}
              </button>
            )}
            {job.status === "done" && job.clipJob && <button className="btn" onClick={() => onOpenClip(job.clipJob!, "clip-1")}>🎬 Open in Clips to review</button>}
          </div>
        </section>
      )}
    </div>
  );
}
