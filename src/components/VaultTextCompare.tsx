"use client";

import { useEffect, useId, useRef, useState } from "react";
import { vaultTextDiff } from "@/lib/vault-text-diff-pure";
import { useT } from "./i18n";
import { Button } from "./ui/Button";
import { IconClose } from "./ui/icons";
import "@/app/planet-ui.css";

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
  return <section className="pu-modal-body" style={{ minWidth: 0 }} aria-labelledby={title}>
    <h4 id={title} className="pu-pop-step" style={{ overflowWrap: "anywhere" }}>{name}</h4>
    {state?.failed ? <p className="pu-modal-status" data-bad="" role="alert">{t.failed}</p> : preview ? <>
      <pre tabIndex={0} aria-labelledby={title} className="pu-modal-pre">{preview.text}</pre>
      {preview.truncated && <p className="pu-modal-meta">{t.truncated}</p>}
    </> : <p className="pu-modal-meta" role="status">{t.loading}</p>}
  </section>;
}

function TextChanges({ left, right, first, second }: { left: string; right: string; first: Preview; second: Preview }) {
  const { lang } = useT();
  const t = labels[lang];
  const result = vaultTextDiff(first.text, second.text);
  return <div className="pu-modal-body">
    <p className="pu-modal-label" style={{ overflowWrap: "anywhere" }}>{left} → {right}</p>
    {(first.truncated || second.truncated) && <p className="pu-modal-meta">{t.truncated}</p>}
    {!result ? <p role="status">{t.tooLarge}</p> : !result.total ? <p role="status">{t.same}</p> : <>
      <ol tabIndex={0} className="pu-modal-pre pu-changes">
        {result.changes.map(({ kind, line, text }) => <li key={`${kind}-${line}`}>
          <span className={kind === "added" ? "pu-add" : "pu-del"}>
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
  return <div className="pu-modal-body" style={{ gap: 12 }}>
    {ready && <div className="pu-modal-actions"><Button size="sm" onClick={() => setShowChanges((show) => !show)}>
      {showChanges ? t.previews : t.changes}
    </Button></div>}
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
    <Button onClick={() => { dialog.current?.showModal(); setOpen(true); }}>{t.open}</Button>
    <dialog ref={dialog} aria-labelledby={title} className="pu pu-modal pu-wide" data-planet="vault" onClose={() => setOpen(false)}
      onClick={(e) => { if (e.target === e.currentTarget) e.currentTarget.close(); }}>
      <div className="pu-modal-head">
        <span className="pu-mark" aria-hidden="true" />
        <h3 id={title} className="pu-title">{t.open}</h3>
        <Button variant="ghost" icon={<IconClose />} label={t.close} onClick={() => dialog.current?.close()} />
      </div>
      <label className="pu-modal-actions" style={{ marginBottom: 12 }}><span className="pu-modal-label">{t.other}</span>
        <select className="pu-modal-select" value={selected} onChange={(e) => setOther(e.target.value)}>
          <option value="">{t.choose}</option>
          {others.map((file) => <option key={file}>{file}</option>)}
        </select>
      </label>
      {open && <Comparison name={name} selected={selected} />}
    </dialog>
  </>;
}
