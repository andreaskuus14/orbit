import { requireUser } from "@/lib/supabase/server";
import { forgetBoard, readBoard } from "@/lib/team-status";
import { teamBoard } from "@/lib/team-status-pure";
import { SAMPLE_BOARD } from "@/lib/team-status-sample";

export const dynamic = "force-dynamic";

// Mission Control: the agent team's handoff board as Done / Working / Blocked / Needs you. ?refresh=1 re-reads the board.
// When the board can't be read, the sample is returned with live:false and the reason, and the view labels it a sample.
export async function GET(req: Request) {
  const { res } = await requireUser();
  if (res) return res;
  if (new URL(req.url).searchParams.get("refresh") === "1") forgetBoard();
  const read = await readBoard();
  const repo = process.env.ORBIT_GITHUB_REPO?.trim() ?? "";
  return read.live
    ? Response.json({ live: true, at: read.at, board: teamBoard(read.blocks, repo) })
    : Response.json({ live: false, reason: read.reason, board: teamBoard(SAMPLE_BOARD, repo) });
}
