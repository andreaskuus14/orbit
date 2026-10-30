// LIF08 weekly review IO: reads life.json, dayplan.json and school.json locally (rules: life-week-pure.ts). No model call.
import { exportLife } from "./life";
import { dateKey } from "./life-pure";
import { weekReview } from "./life-week-pure";

export async function getWeekReview(now = Date.now()) {
  const [life, plans, school] = await Promise.all([
    exportLife(),
    import("./dayplan").then((m) => m.planHistory()).catch(() => ({ history: [], deferred: [] })),
    import("./school").then((m) => m.getSchool(now)).then((s) => s.items).catch(() => null), // null = couldn't read: listed as missing
  ]);
  return weekReview({ life, history: plans.history, deferred: plans.deferred, school, today: dateKey(new Date(now)) });
}
