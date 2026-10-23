// Particle type for the journey's planet name: fine pearl particles stream out of the planet, settle into the
// letterforms, then hand over to the real DOM text; on leaving, they disperse. One aria-hidden 2D overlay canvas
// that exists only while something is moving; all particle state lives in preallocated typed arrays (decode-pure).
import { newPool, primeAssemble, primeDisperse, samplePoints, stepAssemble, stepDisperse, type Pool } from "@/lib/decode-pure";

const MAX = 3200, STEP = 2, CROSSFADE = 0.2, GIVE_UP = 0.42; // s: hand over to the (already decoding) DOM name by then
const PEARL = "#e8eefb";

type Origin = () => { x: number; y: number } | null;

/** Layout box of `el` in client px, ignoring CSS transforms (the card is still rising when we measure). */
function layoutBox(el: HTMLElement) {
  let x = 0, y = 0;
  for (let n: HTMLElement | null = el; n; n = n.offsetParent as HTMLElement | null) { x += n.offsetLeft + n.clientLeft; y += n.offsetTop + n.clientTop; }
  return { x: x - scrollX, y: y - scrollY, w: el.offsetWidth, h: el.offsetHeight };
}

export class ParticleType {
  private inc: Pool = newPool(MAX);
  private out: Pool = newPool(MAX);
  private pts = new Float32Array(MAX * 2);
  private canvas: HTMLCanvasElement | null = null;
  private ctx: CanvasRenderingContext2D | null = null;
  private mask: HTMLCanvasElement | null = null;
  private raf = 0; private last = 0; private dpr = 1;
  private inT = -1; private outT = -1; private fadeT = -1; // s since each phase began; -1 = not running
  private ox = 0; private oy = 0; private cx = 0; private cy = 0;
  private onSettle: (() => void) | null = null;

  constructor(private origin: Origin) {}

  /** Starts assembling `text` (one line, laid out in `el`). False when it can't (no canvas, empty): show the text another way. */
  arrive(el: HTMLElement | null, text: string, onSettle: () => void): boolean {
    if (!el || matchMedia("(prefers-reduced-motion: reduce)").matches) return false;
    const cs = getComputedStyle(el), box = layoutBox(el);
    const mask = (this.mask ??= document.createElement("canvas")), m = mask.getContext("2d", { willReadFrequently: true });
    if (!m || !text.trim() || !(box.w > 0) || !(box.h > 0)) return false;
    const w = Math.ceil(box.w) + 8, h = Math.ceil(box.h) + 8;
    mask.width = w; mask.height = h; // resizing also clears it
    m.font = `${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
    if ("letterSpacing" in m) (m as { letterSpacing: string }).letterSpacing = cs.letterSpacing;
    m.textBaseline = "alphabetic"; m.fillStyle = "#fff";
    const asc = m.measureText(text).fontBoundingBoxAscent || parseFloat(cs.fontSize) * 0.8;
    m.fillText(text, 0, asc); // an inline box's top is its content-area top: the baseline sits one ascent below
    const n = samplePoints(m.getImageData(0, 0, w, h).data, w, h, STEP, MAX, this.pts);
    if (!n) return false;

    this.leave(); // whatever was there disperses first
    const p = this.inc, o = this.origin();
    this.ox = o?.x ?? box.x + box.w + 160; this.oy = o?.y ?? box.y; // until the planet is projected: just right of the word
    p.n = n;
    for (let i = 0; i < n; i++) { p.tx[i] = box.x + this.pts[i * 2]; p.ty[i] = box.y + this.pts[i * 2 + 1]; }
    primeAssemble(p, box.x, box.w, this.ox, this.oy);
    this.cx = box.x + box.w / 2; this.cy = box.y + box.h / 2;
    this.inT = 0; this.fadeT = -1; this.onSettle = onSettle;
    return this.run();
  }

  /** The current word (mid-flight or settled) disperses out. */
  leave() {
    if (!this.inc.n) return;
    const done = this.inc; this.inc = this.out; this.out = done; this.inc.n = 0; // swap: no allocation
    if (this.inT < 0) for (let i = 0; i < done.n; i++) { done.x[i] = done.tx[i]; done.y[i] = done.ty[i]; done.a[i] = 1; } // settled: from the letterforms
    primeDisperse(done, this.cx, this.cy);
    this.inT = -1; this.fadeT = -1; this.onSettle = null; this.outT = 0;
    this.run();
  }

  dispose() {
    cancelAnimationFrame(this.raf); this.raf = 0;
    this.canvas?.remove(); this.canvas = null; this.ctx = null;
    this.inc.n = 0; this.out.n = 0; this.inT = this.outT = -1; this.onSettle = null;
  }

  private run(): boolean {
    if (!this.canvas) {
      const c = document.createElement("canvas");
      c.className = "particle-type"; c.setAttribute("aria-hidden", "true");
      this.dpr = Math.min(2, devicePixelRatio || 1);
      // shortcut: sized once per run (runs last ~1.5 s); a resize mid-run stretches it until the next one
      c.width = Math.round(innerWidth * this.dpr); c.height = Math.round(innerHeight * this.dpr);
      this.ctx = c.getContext("2d");
      if (!this.ctx) return false;
      document.body.appendChild(c);
      this.canvas = c;
    }
    if (!this.raf) { this.last = performance.now(); this.raf = requestAnimationFrame(this.frame); }
    return true;
  }

  private frame = (now: number) => {
    const ctx = this.ctx, c = this.canvas;
    if (!ctx || !c) { this.raf = 0; return; }
    const dt = Math.min(0.05, Math.max(0, (now - this.last) / 1000)); this.last = now;
    ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, c.width, c.height);
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.globalCompositeOperation = "lighter"; ctx.fillStyle = PEARL;
    if (this.inT >= 0) {
      this.inT += dt;
      const o = this.origin();
      if (o) { this.ox = Math.min(innerWidth + 40, Math.max(-40, o.x)); this.oy = Math.min(innerHeight + 40, Math.max(-40, o.y)); }
      const far = stepAssemble(this.inc, this.inT, dt, this.ox, this.oy);
      if (this.fadeT < 0 && (far <= this.inc.n * 0.03 || this.inT > GIVE_UP)) { this.fadeT = 0; this.onSettle?.(); } // DOM text fades in now
      let k = 1;
      if (this.fadeT >= 0) { this.fadeT += dt; k = Math.max(0, 1 - this.fadeT / CROSSFADE); }
      this.draw(this.inc, k);
      if (k === 0) this.inT = -1; // handed over; the pool keeps its targets for the dispersal
    }
    if (this.outT >= 0) {
      this.outT += dt;
      if (stepDisperse(this.out, this.outT, dt) > 0) this.draw(this.out, 1); else { this.outT = -1; this.out.n = 0; }
    }
    if (this.inT >= 0 || this.outT >= 0) this.raf = requestAnimationFrame(this.frame);
    else { this.raf = 0; c.remove(); this.canvas = null; this.ctx = null; } // idle: no canvas at all
  };

  private draw(p: Pool, k: number) {
    const ctx = this.ctx!;
    for (let i = 0; i < p.n; i++) {
      const a = p.a[i] * k;
      if (a < 0.01) continue;
      const s = i % 5 === 0 ? 1.7 : 1.1; // mostly fine grains, a few brighter
      ctx.globalAlpha = a;
      ctx.fillRect(p.x[i] - s / 2, p.y[i] - s / 2, s, s);
    }
    ctx.globalAlpha = 1;
  }
}
