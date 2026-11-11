"use client";

import { useEffect, useId, useRef, useState } from "react";
import { useT } from "./i18n";

type Preview = { text: string; truncated: boolean };
const labels = {
  en: { open: "Compare text files", close: "Close comparison", other: "Second file", choose: "Choose a text file", loading: "Loading preview…", failed: "Could not load this preview.", truncated: "Only the first 20 KB are shown." },
  et: { open: "Võrdle tekstifaile", close: "Sulge võrdlus", other: "Teine fail", choose: "Vali tekstifail", loading: "Eelvaade laadib…", failed: "Eelvaadet ei saanud laadida.", truncated: "Kuvatud on ainult esimesed 20 KB." },
};

function TextPreview({ name }: { name: string }) {
  const { lang } = useT();
  const t = labels[lang];
  const title = useId();
  const [preview, setPreview] = useState<Preview | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    fetch(`/api/vault?file=${encodeURIComponent(name)}&preview=1`, { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error("Preview unavailable");
        const data: Preview = await response.json();
        if (!controller.signal.aborted) setPreview(data);
      })
      .catch(() => { if (!controller.signal.aborted) setFailed(true); });
    return () => controller.abort();
  }, [name]);

  return <section className="min-w-0 space-y-1" aria-labelledby={title}>
    <h4 id={title} className="break-all font-semibold">{name}</h4>
    {failed ? <p className="error" role="alert">{t.failed}</p> : preview ? <>
      <pre tabIndex={0} aria-labelledby={title} className="card max-h-[40dvh] overflow-auto whitespace-pre-wrap break-words text-xs">{preview.text}</pre>
      {preview.truncated && <p className="muted text-xs">{t.truncated}</p>}
    </> : <p className="muted" role="status">{t.loading}</p>}
  </section>;
}

export function VaultTextCompare({ name, others }: { name: string; others: string[] }) {
  const { lang } = useT();
  const t = labels[lang];
  const dialog = useRef<HTMLDialogElement>(null);
  const title = useId();
  const [open, setOpen] = useState(false);
  const [other, setOther] = useState("");
  if (!others.length) return null;
  const selected = others.includes(other) ? other : "";
  return <>
    <button type="button" className="btn" onClick={() => { dialog.current?.showModal(); setOpen(true); }}>{t.open}</button>
    <dialog ref={dialog} aria-labelledby={title} className="m-auto max-h-[90dvh] w-[calc(100%-2rem)] max-w-5xl overflow-auto rounded border border-white/20 bg-[#0b1320] p-4 text-inherit backdrop:bg-black/70" onClose={() => setOpen(false)}>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h3 id={title} className="h3">{t.open}</h3>
        <button type="button" className="chip" onClick={() => dialog.current?.close()}>{t.close}</button>
      </div>
      <label className="mb-3 flex flex-wrap items-center gap-2">{t.other}
        <select className="field min-w-0 max-w-full" value={selected} onChange={(e) => setOther(e.target.value)}>
          <option value="">{t.choose}</option>
          {others.map((file) => <option key={file}>{file}</option>)}
        </select>
      </label>
      {open && <div className="grid gap-3 sm:grid-cols-2">
        <TextPreview key={name} name={name} />
        {selected && <TextPreview key={selected} name={selected} />}
      </div>}
    </dialog>
  </>;
}
