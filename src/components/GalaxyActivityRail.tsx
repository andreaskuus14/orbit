"use client";

import { useT } from "./i18n";
import styles from "./GalaxyActivityRail.module.css";

type Entry = { title: string; open: () => void };
type Slot = { entry: Entry | null; state: "loading" | "fresh" | "stale" | "unavailable" };

const copy = {
  en: { title: "Galaxy activity", focus: "Focus", labels: ["Running", "Needs you", "Latest result"], empty: ["No running tasks", "Nothing waiting", "No finished tasks"], more: "Open Needs you", stale: "Last loaded", unavailable: "Unavailable" },
  et: { title: "Galaktika tegevus", focus: "Fookus", labels: ["Töös", "Vajab sind", "Viimane tulemus"], empty: ["Töös ülesandeid pole", "Midagi ei oota", "Lõpetatud ülesandeid pole"], more: "Ava „Vajab sind“", stale: "Viimati laaditud", unavailable: "Pole saadaval" },
};

export function GalaxyActivityRail({ slots, inline, onMore, moreRef }: {
  slots: readonly [Slot, Slot, Slot]; inline: boolean; onMore: () => void; moreRef?: (button: HTMLButtonElement | null) => void;
}) {
  const { lang, t } = useT();
  const words = copy[lang];
  const title = inline ? words.focus : words.title;
  return (
    <section aria-label={title} className={inline ? styles.inline : styles.rail}>
      <header className={styles.heading}>
        <h2>{title}</h2>
        <button type="button" className="link needs-you-chip" ref={moreRef} aria-expanded={false} onClick={onMore}>{words.more}</button>
      </header>
      <ul className={styles.list}>
        {slots.map(({ entry, state }, i) => {
          const label = words.labels[i];
          const status = state === "stale" ? words.stale : null;
          const body = entry?.title ?? (state === "loading" ? t("common.loading") : state !== "fresh" ? words.unavailable : words.empty[i]);
          return <li key={label} className={styles.slot} data-lane={i}>
            <span className={styles.label}>{label}{status && <small> · {status}</small>}</span>
            {entry ? <button type="button" className={styles.entry} onClick={entry.open} aria-label={`${label}: ${body}${status ? ` (${status})` : ""}`} title={body}>
              <span>{body}</span><span aria-hidden="true">↗</span>
            </button> : <span className={styles.empty}>{body}</span>}
          </li>;
        })}
      </ul>
    </section>
  );
}
