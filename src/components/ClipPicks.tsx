"use client";

// One-click title + thumbnail picks for a clip (clip.titleOptions / clip.thumbOptions). Used by the ClipFactory clip card and ReviewQueue.
type Picks = { title: string; thumb?: string; titleOptions?: { text: string; score: number }[]; thumbOptions?: string[];
  critic?: { options: { text: string; score: number; issues: string[] }[]; notes: string[]; rewrite?: string; for: string[] } }; // titles.ts Critique

const media = (p: string) => `/api/studio/clips/media?f=${encodeURIComponent(p)}`; // same as ClipFactory/ReviewQueue

export default function ClipPicks({ clip: c, busy, onPick, onMore, onReview, moreBusy, big }: {
  clip: Picks; busy: boolean; onPick: (body: { title?: string; thumb?: string }) => void; onMore: () => void; onReview?: () => void; moreBusy: boolean; big?: boolean;
}) {
  const texts = c.titleOptions?.length ? c.titleOptions.map((o) => o.text) : [c.title];
  const cr = c.critic && c.critic.for.length === texts.length && c.critic.for.every((t) => texts.includes(t)) ? c.critic : undefined; // stale after "More titles"
  const crit = (t: string) => cr?.options.find((o) => o.text === t);
  const thumbs = c.thumbOptions ?? [];
  const chip = big ? "chip !px-2 !py-0.5 !text-[11px]" : "chip !px-1.5 !py-0.5 !text-[10px]";
  return (
    <div className="flex flex-col gap-1">
      <div role="group" aria-label="Title options" className="flex flex-wrap gap-1">
        {c.titleOptions?.map((o) => (
          <button key={o.text} className={`${chip} text-left leading-snug`} aria-pressed={o.text === c.title} disabled={busy || o.text === c.title}
            onClick={() => onPick({ title: o.text })} aria-label={`Use title: ${o.text} (score ${o.score})`}>
            <span className="num opacity-70">{crit(o.text)?.score ?? o.score}</span> {o.text}{!!crit(o.text)?.issues.length && <span className="opacity-60"> · {crit(o.text)!.issues.join(", ")}</span>}
          </button>
        ))}
        {cr?.rewrite && <button className={`${chip} text-left leading-snug`} aria-pressed={cr.rewrite === c.title} disabled={busy || cr.rewrite === c.title}
          onClick={() => onPick({ title: cr.rewrite })} aria-label={`Use the critics' rewrite: ${cr.rewrite}`}>🧐 {cr.rewrite}</button>}
        <button className={chip} onClick={onMore} disabled={moreBusy} aria-label={`Get more title options for ${c.title}`}>{moreBusy ? "Writing…" : "✨ More titles"}</button>
        {onReview && !cr && <button className={chip} onClick={onReview} disabled={moreBusy} aria-label={`Let the title critics review the options for ${c.title}`}>🧐 Review titles</button>}
      </div>
      {!!cr?.notes.length && <ul className="muted text-[10px] leading-snug" aria-label="Title critics' notes">{cr.notes.map((n) => <li key={n}>🧐 {n}</li>)}</ul>}
      {thumbs.length > 1 && (
        <div role="group" aria-label="Thumbnail options" className="flex gap-1">
          {thumbs.map((t, k) => (
            <button key={t} className={`aspect-[9/16] overflow-hidden rounded border-2 ${big ? "w-14" : "w-9"}`} style={{ borderColor: t === c.thumb ? "#ff8fab" : "transparent" }}
              aria-pressed={t === c.thumb} disabled={busy || t === c.thumb} onClick={() => onPick({ thumb: t })} aria-label={`Use thumbnail ${k + 1}`}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={media(t)} alt="" loading="lazy" className="h-full w-full object-cover" />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
