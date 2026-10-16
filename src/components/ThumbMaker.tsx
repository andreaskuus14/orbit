"use client";
import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { MAX_ZOOM, PRESETS, coverCrop, fontForWidth, imageFileError, panView, splitTitle, type View } from "@/lib/devtools-pure";

// DevWorld → Thumbnail & Icon Maker: everything happens in this browser on a <canvas>; the screenshot never leaves the device.
const PINK = "#f472b6";
type Style = { id: string; label: string; filter: string; vignette: number; glow: string; fill: string; stroke: string };
const STYLES: Style[] = [
  { id: "pop", label: "Pop", filter: "saturate(1.45) contrast(1.15)", vignette: 0.35, glow: "#ffffff", fill: "#ffe14d", stroke: "#1a1a1a" },
  { id: "neon", label: "Neon", filter: "saturate(1.3) contrast(1.2) hue-rotate(-12deg)", vignette: 0.55, glow: "#f472b6", fill: "#ffffff", stroke: "#7c1d6f" },
  { id: "horror", label: "Horror", filter: "saturate(0.35) contrast(1.35) brightness(0.8)", vignette: 0.8, glow: "#ff2a2a", fill: "#ff3b3b", stroke: "#000000" },
  { id: "sunny", label: "Sunny", filter: "saturate(1.25) brightness(1.1) sepia(0.15)", vignette: 0.2, glow: "#ffd166", fill: "#ffffff", stroke: "#e85d04" },
  { id: "ice", label: "Ice", filter: "saturate(0.9) brightness(1.08) hue-rotate(15deg)", vignette: 0.4, glow: "#7dd3fc", fill: "#e0f2fe", stroke: "#0c4a6e" },
  { id: "retro", label: "Retro", filter: "sepia(0.45) contrast(1.1) saturate(1.2)", vignette: 0.6, glow: "#fb923c", fill: "#fff7ed", stroke: "#7c2d12" },
];
const STICKERS = ["", "🔥", "⭐", "💰", "😱", "👑", "⚔️", "🆕", "🎁"];
const START: View = { zoom: 1, cx: 0.5, cy: 0.5 };

export default function ThumbMaker() {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [img, setImg] = useState<ImageBitmap | null>(null);
  const [preset, setPreset] = useState<(typeof PRESETS)[number]>(PRESETS[0]);
  const [view, setView] = useState<View>(START);
  const [title, setTitle] = useState("MY GAME");
  const [style, setStyle] = useState<Style>(STYLES[0]);
  const [sticker, setSticker] = useState("");
  const [err, setErr] = useState("");
  const [over, setOver] = useState(false);
  const drag = useRef<{ x: number; y: number } | null>(null);

  useEffect(() => () => img?.close(), [img]);

  useEffect(() => {
    const c = canvas.current, ctx = c?.getContext("2d");
    if (!c || !ctx) return;
    const W = preset.w, H = preset.h;
    c.width = W; c.height = H;
    ctx.filter = "none";
    if (img) {
      const r = coverCrop(img.width, img.height, W, H, view);
      ctx.filter = style.filter;
      ctx.drawImage(img, r.sx, r.sy, r.sw, r.sh, 0, 0, W, H);
      ctx.filter = "none";
    } else {
      const g = ctx.createLinearGradient(0, 0, W, H);
      g.addColorStop(0, "#1e1b4b"); g.addColorStop(1, "#831843");
      ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    }
    // vignette
    const vg = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.35, W / 2, H / 2, Math.hypot(W, H) / 2);
    vg.addColorStop(0, "rgba(0,0,0,0)"); vg.addColorStop(1, `rgba(0,0,0,${style.vignette})`);
    ctx.fillStyle = vg; ctx.fillRect(0, 0, W, H);
    // title
    const lines = splitTitle(title.toUpperCase());
    if (lines.length) {
      const font = (px: number) => `900 ${px}px Impact, "Arial Black", "Segoe UI Black", sans-serif`;
      ctx.font = font(100);
      const widest = Math.max(...lines.map((l) => ctx.measureText(l).width));
      const px = fontForWidth(widest, W * 0.9, H * 0.06, H * (lines.length > 1 ? 0.2 : 0.28));
      ctx.font = font(px);
      ctx.textAlign = "center"; ctx.textBaseline = "alphabetic"; ctx.lineJoin = "round";
      const lh = px * 1.02, bottom = H - H * 0.06;
      lines.forEach((l, i) => {
        const y = bottom - (lines.length - 1 - i) * lh;
        ctx.shadowColor = style.glow; ctx.shadowBlur = px * 0.35;
        ctx.lineWidth = px * 0.14; ctx.strokeStyle = style.stroke; ctx.strokeText(l, W / 2, y);
        ctx.shadowColor = "rgba(0,0,0,0.6)"; ctx.shadowBlur = 0; ctx.shadowOffsetY = px * 0.06;
        ctx.fillStyle = style.fill; ctx.fillText(l, W / 2, y);
        ctx.shadowOffsetY = 0;
      });
    }
    if (sticker) {
      const s = Math.min(W, H) * 0.24;
      ctx.font = `${s}px "Segoe UI Emoji", "Apple Color Emoji", "Noto Color Emoji", sans-serif`;
      ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.shadowColor = style.glow; ctx.shadowBlur = s * 0.3;
      ctx.fillText(sticker, W - s * 0.75, s * 0.75);
      ctx.shadowBlur = 0;
    }
  }, [img, preset, view, title, style, sticker]);

  async function load(file: File | undefined) {
    if (!file) return;
    const e = imageFileError(file.type, file.size);
    if (e) return setErr(e);
    let bmp: ImageBitmap;
    try { bmp = await createImageBitmap(file); } catch { return setErr("Couldn't read that image"); }
    if (bmp.width * bmp.height > 50e6) { bmp.close(); return setErr("Image is too large (over 50 megapixels)"); }
    setImg(bmp); setView(START); setErr("");
  }

  const toCanvas = (dx: number, dy: number) => {
    const r = canvas.current!.getBoundingClientRect();
    return [(dx * preset.w) / r.width, (dy * preset.h) / r.height] as const;
  };
  const pan = (dx: number, dy: number) => img && setView((v) => panView(v, dx, dy, img.width, img.height, preset.w, preset.h));
  const onDown = (e: PointerEvent<HTMLCanvasElement>) => { if (!img) return; drag.current = { x: e.clientX, y: e.clientY }; e.currentTarget.setPointerCapture(e.pointerId); };
  const onMove = (e: PointerEvent<HTMLCanvasElement>) => {
    if (!drag.current) return;
    const [dx, dy] = toCanvas(e.clientX - drag.current.x, e.clientY - drag.current.y);
    drag.current = { x: e.clientX, y: e.clientY };
    pan(dx, dy);
  };
  const onKey = (e: KeyboardEvent<HTMLCanvasElement>) => {
    const step = preset.w * 0.03, d: Record<string, [number, number]> = { ArrowLeft: [step, 0], ArrowRight: [-step, 0], ArrowUp: [0, step], ArrowDown: [0, -step] };
    if (d[e.key]) { e.preventDefault(); pan(...d[e.key]); }
  };

  function download() {
    canvas.current?.toBlob((b) => {
      if (!b) return setErr("Export failed");
      const url = URL.createObjectURL(b), a = document.createElement("a");
      a.href = url; a.download = `${(title.trim() || "thumbnail").replace(/[^\w-]+/g, "-").slice(0, 40)}-${preset.w}x${preset.h}.png`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    }, "image/png");
  }

  return (
    <section className="space-y-3" aria-labelledby="tm-title">
      <h2 id="tm-title" className="text-base font-semibold" style={{ color: PINK }}>🖼️ Thumbnail &amp; Icon Maker</h2>
      <div className="flex flex-wrap gap-1.5" role="group" aria-label="Size">
        {PRESETS.map((p) => <button key={p.id} className="chip" aria-pressed={preset.id === p.id} onClick={() => setPreset(p)}>{p.label} <span className="muted">{p.w}×{p.h}</span></button>)}
      </div>
      <label
        className="card block cursor-pointer text-center text-sm" style={over ? { borderColor: PINK } : undefined}
        onDragOver={(e) => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)}
        onDrop={(e) => { e.preventDefault(); setOver(false); void load(e.dataTransfer.files[0]); }}
      >
        <input type="file" accept="image/png,image/jpeg,image/webp" className="sr-only" onChange={(e) => { void load(e.target.files?.[0]); e.target.value = ""; }} />
        {img ? "Change screenshot" : "Drop a screenshot here or choose one"} <span className="muted">(PNG/JPG/WebP, max 15 MB)</span>
      </label>
      {err && <p className="error text-sm" role="alert">{err}</p>}
      <canvas
        ref={canvas} tabIndex={img ? 0 : -1} role="img" aria-label={`Preview, ${preset.w} by ${preset.h}. ${img ? "Drag or use arrow keys to move the picture." : ""}`}
        className="block w-full rounded-lg border border-white/10" style={{ cursor: img ? "grab" : "default", touchAction: "none" }}
        onPointerDown={onDown} onPointerMove={onMove} onPointerUp={() => (drag.current = null)} onPointerCancel={() => (drag.current = null)} onKeyDown={onKey}
      />
      <label className="flex items-center gap-2 text-xs">Zoom
        <input type="range" min={1} max={MAX_ZOOM} step={0.05} value={view.zoom} disabled={!img} className="flex-1" style={{ accentColor: PINK }}
          onChange={(e) => img && setView((v) => panView({ ...v, zoom: Number(e.target.value) }, 0, 0, img.width, img.height, preset.w, preset.h))} />
      </label>
      <label className="block text-xs">Title
        <input className="field mt-1 w-full" value={title} maxLength={40} onChange={(e) => setTitle(e.target.value)} />
      </label>
      <div className="flex flex-wrap gap-1.5" role="group" aria-label="Style">
        {STYLES.map((s) => <button key={s.id} className="chip" aria-pressed={style.id === s.id} onClick={() => setStyle(s)} style={style.id === s.id ? { borderColor: PINK, color: PINK } : undefined}>{s.label}</button>)}
      </div>
      <div className="flex flex-wrap gap-1.5" role="group" aria-label="Sticker">
        {STICKERS.map((s) => <button key={s || "none"} className="chip" aria-pressed={sticker === s} aria-label={s ? `Sticker ${s}` : "No sticker"} onClick={() => setSticker(s)}>{s || "None"}</button>)}
      </div>
      <button className="btn w-full" onClick={download}>⬇ Download PNG ({preset.w}×{preset.h})</button>
      <p className="muted text-xs">Roblox shows icons small and with rounded corners: keep the title short and away from the edges.</p>
    </section>
  );
}
