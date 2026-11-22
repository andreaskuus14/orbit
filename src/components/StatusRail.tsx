"use client";
// System state as radial gauges around a mini CORE glyph (plan #6), instead of a table. Each ring: one subsystem, its colour the
// state (ok / working / needs attention), a slow sweep while it works. Text stays in the DOM for screen readers.
// Needs attention is calm (owner, 22 Nov: no red rings): its ring keeps the normal short arc, without glow, and a small soft
// dot sits at the arc's start; the line beside it says what is wrong.
type Tone = "ok" | "warn" | "bad";
export type RailItem = { label: string; value: string; tone: Tone; busy?: boolean };

const C = { ok: "#7dd3fc", warn: "#f5b25c", bad: "#eeaab6" } as const;

export function StatusRail({ items }: { items: RailItem[] }) {
  const R0 = 18, GAP = 7;
  const size = 2 * (R0 + GAP * items.length) + 4, c = size / 2;
  return (
    <div className="rail">
      <svg className="rail-rings" width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden>
        <circle cx={c} cy={c} r={R0 - 8} className="rail-core" />
        {items.map((it, k) => {
          const r = R0 + GAP * k, len = 2 * Math.PI * r, arc = it.tone === "ok" && !it.busy ? 0.72 : 0.45, calm = it.tone === "ok";
          const a = ((-90 + k * 23) * Math.PI) / 180; // where the arc starts: the problem dot sits there
          return (
            <g key={it.label} className={it.busy ? "rail-busy" : undefined} style={{ transformOrigin: `${c}px ${c}px` }}>
              <circle cx={c} cy={c} r={r} className="rail-track" />
              <circle cx={c} cy={c} r={r} fill="none" stroke={calm ? C.ok : C[it.tone]} strokeOpacity={calm ? 1 : 0.55} strokeWidth={calm ? 2 : 1.5} strokeLinecap="round"
                strokeDasharray={`${len * arc} ${len}`} transform={`rotate(${-90 + k * 23} ${c} ${c})`} style={calm ? { filter: `drop-shadow(0 0 3px ${C.ok})` } : undefined} />
              {!calm && <circle cx={c + r * Math.cos(a)} cy={c + r * Math.sin(a)} r={2.2} fill={C[it.tone]} />}
            </g>
          );
        })}
      </svg>
      <dl className="rail-list">
        {items.map((it) => <div key={it.label}><dt>{it.label}</dt><dd className={it.tone}>{it.value}</dd></div>)}
      </dl>
    </div>
  );
}
