"use client";
// Section editor (Puck trial): the owner edits a built site's text in place. Each Puck component is one brief section drawn by the
// site's own renderer (section() in site-brief-pure.ts), so the editor shows exactly what exports. Puck brings the field panel and
// undo/redo; Publish turns the changes into copy edits for /api/sites/edit. Order, images and scripts stay the brief's.
import { useMemo, useState } from "react";
import { Puck, type Config } from "@puckeditor/core";
import "@puckeditor/core/puck.css";
import { SITE_CSS, section, type Brief } from "@/lib/site-brief-pure";
import { IMMERSIVE_CSS, SCENE_CSS, SEQUENCE_CSS, directionOf } from "@/lib/site-immersive-pure";
import { puckEdits, toPuck, withBase, type PuckData, type PuckProps } from "@/lib/site-puck-pure";

const text = (label: string) => ({ type: "text" as const, label });
const area = (label: string) => ({ type: "textarea" as const, label });
const FIELDS = {
  heading: text("Heading"),
  body: { type: "array" as const, label: "Paragraphs", arrayFields: { text: area("Text") }, getItemSummary: (p: { text?: string }) => p.text?.slice(0, 40) || "Paragraph" },
  items: { type: "array" as const, label: "Items", arrayFields: { label: text("Label"), title: text("Title"), body: area("Text") }, getItemSummary: (p: { title?: string }) => p.title || "Item" },
  cta: { type: "array" as const, label: "Buttons", arrayFields: { label: text("Label") }, getItemSummary: (p: { label?: string }) => p.label || "Button" },
};

export function SiteEditor({ ws, brief: initial, base }: { ws: string; brief: Brief; base: string }) {
  const [brief, setBrief] = useState(initial), [note, setNote] = useState(""), [key, setKey] = useState(0);
  const data = useMemo(() => toPuck(brief), [brief]);
  const config = useMemo(() => {
    const dir = directionOf(brief.style), css = SITE_CSS + (dir ? IMMERSIVE_CSS + SEQUENCE_CSS + SCENE_CSS : "");
    const render = (p: PuckProps) => {
      const x = brief.sections.find((s) => s.id === p.id);
      if (!x) return <></>;
      const html = section({ ...x, heading: p.heading, body: p.body.map((b) => b.text), items: p.items.map((it, i) => ({ ...x.items[i], ...it, label: it.label || undefined })), cta: p.cta.map((l, i) => ({ ...x.cta[i], label: l.label })) }, brief);
      return <div dangerouslySetInnerHTML={{ __html: withBase(html, base) }} />;
    };
    const components = Object.fromEntries([...new Set(brief.sections.map((s) => s.kind))].map((k) => [k, { label: k, fields: FIELDS, render, resolveFields: (d: { props: PuckProps }) => { // lists keep the brief's length: text edits only
      const x = brief.sections.find((s) => s.id === d.props.id), n = (f: keyof Omit<PuckProps, "id" | "heading">) => ({ ...FIELDS[f], min: x?.[f].length ?? 0, max: x?.[f].length ?? 0 });
      return { heading: FIELDS.heading, ...(x?.body.length ? { body: n("body") } : {}), ...(x?.items.length ? { items: n("items") } : {}), ...(x?.cta.length ? { cta: n("cta") } : {}) };
    } }]));
    return { components, root: { fields: {}, render: ({ children }: { children: React.ReactNode }) => <div className={dir ? `immersive dir-${dir}` : undefined}><style>{css}</style><main id="main">{children}</main></div> } } as unknown as Config;
  }, [brief, base]);

  const publish = async (d: PuckData) => {
    const r = puckEdits(brief, d);
    if ("error" in r) return setNote(r.error);
    if (!r.edits.length) return setNote("Nothing changed.");
    setNote("Saving…");
    const res = await fetch("/api/sites/edit", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ws, version: brief.version, edits: r.edits }) });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) return setNote((j.errors ?? [j.error ?? "Save failed"]).join("; "));
    setBrief(j.brief); setKey((k) => k + 1);
    setNote(`Saved as version ${j.brief.version}: ${j.changed.join(", ")}.`);
  };

  return (
    <div className="site-editor">
      <p role="status" aria-live="polite" className="px-3 py-1 text-sm">{note || `Editing ${brief.name}, version ${brief.version}. Click a section, change its text, then Publish.`}
        {" "}<a className="underline" href={`/api/workspace?ws=${encodeURIComponent(ws)}&zip=1`}>Download site (zip)</a></p>
      <Puck key={key} config={config} data={data as never} onPublish={(d) => void publish(d as unknown as PuckData)}
        permissions={{ drag: false, duplicate: false, delete: false, insert: false }}
        overrides={{ drawer: () => <p className="p-3 text-sm">Sections come from the site brief; edit their text here.</p> }}
        viewports={[{ width: 390, height: "auto", label: "Phone", icon: "Smartphone" }, { width: 1440, height: "auto", label: "Desktop", icon: "Monitor" }]} />
    </div>
  );
}
