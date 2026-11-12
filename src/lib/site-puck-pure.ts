// Puck trial: the saved site brief as Puck editor data, and Puck's edited data back as copy edits for editCopy(). Puck only edits
// text here; the brief stays the source of truth, so images, IDs, order and the scroll scripts can't change through the editor.
import type { Brief, CopyEdit } from "./site-brief-pure.ts";

export type PuckProps = { id: string; heading: string; body: { text: string }[]; items: { label: string; title: string; body: string }[]; cta: { label: string }[] };
export type PuckData = { root: { props: Record<string, never> }; content: { type: string; props: PuckProps }[] };

export function toPuck(b: Brief): PuckData {
  return { root: { props: {} }, content: b.sections.map((x) => ({ type: x.kind, props: { id: x.id, heading: x.heading, body: x.body.map((text) => ({ text })),
    items: x.items.map((it) => ({ label: it.label ?? "", title: it.title, body: it.body })), cta: x.cta.map((l) => ({ label: l.label })) } })) };
}

/** Edited Puck data → the copy edits that turn `b` into it, or why it can't be saved (structure changes are not copy). */
export function puckEdits(b: Brief, d: PuckData): { edits: CopyEdit[] } | { error: string } {
  if (d.content.length !== b.sections.length || d.content.some((c, i) => c.props.id !== b.sections[i].id)) return { error: "sections can't be added, removed or moved here; only their text" };
  const edits: CopyEdit[] = [];
  for (const [i, c] of d.content.entries()) {
    const x = b.sections[i], p = c.props, add = (field: string, was: string, now: string) => { if (now !== was) edits.push({ section: x.id, field, value: now }); };
    if (p.body.length !== x.body.length || p.items.length !== x.items.length || p.cta.length !== x.cta.length) return { error: `${x.id}: paragraphs, items and buttons can be edited but not added or removed here` };
    add("heading", x.heading, p.heading);
    p.body.forEach((t, k) => add(`body.${k}`, x.body[k], t.text));
    p.items.forEach((it, k) => { add(`items.${k}.title`, x.items[k].title, it.title); add(`items.${k}.body`, x.items[k].body, it.body); if (it.label !== (x.items[k].label ?? "")) add(`items.${k}.label`, x.items[k].label ?? "", it.label); });
    p.cta.forEach((l, k) => add(`cta.${k}.label`, x.cta[k].label, l.label));
  }
  return { edits };
}

/** Section HTML shown inside the editor: relative image and frame paths load from the workspace's signed preview link. */
export const withBase = (html: string, base: string) => html.replace(/\s(src|data-src|data-path|poster)="(?![a-z]+:|\/|#)/gi, (m, a) => ` ${a}="${base}`);
