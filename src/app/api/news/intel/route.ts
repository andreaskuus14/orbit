import { requireUser } from "@/lib/supabase/server";
import { normalizeUrl } from "@/lib/pure";
import { createMemory } from "@/lib/memory";
import { follow } from "@/lib/follows";
import { readIntel, updateIntel } from "@/lib/news-intel";
import { clusterEvents, cleanPrefs, developments, eventKey, eventRev, excluded, independentSources, LIMIT, storyPayload, titleKey, whyThis, type Art } from "@/lib/news-intel-pure";

// INTELLIGENCE → Today / Following / Sources (INT01-07). GET: developments since the last acknowledged revision per topic, the
// owner's preferences and per-feed health. POST {action}: "prefs", "less" (less like this), "ack" (mark seen), "story" (note/watch/task).

export async function GET() {
  const { sb, res } = await requireUser();
  if (res) return res;
  const store = await readIntel();
  const since = new Date(Date.now() - 48 * 3600_000).toISOString();
  const { data, error } = await sb.from("articles").select("id, title, url, source, summary, topic, published_at")
    .gte("published_at", since).order("published_at", { ascending: false }).limit(400);
  if (error) return Response.json({ error: error.message }, { status: 500 });
  const byTopic = new Map<string, Art[]>();
  for (const a of (data ?? []) as Art[]) { const t = a.topic ?? "other"; byTopic.set(t, [...(byTopic.get(t) ?? []), a]); }
  const topics = [...byTopic].map(([topic, arts]) => {
    const events = clusterEvents(arts).filter((g) => !excluded(g.map((a) => a.title).join(" "), store.prefs))
      .map((g) => ({ key: eventKey(g), rev: eventRev(g), title: g[0].title, g }));
    const shown = new Map(developments(store.ack[topic] ?? {}, events).map((d) => [d.key, d.status]));
    const items = events.filter((e) => shown.has(e.key)).slice(0, LIMIT[store.prefs.length]).map((e) => ({
      key: e.key, rev: e.rev, status: shown.get(e.key), title: e.title, why: whyThis(e.g, store.prefs), independent: independentSources(e.g),
      articles: e.g.map(({ id, title, url, source, published_at }) => ({ id, title, url, source, published_at })), // originals stay reachable
    }));
    return { topic, items, known: events.length - shown.size };
  }).sort((a, b) => b.items.length - a.items.length);
  const { data: feeds } = await sb.from("feeds").select("id, enabled");
  const health = Object.fromEntries((feeds ?? []).map((f) => [f.id, { ...store.health[f.id], disabled: !f.enabled }]));
  return Response.json({ prefs: store.prefs, topics, health, done: Object.keys(store.done) });
}

export async function POST(req: Request) {
  const { sb, user, res } = await requireUser();
  if (res) return res;
  const b = await req.json().catch(() => ({}));
  if (b.action === "prefs") return Response.json({ prefs: await updateIntel((s) => (s.prefs = cleanPrefs({ ...b.prefs, less: s.prefs.less }))) });
  if (b.action === "less") {
    const k = titleKey(String(b.title ?? "")).slice(0, 60);
    if (!k) return Response.json({ error: "Missing title" }, { status: 400 });
    return Response.json({ prefs: await updateIntel((s) => { if (!s.prefs.less.includes(k)) s.prefs.less = [...s.prefs.less, k].slice(-200); return s.prefs; }) });
  }
  if (b.action === "ack") {
    const topic = String(b.topic ?? "").slice(0, 100), seen = Array.isArray(b.events) ? b.events.slice(0, 100) : [];
    if (!topic) return Response.json({ error: "Missing topic" }, { status: 400 });
    await updateIntel((s) => { const a = (s.ack[topic] ??= {}); for (const e of seen) if (typeof e?.key === "string" && typeof e?.rev === "string") a[e.key.slice(0, 2000)] = e.rev.slice(0, 80); });
    return Response.json({ ok: true });
  }
  if (b.action === "story") {
    const p = storyPayload({ kind: b.kind, title: String(b.title ?? ""), url: String(b.url ?? ""), published_at: typeof b.published_at === "string" ? b.published_at : null, objective: b.objective, acceptance: b.acceptance });
    if ("error" in p || !["note", "watch", "task"].includes(b.kind)) return Response.json({ error: "error" in p ? p.error : "Unknown kind" }, { status: 400 });
    const key = `${p.kind}:${normalizeUrl(String(b.url))}`;
    if ((await readIntel()).done[key]) return Response.json({ existing: true }); // INT06: each action lands once
    try {
      if (p.kind === "note") await createMemory(sb, user.id, { kind: "note", title: p.title, content: p.content, source: "pulse", url: String(b.url), tags: ["news"] });
      else if (p.kind === "watch") { const r = await follow(p.topic); if ("error" in r) return Response.json(r, { status: 400 }); }
      else {
        const { error } = await sb.from("proposals").insert({ user_id: user.id, title: p.title, why: p.why, prompt: p.prompt, agent: "atlas", kind: "news" });
        if (error) throw error;
      }
    } catch (e) { return Response.json({ error: e instanceof Error ? e.message : String((e as { message?: string })?.message ?? e) }, { status: 500 }); }
    await updateIntel((s) => { s.done[key] = new Date().toISOString(); });
    return Response.json({ ok: true });
  }
  return Response.json({ error: 'action must be "prefs", "less", "ack" or "story"' }, { status: 400 });
}
