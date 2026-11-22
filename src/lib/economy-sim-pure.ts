// GAME DEV DEV07: a deterministic, game-agnostic economy simulator. The owner's table of currency sources, timed rewards and
// sinks (prices, optional upgrade growth/boost, rebirth/prestige resets, secondary currency) → N seeded players → when each sink
// is first bought, where currency flows, the longest stretch with nothing to do, and how sensitive that is to each input.
// Everything is SIMULATED in-game currency: there are no real-money rows and no revenue or player-count forecasts.
// Same seed → same result; any one player can be replayed. Pure; tested in tests/economy-sim.test.ts.
import { rng } from "./economy-pure.ts";

export type BuyStrategy = "greedy" | "save_for_goal" | "mixed";
export type Source = { name: string; amount: number; every: number; currency?: string }; // amount per `every` seconds of play
export type Reward = { name: string; amount: number; at: number; repeat: number; currency?: string }; // minutes of play; repeat 0 = once
export type Sink = {
  name: string;
  price: number;
  growth: number; // growth >= 1 = rebuyable at price × growth; 0 = one-off
  boost: number; // boost % added to primary sources
  currency?: string; // defaults to Model.currency (primary)
  isRebirth?: boolean; // triggers rebirth/prestige reset when bought
  rebirthMult?: number; // permanent income multiplier applied on rebirth (default 1.5)
  rebirthRewardCurrency?: number; // secondary prestige currency granted on rebirth
  resetsUpgrades?: boolean; // default true on rebirth: resets non-permanent primary upgrades
  permanent?: boolean; // if true, survives rebirth resets
  isMilestone?: boolean; // explicit goal marker for save_for_goal budgeting
  rewardSecondary?: number; // optional secondary currency granted when bought
};
export type RebirthConfig = {
  name?: string;
  price: number;
  growth?: number; // default 2
  mult?: number; // default 1.5
  rewardSecondary?: number; // default 0
  resetsUpgrades?: boolean; // default true
};
export type Model = {
  currency: string;
  sources: Source[];
  rewards: Reward[];
  sinks: Sink[];
  session: number;
  sessions: number;
  strategy?: BuyStrategy;
  rebirth?: RebirthConfig;
  secondaryCurrencyName?: string;
  secondaryEarnPerMin?: number;
};

export const MAX_MODEL = 6000;
export const SAMPLE_MODEL = `# One row per line, comma separated. Lines starting with # are ignored. In-game currency only.
# currency, <name>
# source, <name>, <amount>, <every seconds>         how players earn while playing
# reward, <name>, <amount>, <at minute>, [repeat]   timed rewards (playtime gift, daily chest)
# sink, <name>, <price>, [growth ×], [boost %]       what they spend on; growth > 1 = buy again at price × growth
# session, <minutes>, <sessions>
currency, Coins
source, Clicking, 2, 1
source, Pet income, 5, 10
reward, Playtime gift, 150, 10, 15
sink, Speed upgrade, 100, 1.6, 15
sink, Forest area, 2500
sink, Golden pet, 8000
sink, Ocean area, 40000
session, 20, 6`;

/** The pasted table, strictly: every bad line is reported with its number and skipped. */
export function parseModel(text: string): { model: Model; errors: string[] } {
  const m: Model = { currency: "Coins", sources: [], rewards: [], sinks: [], session: 20, sessions: 5 }, errors: string[] = [];
  const num = (s: string | undefined) => (s !== undefined && s.trim() !== "" && Number.isFinite(Number(s)) ? Number(s) : NaN);
  text.slice(0, MAX_MODEL).split("\n").forEach((raw, i) => {
    const l = raw.trim();
    if (!l || l.startsWith("#")) return;
    const c = l.split(/\t|,/).map((x) => x.trim()), kind = c[0].toLowerCase(), name = (c[1] ?? "").slice(0, 40), bad = (why: string) => errors.push(`Line ${i + 1}: ${why}`);
    const full = m.sources.length + m.rewards.length + m.sinks.length >= 60;
    if (kind === "currency") m.currency = name || m.currency;
    else if (kind === "currency2" || kind === "secondary") {
      const rate = c[2] ? num(c[2]) : 0;
      if (name && rate >= 0) { m.secondaryCurrencyName = name; if (rate > 0) m.secondaryEarnPerMin = rate; }
      else bad("secondary currency needs a name and optional earn/min ≥ 0");
    } else if (kind === "strategy") {
      const st = name.toLowerCase();
      if (st === "greedy" || st === "save_for_goal" || st === "mixed") m.strategy = st;
      else bad("strategy must be greedy, save_for_goal or mixed");
    } else if (/robux|revenue|usd|eur|money/.test(kind)) bad("real money and revenue are out of scope: this simulates in-game currency only");
    else if (full && ["source", "reward", "sink", "rebirth"].includes(kind)) bad("at most 60 rows");
    else if (kind === "source") {
      const a = num(c[2]), e = num(c[3]), cur = c[4] ? c[4].slice(0, 40) : undefined;
      if (name && a > 0 && e > 0) m.sources.push(cur ? { name, amount: a, every: e, currency: cur } : { name, amount: a, every: e });
      else bad("source needs a name, amount > 0 and every seconds > 0");
    } else if (kind === "reward") {
      const a = num(c[2]), at = num(c[3]), rep = c[4] ? num(c[4]) : 0, cur = c[5] ? c[5].slice(0, 40) : undefined;
      if (name && a > 0 && at >= 0 && rep >= 0) m.rewards.push(cur ? { name, amount: a, at, repeat: rep, currency: cur } : { name, amount: a, at, repeat: rep });
      else bad("reward needs a name, amount > 0, minute ≥ 0 and repeat ≥ 0");
    } else if (kind === "sink") {
      const p = num(c[2]), g = c[3] ? num(c[3]) : 0, b = c[4] ? num(c[4]) : 0, cur = c[5] ? c[5].slice(0, 40) : undefined;
      if (!name || !(p > 0) || !(g === 0 || g >= 1) || !(b >= 0)) bad("sink needs a name, price > 0, growth 0 or ≥ 1, boost ≥ 0");
      else if (m.sinks.some((x) => x.name === name)) bad(`sink "${name}" is listed twice`);
      else m.sinks.push(cur ? { name, price: p, growth: g, boost: b, currency: cur } : { name, price: p, growth: g, boost: b });
    } else if (kind === "rebirth") {
      const p = num(c[2]), g = c[3] ? num(c[3]) : 2, mult = c[4] ? num(c[4]) : 1.5, rew = c[5] ? num(c[5]) : 0;
      if (!name || !(p > 0) || !(g === 0 || g >= 1) || !(mult > 0) || !(rew >= 0)) bad("rebirth needs a name, price > 0, growth 0 or ≥ 1, mult > 0 and reward ≥ 0");
      else if (m.sinks.some((x) => x.name === name)) bad(`sink "${name}" is listed twice`);
      else m.sinks.push({ name, price: p, growth: g, boost: 0, isRebirth: true, rebirthMult: mult, rebirthRewardCurrency: rew, resetsUpgrades: true });
    } else if (kind === "session") {
      const a = num(c[1]), b = num(c[2]);
      if (a >= 1 && a <= 240 && Number.isInteger(b) && b >= 1 && b <= 50) { m.session = a; m.sessions = b; } else bad("session needs minutes 1–240 and sessions 1–50");
    } else bad(`unknown row "${c[0].slice(0, 20)}" (use currency, source, reward, sink or session)`);
  });
  if (!m.sources.length && !m.rewards.length) errors.push("Add at least one source or reward");
  if (!m.sinks.length) errors.push("Add at least one sink");
  return { model: m, errors };
}

// ---- Simulation ---------------------------------------------------------------

export type Event = { min: number; kind: "reward" | "buy" | "rebirth"; name: string; balance: number; currency?: string };
export type SimOpts = { players: number; seed: number; strategy?: BuyStrategy };
export const SIM_DEFAULTS: SimOpts = { players: 100, seed: 1 };
const STEP = 10; // seconds per tick: plenty for minute-level answers
/** Purchases one simulated player may make (and log). A rebuyable sink at growth 1 with a boost ("sink, Speed, 1, 1, 10") made
 *  every buy pay for the next, so the greedy loop never ended and took ORBIT's memory with it. Past the cap the player only saves. */
export const MAX_BUYS = 2000;

export type SecondarySummary = { currency: string; earned: number; rewarded: number; spent: number; balance: number };
export type PlayOneResult = {
  events: Event[];
  earned: number;
  rewarded: number;
  spent: Record<string, number>;
  balance: number;
  rebirths: number;
  rebirthMult: number;
  secondary?: SecondarySummary & { spentBySink: Record<string, number> };
};

/** Resolve effective sinks, appending a synthesized rebirth sink if Model.rebirth is configured. */
function effectiveSinks(m: Model): Sink[] {
  if (!m.rebirth) return m.sinks;
  const rName = m.rebirth.name || "Rebirth";
  if (m.sinks.some((s) => s.name === rName)) return m.sinks;
  return [
    ...m.sinks,
    {
      name: rName,
      price: m.rebirth.price,
      growth: m.rebirth.growth ?? 2,
      boost: 0,
      isRebirth: true,
      rebirthMult: m.rebirth.mult ?? 1.5,
      rebirthRewardCurrency: m.rebirth.rewardSecondary ?? 0,
      resetsUpgrades: m.rebirth.resetsUpgrades ?? true,
    },
  ];
}

/** Detect secondary currency name if configured explicitly or referenced by any source/reward/sink/rebirth. */
function resolveSecondaryCurrency(m: Model, sinks: Sink[]): string | null {
  if (m.secondaryCurrencyName && m.secondaryCurrencyName !== m.currency) return m.secondaryCurrencyName;
  for (const s of m.sources) if (s.currency && s.currency !== m.currency) return s.currency;
  for (const x of m.rewards) if (x.currency && x.currency !== m.currency) return x.currency;
  for (const s of sinks) if (s.currency && s.currency !== m.currency) return s.currency;
  if ((m.secondaryEarnPerMin ?? 0) > 0) return "Gems";
  if (sinks.some((s) => (s.rebirthRewardCurrency ?? 0) > 0 || (s.rewardSecondary ?? 0) > 0)) return "Gems";
  return null;
}

const isSecondaryItem = (currency: string | undefined, primary: string) => Boolean(currency && currency !== primary);
const isGoalSink = (s: Sink) => Boolean(s.isRebirth || s.isMilestone || s.growth < 1);

/** Estimate average future timed-reward income per second for a currency over the remaining session. */
function futureRewardRate(rewards: Reward[], next: number[], t: number, end: number, primary: string, forSecondary: boolean): number {
  const rem = Math.max(STEP, end - t);
  let total = 0;
  for (let i = 0; i < rewards.length; i++) {
    const r = rewards[i];
    if (isSecondaryItem(r.currency, primary) !== forSecondary) continue;
    let nt = next[i];
    if (nt > end) continue;
    if (r.repeat > 0) {
      const count = Math.floor((end - nt) / (r.repeat * 60)) + 1;
      total += r.amount * count;
    } else {
      total += r.amount;
    }
  }
  return total / rem;
}

/** Pick the next sink index to buy for a given currency under either greedy or save_for_goal budgeting. */
function pickNextSink(
  sinks: Sink[],
  price: number[],
  bought: number[],
  bal: number,
  primary: string,
  forSecondary: boolean,
  mode: "greedy" | "save_for_goal",
  sourceRatePerSec: number,
  rewardRatePerSec: number,
  totalBoostPct: number,
  remainingSec: number,
): number {
  const eligible: number[] = [];
  for (let i = 0; i < sinks.length; i++) {
    const s = sinks[i];
    if (isSecondaryItem(s.currency, primary) !== forSecondary) continue;
    if (s.growth >= 1 || !bought[i]) eligible.push(i);
  }
  if (!eligible.length) return -1;

  if (mode === "greedy") {
    let k = -1;
    for (const i of eligible) if (price[i] <= bal && (k < 0 || price[i] < price[k])) k = i;
    return k;
  }

  // save_for_goal: identify the cheapest unbought goal/milestone/rebirth in this currency
  let goalIdx = -1;
  for (const i of eligible) {
    if (!isGoalSink(sinks[i])) continue;
    if (goalIdx < 0 || price[i] < price[goalIdx]) goalIdx = i;
  }

  // If the next goal is already affordable, buy it immediately!
  if (goalIdx >= 0 && price[goalIdx] <= bal) return goalIdx;

  // Otherwise, check affordable non-goal upgrades: only buy one if it strictly accelerates reaching the goal
  // (or if there is no reachable goal left in the remaining session time).
  const affordableNonGoals = eligible.filter((i) => i !== goalIdx && price[i] <= bal);
  if (!affordableNonGoals.length) return -1;

  if (goalIdx < 0) {
    // No goals left in this currency: buy cheapest affordable upgrade
    return affordableNonGoals.reduce((best, i) => (price[i] < price[best] ? i : best), affordableNonGoals[0]);
  }

  const effRate = sourceRatePerSec + rewardRatePerSec;
  const goalCost = price[goalIdx];
  const tSave = effRate > 0 ? (goalCost - bal) / effRate : Infinity;
  const goalReachableBySaving = tSave <= remainingSec;

  // Evaluate ROI of each affordable upgrade toward reaching `goalIdx` faster
  let bestUpgrade = -1;
  let bestTime = tSave;
  for (const i of affordableNonGoals) {
    const s = sinks[i];
    if (!forSecondary && s.boost > 0 && sourceRatePerSec > 0) {
      const multRatio = (1 + (totalBoostPct + s.boost) / 100) / (1 + totalBoostPct / 100);
      const newRate = sourceRatePerSec * multRatio + rewardRatePerSec;
      const tBuy = (goalCost - (bal - price[i])) / newRate;
      if (tBuy < bestTime - 1e-6) {
        bestTime = tBuy;
        bestUpgrade = i;
      }
    }
  }

  if (bestUpgrade >= 0) return bestUpgrade;
  // Goal is reachable by saving and no affordable upgrade speeds it up -> hold currency for the goal!
  if (goalReachableBySaving) return -1;
  // Goal is unreachable even by saving -> allow buying cheapest affordable upgrade instead of stalling
  return affordableNonGoals.reduce((best, i) => (price[i] < price[best] ? i : best), affordableNonGoals[0]);
}

/** One seeded player. Activity varies 70–130% per player; supports save_for_goal (default), greedy, or mixed strategy,
 *  rebirth/prestige resets, and optional secondary currency tracking. */
export function playOne(m: Model, seed: number, player: number, strategy?: BuyStrategy): PlayOneResult {
  const sinks = effectiveSinks(m);
  const secName = resolveSecondaryCurrency(m, sinks);
  const r = rng((seed * 7919 + player * 104729) >>> 0), activity = 0.7 + 0.6 * r();
  const strat = strategy ?? m.strategy ?? "save_for_goal";
  const mode: "greedy" | "save_for_goal" = strat === "mixed" ? (r() < 0.75 ? "save_for_goal" : "greedy") : strat;

  const price = sinks.map((s) => s.price), bought = sinks.map(() => 0);
  const spent: Record<string, number> = {}, secSpentBySink: Record<string, number> = {};
  const next = m.rewards.map((x) => x.at * 60), events: Event[] = [];
  let bal = 0, earned = 0, rewarded = 0, tempBoost = 0, permBoost = 0, buys = 0;
  let rebirths = 0, rebirthMult = 1;
  let secBal = 0, secEarned = 0, secRewarded = 0, secSpentTotal = 0;
  const end = m.session * m.sessions * 60;

  const basePrimaryPerSec = m.sources.reduce((a, s) => (isSecondaryItem(s.currency, m.currency) ? a : a + s.amount / s.every), 0);
  const baseSecPerSec =
    m.sources.reduce((a, s) => (isSecondaryItem(s.currency, m.currency) ? a + s.amount / s.every : a), 0) +
    (m.secondaryEarnPerMin ? m.secondaryEarnPerMin / 60 : 0);

  for (let t = STEP; t <= end; t += STEP) {
    const totalBoost = tempBoost + permBoost;
    const primaryRate = basePrimaryPerSec * activity * (1 + totalBoost / 100) * rebirthMult;
    const inc = primaryRate * STEP;
    bal += inc; earned += inc;

    if (secName && baseSecPerSec > 0) {
      const secInc = baseSecPerSec * activity * STEP;
      secBal += secInc; secEarned += secInc;
    }

    m.rewards.forEach((x, i) => {
      if (next[i] > t) return;
      if (secName && isSecondaryItem(x.currency, m.currency)) {
        secBal += x.amount; secRewarded += x.amount;
        events.push({ min: t / 60, kind: "reward", name: x.name, balance: Math.round(secBal), currency: secName });
      } else {
        bal += x.amount; rewarded += x.amount;
        events.push({ min: t / 60, kind: "reward", name: x.name, balance: Math.round(bal) });
      }
      next[i] = x.repeat > 0 ? next[i] + x.repeat * 60 : Infinity;
    });

    const remSec = Math.max(0, end - t);

    // Primary currency purchase loop
    while (buys < MAX_BUYS) {
      const curBoost = tempBoost + permBoost;
      const curPrimaryRate = basePrimaryPerSec * activity * (1 + curBoost / 100) * rebirthMult;
      const rewRate = mode === "save_for_goal" ? futureRewardRate(m.rewards, next, t, end, m.currency, false) : 0;
      const k = pickNextSink(sinks, price, bought, bal, m.currency, false, mode, curPrimaryRate, rewRate, curBoost, remSec);
      if (k < 0) break;
      const s = sinks[k];
      bal -= price[k]; spent[s.name] = (spent[s.name] ?? 0) + price[k]; bought[k]++; buys++;

      if (s.isRebirth) {
        rebirths++;
        const mult = s.rebirthMult && s.rebirthMult > 0 ? s.rebirthMult : 1.5;
        rebirthMult *= mult;
        if (s.boost > 0) permBoost += s.boost;
        if (secName && s.rebirthRewardCurrency && s.rebirthRewardCurrency > 0) {
          secBal += s.rebirthRewardCurrency;
          secRewarded += s.rebirthRewardCurrency;
        }
        bal = 0; // rebirth resets primary balance
        if (s.resetsUpgrades !== false) {
          tempBoost = 0;
          for (let i = 0; i < sinks.length; i++) {
            const other = sinks[i];
            if (i === k || other.isRebirth || other.permanent || isSecondaryItem(other.currency, m.currency)) continue;
            price[i] = other.price;
            bought[i] = 0;
          }
        }
        events.push({ min: t / 60, kind: "rebirth", name: s.name, balance: 0 });
        if (s.growth >= 1) price[k] *= s.growth;
      } else {
        if (s.permanent) permBoost += s.boost;
        else tempBoost += s.boost;
        if (secName && s.rewardSecondary && s.rewardSecondary > 0) {
          secBal += s.rewardSecondary;
          secRewarded += s.rewardSecondary;
        }
        events.push({ min: t / 60, kind: "buy", name: s.name, balance: Math.round(bal) });
        if (s.growth >= 1) price[k] *= s.growth;
      }
    }

    // Secondary currency purchase loop
    if (secName) {
      while (buys < MAX_BUYS) {
        const curSecRate = baseSecPerSec * activity;
        const secRewRate = mode === "save_for_goal" ? futureRewardRate(m.rewards, next, t, end, m.currency, true) : 0;
        const k = pickNextSink(sinks, price, bought, secBal, m.currency, true, mode, curSecRate, secRewRate, 0, remSec);
        if (k < 0) break;
        const s = sinks[k];
        secBal -= price[k];
        secSpentTotal += price[k];
        secSpentBySink[s.name] = (secSpentBySink[s.name] ?? 0) + price[k];
        bought[k]++; buys++;
        permBoost += s.boost; // prestige/secondary-currency boosts are permanent
        events.push({ min: t / 60, kind: "buy", name: s.name, balance: Math.round(secBal), currency: secName });
        if (s.growth >= 1) price[k] *= s.growth;
      }
    }
  }

  const out: PlayOneResult = { events, earned, rewarded, spent, balance: bal, rebirths, rebirthMult };
  if (secName) {
    out.secondary = { currency: secName, earned: secEarned, rewarded: secRewarded, spent: secSpentTotal, balance: secBal, spentBySink: secSpentBySink };
  }
  return out;
}

const q = (xs: number[], p: number) => { if (!xs.length) return null; const s = [...xs].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(p * s.length))]; };
const r1 = (x: number | null) => (x === null ? null : Math.round(x * 10) / 10);
const r2 = (x: number) => Math.round(x * 100) / 100;

export type SinkStat = { name: string; price: number; reached: number; median: number | null; p90: number | null; buys: number | null; share: number; currency?: string };
export type SimResult = {
  label: "simulated"; seed: number; players: number; minutes: number;
  sinks: SinkStat[]; earned: number; rewarded: number; spent: number; endBalance: number; // medians per player
  gap: { minutes: number; from: number } | null; // median player's longest stretch with no reward and nothing bought
  avgRebirths: number;
  rebirthRate: number; // percentage (0–100) of players who rebirthed at least once
  secondary?: { currency: string; earned: number; rewarded: number; spent: number; endBalance: number };
};

const longestGap = (ev: Event[], end: number) => {
  let best = { minutes: 0, from: 0 }, last = 0;
  for (const e of [...ev.map((x) => x.min), end]) { if (e - last > best.minutes) best = { minutes: e - last, from: last }; last = e; }
  return best;
};

export function simulateModel(m: Model, o: SimOpts = SIM_DEFAULTS): SimResult {
  const sinksList = effectiveSinks(m);
  const secName = resolveSecondaryCurrency(m, sinksList);
  const n = Math.max(1, Math.min(500, Math.floor(o.players))), minutes = m.session * m.sessions;
  const runs = Array.from({ length: n }, (_, i) => playOne(m, o.seed, i, o.strategy));
  const total = (xs: Record<string, number>) => Object.values(xs).reduce((a, b) => a + b, 0);
  const spentAll = runs.reduce((a, x) => a + total(x.spent), 0) || 1;
  const secSpentAll = runs.reduce((a, x) => a + (x.secondary?.spent ?? 0), 0) || 1;

  const sinks = sinksList.map((s): SinkStat => {
    const isSec = isSecondaryItem(s.currency, m.currency);
    const first = runs.flatMap((x) => {
      const e = x.events.find((v) => (v.kind === "buy" || v.kind === "rebirth") && v.name === s.name);
      return e ? [e.min] : [];
    });
    const sinkSpent = isSec
      ? runs.reduce((a, x) => a + (x.secondary?.spentBySink[s.name] ?? 0), 0)
      : runs.reduce((a, x) => a + (x.spent[s.name] ?? 0), 0);
    const denom = isSec ? secSpentAll : spentAll;
    const stat: SinkStat = {
      name: s.name, price: s.price, reached: Math.round((first.length / n) * 100),
      median: r1(q(first, 0.5)), p90: r1(q(first, 0.9)),
      buys: q(runs.map((x) => x.events.filter((v) => (v.kind === "buy" || v.kind === "rebirth") && v.name === s.name).length), 0.5),
      share: Math.round((sinkSpent / denom) * 100),
    };
    if (isSec && s.currency) stat.currency = s.currency;
    return stat;
  });

  const gaps = runs.map((x) => longestGap(x.events, minutes)).sort((a, b) => a.minutes - b.minutes), g = gaps[Math.floor(n / 2)];
  const med = (f: (x: (typeof runs)[number]) => number) => Math.round(q(runs.map(f), 0.5) ?? 0);
  const avgRebirths = r2(runs.reduce((a, x) => a + x.rebirths, 0) / n);
  const rebirthRate = Math.round((runs.filter((x) => x.rebirths > 0).length / n) * 100);

  const res: SimResult = {
    label: "simulated", seed: o.seed, players: n, minutes, sinks,
    earned: med((x) => x.earned), rewarded: med((x) => x.rewarded), spent: med((x) => total(x.spent)),
    endBalance: med((x) => x.balance),
    gap: g && g.minutes > 0 ? { minutes: r1(g.minutes)!, from: r1(g.from)! } : null,
    avgRebirths, rebirthRate,
  };
  if (secName) {
    res.secondary = {
      currency: secName,
      earned: med((x) => x.secondary?.earned ?? 0),
      rewarded: med((x) => x.secondary?.rewarded ?? 0),
      spent: med((x) => x.secondary?.spent ?? 0),
      endBalance: med((x) => x.secondary?.balance ?? 0),
    };
  }
  return res;
}

/** Plain findings, codes for gd.sim.f.* (all simulated). */
export type Finding = { code: "unreached" | "pileUp" | "gap"; vars: Record<string, string | number> };
export function findings(r: SimResult): Finding[] {
  const out: Finding[] = [];
  for (const s of r.sinks) if (s.reached < 50) out.push({ code: "unreached", vars: { name: s.name, pct: s.reached } });
  if (r.spent < 0.5 * (r.earned + r.rewarded)) out.push({ code: "pileUp", vars: { pct: Math.round((r.spent / Math.max(1, r.earned + r.rewarded)) * 100) } });
  if (r.gap && r.gap.minutes >= 10) out.push({ code: "gap", vars: { min: r.gap.minutes, from: r.gap.from } });
  return out;
}

// ---- Sensitivity ----------------------------------------------------------------

export type Sens = { input: string; down: number | null; up: number | null }; // Δ minutes to the target sink at ×0.8 / ×1.2
/** Each source/reward amount and sink price alone at ×0.8 and ×1.2, same seed: how far the median minute of the
 *  furthest sink most players reach moves. Sorted by largest effect. */
export function sensitivity(m: Model, o: SimOpts = SIM_DEFAULTS): { target: string | null; rows: Sens[] } {
  const base = simulateModel(m, o), t = [...base.sinks].reverse().find((s) => s.reached >= 50 && s.median !== null);
  if (!t) return { target: null, rows: [] };
  const at = (mm: Model) => { const s = simulateModel(mm, o).sinks.find((x) => x.name === t.name)!; return s.reached >= 50 ? s.median : null; };
  const d = (v: number | null) => (v === null ? null : r1(v - t.median!));
  const vary = (f: (k: number) => Model) => ({ down: d(at(f(0.8))), up: d(at(f(1.2))) });
  const rows: Sens[] = [
    ...m.sources.map((s, i) => ({ input: `source:${s.name}`, ...vary((k) => ({ ...m, sources: m.sources.map((x, j) => (j === i ? { ...x, amount: x.amount * k } : x)) })) })),
    ...m.rewards.map((s, i) => ({ input: `reward:${s.name}`, ...vary((k) => ({ ...m, rewards: m.rewards.map((x, j) => (j === i ? { ...x, amount: x.amount * k } : x)) })) })),
    ...m.sinks.map((s, i) => ({ input: `sink:${s.name}`, ...vary((k) => ({ ...m, sinks: m.sinks.map((x, j) => (j === i ? { ...x, price: x.price * k } : x)) })) })),
  ];
  const size = (s: Sens) => Math.max(Math.abs(s.down ?? 1e9), Math.abs(s.up ?? 1e9));
  return { target: t.name, rows: rows.sort((a, b) => size(b) - size(a)) };
}
