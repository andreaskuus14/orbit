"use client";

import { useEffect, useId, useRef, useState } from "react";
import { vaultTextDiff } from "@/lib/vault-text-diff-pure";
import { useT } from "./i18n";

type Preview = { text: string; truncated: boolean };
type PreviewState = { name: string; preview?: Preview; failed?: boolean };
const labels = {
  en: {
    open: "Compare text files", close: "Close comparison", other: "Second file", choose: "Choose a text file",
    loading: "Loading preview…", failed: "Could not load this preview.", truncated: "Only the first 20 KB are shown.",
    changes: "Show changes", previews: "Show previews", same: "No differences in the displayed text.",
    tooLarge: "Too many lines to calculate changes here. Use the side-by-side previews.",
    added: "Added", removed: "Removed", more: "Only the first 400 changes are shown.",
  },
  et: {
    open: "Võrdle tekstifaile", close: "Sulge võrdlus", other: "Teine fail", choose: "Vali tekstifail",
    loading: "Eelvaade laadib…", failed: "Eelvaadet ei saanud laadida.", truncated: "Kuvatud on ainult esimesed 20 KB.",
    changes: "Näita muudatusi", previews: "Näita eelvaateid", same: "Kuvatud tekstis pole erinevusi.",
    tooLarge: "Muudatuste leidmiseks on liiga palju ridu. Kasuta kõrvuti eelvaateid.",
    added: "Lisatud", removed: "Eemaldatud", more: "Kuvatud on ainult esimesed 400 muudatust.",
  },
};

function usePreview(name: string) {
  const [state, setState] = useState<PreviewState | null>(null);
  useEffect(() => {
    setState(null);
    if (!name) return;
    const controller = new AbortController();
    fetch(`/api/vault?file=${encodeURIComponent(name)}&preview=1`, { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error("Preview unavailable");
        const data: Preview = await response.json();
        if (typeof data?.text !== "string" || typeof data.truncated !== "boolean") throw new Error("Invalid preview");
        if (!controller.signal.aborted) setState({ name, preview: data });
      })
      .catch(() => { if (!controller.signal.aborted) setState({ name, failed: true }); });
    return () => controller.abort();
  }, [name]);
  return state?.name === name ? state : null;
}

function TextPreview({ name, state }: { name: string; state: PreviewState | null }) {
  const { lang } = useT();
  const t = labels[lang];
  const title = useId();
  const preview = state?.preview;
  return <section className="min-w-0 space-y-1" aria-labelledby={title}>
    <h4 id={title} className="break-all font-semibold">{name}</h4>
    {state?.failed ? <p className="error" role="alert">{t.failed}</p> : preview ? <>
      <pre tabIndex={0} aria-labelledby={title} className="card max-h-[40dvh] overflow-auto whitespace-pre-wrap break-words text-xs">{preview.text}</pre>
      {preview.truncated && <p className="muted text-xs">{t.truncated}</p>}
    </> : <p className="muted" role="status">{t.loading}</p>}
  </section>;
}

function TextChanges({ left, right, first, second }: { left: string; right: string; first: Preview; second: Preview }) {
  const { lang } = useT();
  const t = labels[lang];
  const result = vaultTextDiff(first.text, second.text);
  return <div className="space-y-2">
    <p className="break-all text-sm">{left} → {right}</p>
    {(first.truncated || second.truncated) && <p className="muted text-xs">{t.truncated}</p>}
    {!result ? <p role="status">{t.tooLarge}</p> : !result.total ? <p role="status">{t.same}</p> : <>
      <ol tabIndex={0} className="card max-h-[45dvh] space-y-1 overflow-auto font-mono text-xs">
        {result.changes.map(({ kind, line, text }) => <li key={`${kind}-${line}`} className="whitespace-pre-wrap break-words">
          <span className={kind === "added" ? "text-emerald-300" : "text-rose-300"}>
            {kind === "added" ? "+" : "−"} {t[kind]} {line}
          </span>{`  ${text}`}
        </li>)}
      </ol>
      {result.total > result.changes.length && <p className="muted text-xs">{t.more}</p>}
    </>}
  </div>;
}

function Comparison({ name, selected }: { name: string; selected: string }) {
  const { lang } = useT();
  const t = labels[lang];
  const first = usePreview(name);
  const second = usePreview(selected);
  const [showChanges, setShowChanges] = useState(false);
  const ready = first?.preview && second?.preview;
  return <div className="space-y-3">
    {ready && <button type="button" className="chip" onClick={() => setShowChanges((show) => !show)}>
      {showChanges ? t.previews : t.changes}
    </button>}
    {showChanges && first?.preview && second?.preview
      ? <TextChanges left={name} right={selected} first={first.preview} second={second.preview} />
      : <div className="grid gap-3 sm:grid-cols-2">
          <TextPreview name={name} state={first} />
          {selected && <TextPreview name={selected} state={second} />}
        </div>}
  </div>;
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
      {open && <Comparison name={name} selected={selected} />}
    </dialog>
  </>;
}
