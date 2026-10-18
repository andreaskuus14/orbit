import { requireUser } from "@/lib/supabase/server";
import { askClaude, recordUsage, MODEL } from "@/lib/claude";
import { envRepos, gitSummary, saveRepos, savedRepos } from "@/lib/git";
import { summaryText } from "@/lib/git-pure";
import { DEVLOG_SCRIPT_SYSTEM, parseDevlogScript } from "@/lib/clips/devlog";

export const dynamic = "force-dynamic";

/** Read-only git repos: env ones (fixed) + saved ones (editable in STUDIO → Devlog). */
export async function GET() {
  const { res } = await requireUser();
  if (res) return res;
  return Response.json({ env: envRepos(), saved: await savedRepos() });
}

/** { repos: "C:\\a\nC:\\b" } saves the list; { action: "devlog" } → one Claude call: a 30-45 s Short script from this week's commits. */
export async function POST(req: Request) {
  const { sb, user, res } = await requireUser();
  if (res) return res;
  const b = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (typeof b?.repos === "string") {
    if (b.repos.length > 4000) return Response.json({ error: "Too long" }, { status: 400 });
    try { return Response.json({ env: envRepos(), saved: await saveRepos(b.repos) }); }
    catch { return Response.json({ error: "Couldn't save the repo list" }, { status: 500 }); }
  }
  if (b?.action !== "devlog") return Response.json({ error: "repos or action: devlog required" }, { status: 400 });
  const rs = await gitSummary(undefined, 7);
  if (!rs.length) return Response.json({ error: "Add your game's git folder first (or set ORBIT_GIT_REPOS)" }, { status: 400 });
  if (!rs.some((r) => r.commits.length)) return Response.json({ error: rs.find((r) => r.error)?.error ?? "No commits in the last 7 days" }, { status: 400 });
  try {
    const r = await askClaude(`<commits>\n${summaryText(rs, 7).replace(/<\/?commits>/gi, "").slice(0, 12_000)}\n</commits>`, DEVLOG_SCRIPT_SYSTEM, { lane: "background", signal: req.signal, purpose: "clips" });
    await recordUsage(sb, user.id, "clips.devlog-script", r, MODEL);
    const script = parseDevlogScript(r.text);
    return script ? Response.json({ script, commits: rs.reduce((k, x) => k + x.commits.length, 0) }) : Response.json({ error: "Claude's reply was unusable, try again" }, { status: 502 });
  } catch (e) {
    return Response.json({ error: `Claude: ${e instanceof Error ? e.message : e}` }, { status: 502 });
  }
}
