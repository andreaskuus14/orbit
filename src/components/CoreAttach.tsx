"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { MAX_FILES, MAX_IMAGE_BYTES, MAX_DOC_BYTES } from "@/lib/attach-pure";

// CORE attachments in the browser: pick / drop / paste, downscale images, show chips. The server re-checks everything.
export type Pending = { id: string; name: string; data: string; image: boolean; preview?: string; file: File };

const IMAGE = /^image\/(png|jpeg|webp|gif)$/;
const DOC = /\.(pdf|docx|txt|md|markdown|csv)$/i;
const EDGE = 1568; // the model's useful long-edge resolution; bigger only costs upload time
export const ACCEPT = "image/png,image/jpeg,image/webp,image/gif,.pdf,.docx,.txt,.md,.markdown,.csv";

const base64 = (b: Blob) => new Promise<string>((ok, fail) => {
  const r = new FileReader();
  r.onload = () => ok(String(r.result).split(",")[1] ?? "");
  r.onerror = () => fail(r.error);
  r.readAsDataURL(b);
});

/** Shrink an image to EDGE px on its long side (GIFs become a still PNG when shrunk). Small images pass through untouched. */
async function downscale(f: File): Promise<File> {
  const bmp = await createImageBitmap(f);
  const k = EDGE / Math.max(bmp.width, bmp.height);
  if (k >= 1) { bmp.close(); return f; }
  const c = document.createElement("canvas");
  c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
  c.getContext("2d")!.drawImage(bmp, 0, 0, c.width, c.height);
  bmp.close();
  const type = f.type === "image/gif" ? "image/png" : f.type;
  const blob = await new Promise<Blob | null>((ok) => c.toBlob(ok, type, 0.9));
  if (!blob) throw new Error("couldn't resize");
  return new File([blob], type === f.type ? f.name : f.name.replace(/\.gif$/i, ".png"), { type });
}

async function load(f: File): Promise<Pending> {
  const image = IMAGE.test(f.type);
  if (!image && !DOC.test(f.name)) throw new Error(`${f.name}: unsupported. Images (PNG, JPEG, WebP, GIF) or PDF, Word, text, CSV`);
  if (!image && f.size > MAX_DOC_BYTES) throw new Error(`${f.name}: documents can be at most 10 MB`);
  const file = image ? await downscale(f) : f;
  if (image && file.size > MAX_IMAGE_BYTES) throw new Error(`${f.name}: images can be at most 5 MB`);
  return { id: crypto.randomUUID(), name: file.name || "pasted.png", data: await base64(file), image, preview: image ? URL.createObjectURL(file) : undefined, file };
}

/** Attachment state for one composer. `take()` hands the files to a send and clears the composer. */
export function useAttachments() {
  const [items, setItems] = useState<Pending[]>([]);
  const [error, setError] = useState("");
  const ref = useRef<Pending[]>([]);
  const set = (next: Pending[]) => { ref.current = next; setItems(next); };
  useEffect(() => () => ref.current.forEach((p) => p.preview && URL.revokeObjectURL(p.preview)), []);

  const add = useCallback(async (files: FileList | File[]) => {
    setError("");
    const list = [...files];
    if (!list.length) return;
    if (ref.current.length + list.length > MAX_FILES) { setError(`At most ${MAX_FILES} files per message`); return; }
    for (const f of list) {
      try { const p = await load(f); if (ref.current.length < MAX_FILES) set([...ref.current, p]); }
      catch (e) { setError(e instanceof Error ? e.message : "Couldn't read that file"); }
    }
  }, []);
  const remove = useCallback((id: string) => {
    const p = ref.current.find((x) => x.id === id);
    if (p?.preview) URL.revokeObjectURL(p.preview);
    set(ref.current.filter((x) => x.id !== id));
  }, []);
  const take = useCallback(() => { const out = ref.current; set([]); setError(""); return out; }, []);
  const has = useCallback(() => ref.current.length > 0, []);
  return { items, error, add, remove, take, has };
}

/** Thumbnails / file chips with ✕, and "Save to memory" for documents (the normal MEMORY upload). */
export function AttachChips({ items, error, onRemove }: { items: Pending[]; error: string; onRemove: (id: string) => void }) {
  const [saved, setSaved] = useState<Record<string, string>>({});
  async function save(p: Pending) {
    setSaved((s) => ({ ...s, [p.id]: "Saving…" }));
    const form = new FormData();
    form.append("file", p.file);
    const res = await fetch("/api/memories/upload", { method: "POST", body: form }).catch(() => null);
    const json = await res?.json().catch(() => ({}));
    setSaved((s) => ({ ...s, [p.id]: res?.ok ? "✓ Saved" : json?.error || "Save failed" }));
  }
  if (!items.length && !error) return null;
  return (
    <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
      {items.map((p) => (
        <span key={p.id} className="chip inline-flex items-center gap-1.5">
          {p.preview ? <img src={p.preview} alt={p.name} className="h-8 w-8 rounded object-cover" /> : <span aria-hidden>📄</span>}
          <span className="max-w-[10rem] truncate" title={p.name}>{p.name}</span>
          {!p.image && (saved[p.id]
            ? <span className="muted" role="status">{saved[p.id]}</span>
            : <button type="button" className="underline" onClick={() => void save(p)} title="Also save this document to MEMORY">Save to memory</button>)}
          <button type="button" aria-label={`Remove ${p.name}`} onClick={() => onRemove(p.id)}>✕</button>
        </span>
      ))}
      {error && <span className="text-red-400" role="alert">{error}</span>}
    </div>
  );
}
