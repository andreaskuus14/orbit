"use client";
import { useCallback, useEffect, useState } from "react";
import { contentHash, spendContent } from "@/lib/approval-pure";
import { bySite } from "@/lib/site-pictures-pure";

// STUDIO → Websites (pictures made for sites, grouped per site, one Approve-all click each) and STUDIO → Other (drafts tied to
// neither YouTube nor a site). Same server and gate as AI Story: /api/studio/clips/story, nothing is generated before Approve.

type Item = { key: string; index: number; credits?: number; jobId?: string; status?: "pending" | "done" | "failed"; error?: string };
type Slot = { path: string; prompt: string; aspect: string };
type Job = { id: string; createdAt: string; status: "draft" | "quoted" | "generating" | "assembling" | "done" | "failed"; step: string; items: Item[];
  story: { title: string }; quote?: { total: number; balance: number | null; fingerprint: string }; error?: { kind: string; message: string };
  draft?: { kind: string; prompt: string; model: string; count: number; aspect: string }; site?: { workspace: string; purpose: string; slots?: Slot[] } };
const API = "/api/studio/clips/story";
const payable = (j: Job) => j.items.filter((i) => !i.jobId);
const total = (j: Job) => Math.round(payable(j).reduce((s, i) => s + (i.credits ?? 0), 0) * 100) / 100;
const priced = (j: Job) => !!j.quote && payable(j).every((i) => typeof i.credits === "number");
const busy = (j: Job) => j.status === "generating" || j.status === "assembling";

async function call<T>(url: string, body?: unknown): Promise<T> {
  const r = await fetch(url, body ? { method: "POST", cache: "no-store", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : { cache: "no-store" });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || `Request failed (${r.status})`);
  return j as T;
}

export default function StudioDrafts({ section }: { section: "websites" | "other" }) {
  const [jobs, setJobs] = useState<Job[] | null>(null);
  const [previews, setPreviews] = useState<Record<string, string>>({});
  const [err, setErr] = useState("");
  const [working, setWorking] = useState("");
  const [bump, setBump] = useState(0); // new local photos at the same paths: refetch the previews
  const load = useCallback(async () => {
    try {
      setJobs((await call<{ stories: Job[] }>(`${API}?section=${section}`)).stories);
      if (section === "websites") setPreviews(Object.fromEntries((await call<{ workspaces: { slug: string; preview: string }[] }>("/api/workspace")).workspaces.map((w) => [w.slug, w.preview])));
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
  }, [section]);
  useEffect(() => { void load(); }, [load]);
  const live = jobs?.some((j) => busy(j) || (j.status === "draft" && !j.quote && !j.error));
  useEffect(() => { // poll while a price or a generation is on its way
    if (!live) return;
    const t = setInterval(() => { if (!document.hidden) void load(); }, 3000);
    return () => clearInterval(t);
  }, [live, load]);

  async function act(id: string, body: Record<string, unknown>) {
    setWorking(id); setErr("");
    try { const r = await call<{ story: Job }>(API, { id, ...body }); setJobs((x) => x && x.map((j) => (j.id === id ? r.story : j))); }
    catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
    finally { setWorking(""); }
  }
  // Free and unlimited: ComfyUI on this PC makes every photo of the site now (no credits, so no approval card).
  async function local(j: Job) {
    setWorking(`local:${j.id}`); setErr("");
    try {
      const r = await call<{ made: string[]; failed: string[] }>("/api/local-ai", { action: "site-local", workspace: j.site!.workspace, slots: j.site!.slots });
      setErr(r.failed.length ? `Made ${r.made.length} locally; failed: ${r.failed.join(", ")}` : "");
      setBump((n) => n + 1); await load();
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
    finally { setWorking(""); }
  }
  const approve = async (j: Job) => act(j.id, { action: "approve", credits: total(j), seen: await contentHash(spendContent(j.quote?.fingerprint ?? "", total(j))) });

  function Actions({ j, label }: { j: Job; label: string }) {
    if (j.status === "done" || busy(j)) return null;
    const short = j.quote?.balance != null && j.quote.balance < total(j);
    return (
      <div className="mt-2 flex flex-wrap gap-2">
        <button className="chip" disabled={!!working} onClick={() => void act(j.id, { action: "quote" })}>{working === j.id ? "Asking Higgsfield…" : priced(j) ? "↻ Price again" : "💰 Get price"}</button>
        {priced(j) && <button className="btn" disabled={!!working || short} onClick={() => void approve(j)}>{!total(j) ? "✓ Resume (no new credits)" : `✓ ${label} (${total(j)} credits)`}</button>}
      </div>
    );
  }
  const status = (j: Job) => (
    <div className="mt-1 space-y-1 text-xs" role="status">
      <p className="muted">{j.step}</p>
      {j.error && <p className="error" role="alert">{j.error.message}</p>}
    </div>
  );

  const groups = section === "websites" ? bySite(jobs ?? []) : [];
  return (
    <section className="glass hud-panel h-full space-y-3 overflow-y-auto p-4" aria-label={section === "websites" ? "Websites" : "Other"}>
      <header>
        <h3 className="hud-title studio-title !text-[0.7rem]">{section === "websites" ? "WEBSITES" : "OTHER"}</h3>
        <p className="muted text-xs">{section === "websites"
          ? "Photos CORE drafted for your sites, one card per site. The site already shows drawn stand-ins; one Approve click makes the real photos and ORBIT puts them into the site at the same paths. Nothing is generated before your click, and none of this goes to YouTube."
          : "Pictures and videos CORE drafted that belong to neither a site nor YouTube. Nothing is generated before your Approve click."}</p>
        {err && <p className="error mt-1 text-xs" role="alert">{err}</p>}
      </header>
      {!jobs && !err && <p className="muted text-xs">Loading…</p>}
      {jobs && !jobs.length && <p className="muted text-xs">{section === "websites" ? "No site pictures yet. Ask CORE for realistic photos on a site and they show up here." : "Nothing here yet."}</p>}

      {groups.map((g) => {
        const preview = previews[g.workspace];
        const base = preview?.replace(/index\.html$/, "");
        return (
          <article key={g.workspace} className="card space-y-2" aria-label={`Site ${g.workspace}`}>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h4 className="text-sm font-semibold">{g.workspace}</h4>
              {preview && <a className="chip" href={preview} target="_blank" rel="noreferrer">Open site preview ↗</a>}
            </div>
            {g.jobs.map((j) => (
              <div key={j.id} className="rounded border p-2" style={{ borderColor: "rgba(255,214,224,0.12)" }}>
                <ul className="grid gap-2 sm:grid-cols-2">
                  {(j.site?.slots ?? [{ path: j.site?.purpose ?? "picture", prompt: j.draft?.prompt ?? "", aspect: j.draft?.aspect ?? "" }]).map((s, i) => {
                    const it = j.items.find((x) => x.index === i);
                    return (
                      <li key={s.path} className="text-xs">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        {base && j.site?.slots && <img src={`${base}${s.path.split("/").map(encodeURIComponent).join("/")}?v=${encodeURIComponent(j.step.length + j.status)}${bump}`} alt={s.prompt} className="mb-1 aspect-video w-full rounded object-cover" loading="lazy" />}
                        <b className="num">{s.path}</b>
                        <span className="muted num ml-2" title={it?.error}>{it?.status === "done" ? "✓ made" : it?.status === "failed" ? "⚠ failed" : it?.status === "pending" ? "⏳" : typeof it?.credits === "number" ? `${it.credits} cr` : ""}</span>
                        <span className="muted block">{s.prompt}</span>
                      </li>
                    );
                  })}
                </ul>
                {status(j)}
                {j.site?.slots && j.status !== "done" && !busy(j) && <button className="chip mt-2" disabled={!!working} onClick={() => void local(j)} title="Free: ComfyUI on this PC (tools/comfyui/setup.ps1)">{working === `local:${j.id}` ? "Making photos on this PC (≈10 s each)…" : "🖥 Generate locally (free)"}</button>}
                <Actions j={j} label="Approve all" />
              </div>
            ))}
          </article>
        );
      })}

      {section === "other" && (jobs ?? []).map((j) => (
        <article key={j.id} className="card" aria-label={j.story.title}>
          <p className="text-xs"><b>{j.draft ? `${j.draft.count} × ${j.draft.kind}` : j.story.title}</b>{j.draft && <span className="muted"> · {j.draft.model} · {j.draft.aspect}</span>}</p>
          {j.draft && <p className="muted text-xs">{j.draft.prompt}</p>}
          {status(j)}
          <Actions j={j} label="Approve & generate" />
        </article>
      ))}
    </section>
  );
}
