import { requireUser } from "@/lib/supabase/server";
import { addAlert, addJournal, analyze, reviewJournal, studyStrategy, firedAlerts, getMarkets, paperOrder, removeAlert, removeHolding, resetPaper, setHolding, setStrategy, unwatch, watch } from "@/lib/markets";
import { STRATEGIES, alertError, cleanTicker, type AlertKind, type Strategy } from "@/lib/markets-pure";

export const dynamic = "force-dynamic";

// MARKETS workspace (tracking, education and PAPER trading only — no broker, no real money).
// GET → full state (also runs the daily paper-bot step).
// POST { action: "alerts" } → { fired: [{ id, ticker, text }] } (marks them fired today; POST so the CSRF guard covers it).
// POST { action: alerts|watch|unwatch|holding|removeHolding|addAlert|removeAlert|order|resetPaper|strategy|analyze|study|journal|review, ... }.

export async function GET(req: Request) {
  const { res } = await requireUser();
  if (res) return res;
  try {
    return Response.json(await getMarkets());
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 500 });
  }
}

const bad = (error: string) => Response.json({ error }, { status: 400 });
const out = (r: object) => ("error" in r ? Response.json(r, { status: 400 }) : Response.json(r));
const isNum = (v: unknown, min: number, max: number): v is number => typeof v === "number" && Number.isFinite(v) && v >= min && v <= max;

export async function POST(req: Request) {
  const { sb, user, res } = await requireUser();
  if (res) return res;
  const b = await req.json().catch(() => null);
  if (!b || typeof b !== "object") return bad("Invalid JSON body");
  const t = b.ticker === undefined ? null : cleanTicker(b.ticker);
  const needT = () => (t ? null : bad("Ticker must be 1–15 letters, digits, . ^ or -"));
  switch (b.action) {
    case "watch": return needT() ?? out(await watch(t!));
    case "unwatch": return needT() ?? out(await unwatch(t!));
    case "holding":
      if (!isNum(b.shares, 1e-6, 1e9) || !isNum(b.cost, 0, 1e7)) return bad("Shares must be > 0 and average cost ≥ 0");
      return needT() ?? out(await setHolding(t!, b.shares, b.cost));
    case "removeHolding": return needT() ?? out(await removeHolding(t!));
    case "addAlert": {
      const err = alertError(b.kind, b.value);
      if (err) return bad(err);
      return needT() ?? out(await addAlert(t!, b.kind as AlertKind, b.value));
    }
    case "removeAlert": return typeof b.id === "string" && b.id.length <= 80 ? out(await removeAlert(b.id)) : bad("Missing id");
    case "order": return needT() ?? out(await paperOrder(t!, b.side, b.qty));
    case "resetPaper": return out(await resetPaper());
    case "strategy":
      return typeof b.strategy === "string" && Object.hasOwn(STRATEGIES, b.strategy) ? out(await setStrategy(b.strategy as Strategy)) : bad("Unknown strategy");
    case "analyze": return needT() ?? out(await analyze(sb, user.id, t!));
    case "study":
      return typeof b.strategy === "string" && Object.hasOwn(STRATEGIES, b.strategy) ? out(await studyStrategy(b.strategy as Strategy)) : bad("Unknown strategy");
    case "journal": return out(await addJournal(b));
    case "review": return typeof b.id === "string" && b.id.length <= 80 ? out(await reviewJournal(b.id, b)) : bad("Missing id");
    case "alerts":
      try { return Response.json({ fired: await firedAlerts() }); } catch (e) { return Response.json({ error: (e as Error).message }, { status: 500 }); }
    default: return bad("Unknown action");
  }
}
