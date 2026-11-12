import { requireUser } from "@/lib/supabase/server";
import { discardPending, oauthSignedIn, signOutOAuth, isRunning, listPending, loadPlugins, runPending, testPlugin, updatePlugins } from "@/lib/plugins";
import { checkState, publicPlugin, toolGate, toolId, validatePlugin, SUGGESTED } from "@/lib/plugins-pure";
import { vaultDir } from "@/lib/vault";
import { stopAllOn } from "@/lib/stop-all";
import { logActivity } from "@/lib/activity";

export const dynamic = "force-dynamic";

// Profile → Plugins (MCP servers, plugins.ts). GET: plugins (env values masked), each tool's mode/tier, CORE's queued calls, suggestions.
// POST {action:"add", plugin} | {action:"update", name, enabled?, local?, tools?, others?, timeoutSec?} | {action:"remove", name}
//    | {action:"test", name} | {action:"signout", name} (sign-in itself: GET /api/plugins/oauth?name=) | {action:"run", id} (his Run click on a queued call) | {action:"discard", id}.
// Only his clicks here add servers or run queued calls; CORE has no tool that changes this config.
export async function GET() {
  const { res } = await requireUser();
  if (res) return res;
  const plugins = await Promise.all(loadPlugins().map(async (p) => ({
    ...publicPlugin(p),
    ...(p.oauth ? { signedIn: await oauthSignedIn(p.name) } : {}),
    tools: (p.cache?.tools ?? []).map((t) => ({ id: toolId(p.name, t.name), name: t.name, description: t.description, ...toolGate(p, t), check: checkState(t), ...(t.schemaError ? { schemaError: t.schemaError } : {}) })),
    settings: p.tools,
  })));
  return Response.json({ plugins, pending: (await listPending()).map((q) => ({ ...q, running: isRunning(q.id) })), suggested: SUGGESTED, vault: vaultDir(), stopAll: stopAllOn() });
}

export async function POST(req: Request) {
  const { res } = await requireUser();
  if (res) return res;
  const b = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!b || typeof b !== "object") return Response.json({ error: "JSON body required" }, { status: 400 });
  const name = typeof b.name === "string" ? b.name : "";
  let err = "", extra: Record<string, unknown> = {};
  if (b.action === "add") {
    const p = validatePlugin(b.plugin);
    err = typeof p === "string" ? p : await updatePlugins((l) => (l.some((x) => x.name === p.name) ? `a plugin named ${p.name} already exists` : [...l, { ...p, cache: undefined }]));
    if (!err && typeof p !== "string") logActivity({ area: "system", title: `Plugin ${p.name} added (${p.command ? `${p.command} ${p.args.join(" ")}`.slice(0, 120) : p.url})` });
  } else if (b.action === "update") {
    err = await updatePlugins((l) => {
      const cur = l.find((x) => x.name === name);
      if (!cur) return "no such plugin";
      const merged: Record<string, unknown> = { ...cur };
      for (const k of ["enabled", "local", "tools", "others", "timeoutSec"] as const) if (k in b) merged[k] = b[k];
      if (merged.others === null) delete merged.others; // back to "from annotations"
      const next = validatePlugin(merged); // env stays the stored one (the UI only ever sees it masked)
      return typeof next === "string" ? next : l.map((x) => (x.name === name ? next : x));
    });
  } else if (b.action === "remove") {
    err = await updatePlugins((l) => (l.some((x) => x.name === name) ? l.filter((x) => x.name !== name) : "no such plugin"));
    if (!err) { await signOutOAuth(name).catch(() => {}); logActivity({ area: "system", title: `Plugin ${name} removed` }); }
  } else if (b.action === "signout") {
    if (!loadPlugins().some((x) => x.name === name)) err = "no such plugin"; else await signOutOAuth(name);
  } else if (b.action === "test") {
    const r = await testPlugin(name);
    if (!r.ok) err = r.error ?? "test failed"; else extra = { tested: r.tools };
  } else if (b.action === "run") {
    const r = await runPending(String(b.id ?? ""), typeof b.again === "string" ? b.again : null);
    if (r.error) err = r.error; else extra = { out: r.out };
  } else if (b.action === "discard") {
    err = (await discardPending(String(b.id ?? ""))) ?? "";
  } else err = "Unknown action";
  if (err) return Response.json({ error: err }, { status: 400 });
  const view = await (await GET()).json();
  return Response.json({ ...view, ...extra });
}
