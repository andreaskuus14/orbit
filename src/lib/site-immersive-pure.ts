// "Immersive" site style (W02 / F3): the same brief, sections, form and QA as the classic page, dressed as a cinematic dark site:
// a live WebGL aurora behind the hero (one fragment shader, no libraries, works offline), glass navigation, large type that mixes a
// sans with an italic serif, glowing accent, cards with light edges, and sections that rise in as you scroll. Content stays plain
// HTML (readable without JS, editable as copy); motion stops for prefers-reduced-motion (one still frame) and when the tab is hidden.


/** Design directions: each a complete look (colour, type, effect, motion) over the same engine. The brief picks one with
 *  "style"; "immersive" means cinematic. Add one here and it gets the same QA. */
export type Direction = { label: string; bg: string; ink: string; muted: string; accent: string; onAccent: string; glass: string; edge: string; veil: string;
  cardHi: string; cardLo: string; field: string; glow1: string; glow2: string; effect: "aurora" | "sunlight" | "none"; shader?: [string, string, string]; extra: string };
export const DIRECTIONS: Record<"cinematic" | "daylight" | "editorial", Direction> = {
  cinematic: { label: "Cinematic night", bg: "#070b12", ink: "#eef1f5", muted: "#9aa3b2", accent: "#f2b35b", onAccent: "#1a1206", glass: "rgba(12,17,26,.62)", edge: "rgba(255,255,255,.09)",
    veil: "7,11,18", cardHi: "rgba(255,255,255,.05)", cardLo: "rgba(255,255,255,.015)", field: "rgba(255,255,255,.04)", glow1: "rgba(242,179,91,.3)", glow2: "rgba(242,179,91,.55)",
    effect: "aurora", shader: [".95,.68,.33", ".22,.42,.78", ".027,.043,.07"], extra: "" },
  daylight: { label: "Nordic daylight", bg: "#f4f5f3", ink: "#14201b", muted: "#4d5953", accent: "#1f5a44", onAccent: "#f4f5f3", glass: "rgba(244,245,243,.82)", edge: "rgba(20,32,27,.14)",
    veil: "244,245,243", cardHi: "#ffffff", cardLo: "#fbfbfa", field: "#ffffff", glow1: "rgba(31,90,68,.14)", glow2: "rgba(31,90,68,.24)",
    effect: "sunlight", shader: [".86,.92,.95", ".74,.86,.8", ".955,.96,.952"],
    extra: `body.immersive.dir-daylight h1, body.immersive.dir-daylight h2 { font-family: Bahnschrift, "DIN Alternate", "Arial Narrow", system-ui, sans-serif; font-weight: 600; letter-spacing: -.01em; }
body.immersive.dir-daylight h1 em, body.immersive.dir-daylight h2 em { font-family: inherit; font-style: normal; color: var(--accent); }
body.immersive.dir-daylight .btn { border-radius: 2px; box-shadow: none; } body.immersive.dir-daylight .stat { font-family: Bahnschrift, "DIN Alternate", "Arial Narrow", sans-serif; color: var(--accent); }
body.immersive.dir-daylight .features > li { border-radius: 2px; } body.immersive.dir-daylight .features > li::before { background: var(--accent); opacity: 1; }
body.immersive.dir-daylight .hero-media { box-shadow: 0 30px 80px -40px rgba(10,30,20,.45); transform: translateY(-50%); border-radius: 2px; }` },
  editorial: { label: "Bold editorial", bg: "#f4f3ef", ink: "#0f0f0f", muted: "#45443f", accent: "#ff4a1c", onAccent: "#0f0f0f", glass: "rgba(244,243,239,.92)", edge: "rgba(15,15,15,.9)",
    veil: "244,243,239", cardHi: "transparent", cardLo: "transparent", field: "#fff", glow1: "transparent", glow2: "transparent", effect: "none",
    extra: `body.immersive.dir-editorial h1 { font-size: clamp(2.6rem, 7.2vw, 6.8rem); text-transform: uppercase; letter-spacing: -.04em; line-height: .88; font-weight: 800; }
body.immersive.dir-editorial a:not(.btn) { color: var(--ink-i); text-decoration-color: var(--accent); text-decoration-thickness: 2px; }
body.immersive.dir-editorial h2 { text-transform: uppercase; letter-spacing: -.03em; font-weight: 800; }
body.immersive.dir-editorial .btn { border-radius: 0; box-shadow: 4px 4px 0 var(--ink-i); } body.immersive.dir-editorial .btn:hover { box-shadow: 6px 6px 0 var(--ink-i); }
body.immersive.dir-editorial .features > li, body.immersive.dir-editorial .lead { border: 2px solid var(--ink-i); border-radius: 0; }
body.immersive.dir-editorial .features > li::before { display: none; } body.immersive.dir-editorial .top .bar { border-radius: 0; border: 2px solid var(--ink-i); backdrop-filter: none; }
body.immersive.dir-editorial .hero { background: var(--accent); padding-top: 6rem; } body.immersive.dir-editorial .hero p:not(.eyebrow) { color: var(--ink-i); } body.immersive.dir-editorial .eyebrow { color: var(--ink-i); }
body.immersive.dir-editorial .hero .btn-quiet { background: var(--bg); } body.immersive.dir-editorial .hero::after { display: none; }
body.immersive.dir-editorial .hero-media { border-radius: 0; border: 2px solid var(--ink-i); box-shadow: 10px 10px 0 var(--ink-i); transform: translateY(-50%) rotate(2deg); }` },
};
export type DirectionId = keyof typeof DIRECTIONS;
export const directionOf = (style: string | undefined): DirectionId | null => (style === "immersive" ? "cinematic" : style && style in DIRECTIONS ? (style as DirectionId) : null);

export const IMMERSIVE_CSS = `/* Immersive style: tokens first (change these to rebrand). */
body.immersive { --serif: "Iowan Old Style", "Palatino Linotype", Palatino, Georgia, serif; background: var(--bg); color: var(--ink-i); }
${Object.entries(DIRECTIONS).map(([k, d]) => `body.immersive.dir-${k} { --bg: ${d.bg}; --ink-i: ${d.ink}; --muted-i: ${d.muted}; --accent: ${d.accent}; --on-accent: ${d.onAccent}; --glass: ${d.glass}; --edge: ${d.edge}; --veil: ${d.veil}; --card-hi: ${d.cardHi}; --card-lo: ${d.cardLo}; --field: ${d.field}; --glow-1: ${d.glow1}; --glow-2: ${d.glow2}; }`).join("\n")}
body.immersive { --muted: var(--muted-i); }
.immersive .sec, .immersive .foot { background: transparent; color: var(--ink-i); }
.immersive p, .immersive dd, .immersive .lead { color: var(--muted-i); }
.immersive h1, .immersive h2, .immersive h3 { color: var(--ink-i); letter-spacing: -.02em; }
.immersive h1 { font-size: clamp(2.6rem, 7vw, 6rem); line-height: .98; font-weight: 600; }
.immersive h2 { font-size: clamp(2rem, 4.5vw, 3.6rem); line-height: 1.02; font-weight: 600; }
.immersive h1 em, .immersive h2 em { font-family: var(--serif); font-style: italic; font-weight: 400; color: var(--ink-i); }
.immersive a { color: var(--accent); }
.immersive .skip { background: var(--accent); color: var(--on-accent); }

/* Glass pill navigation */
.immersive .top { position: fixed; inset: .9rem .9rem auto; background: none; border: 0; z-index: 20; }
.immersive .top .bar { background: var(--glass); backdrop-filter: blur(14px) saturate(140%); -webkit-backdrop-filter: blur(14px) saturate(140%);
  border: 1px solid var(--edge); border-radius: 999px; padding: .45rem .55rem .45rem 1rem; }
.immersive .top a:not(.btn) { color: var(--ink-i); }
.immersive .btn, .immersive .top .btn { color: var(--on-accent); }
.immersive .btn-quiet { color: var(--ink-i); }
.immersive .brand { color: var(--ink-i); }

/* Buttons: accent with a soft glow */
.immersive .btn { background: var(--accent); color: var(--on-accent); border: 0; border-radius: 999px; font-weight: 650;
  box-shadow: 0 0 0 1px var(--glow-1), 0 8px 30px -6px var(--glow-2); transition: transform .2s ease, box-shadow .2s ease; }
.immersive .btn:hover { transform: translateY(-1px); box-shadow: 0 0 0 1px var(--glow-2), 0 12px 40px -6px var(--glow-2); }
.immersive .btn-quiet { background: transparent; color: var(--ink-i); box-shadow: inset 0 0 0 1px var(--edge); }
.immersive :focus-visible { outline: 2px solid var(--accent); outline-offset: 3px; }

/* Hero: the aurora canvas fills it; copy sits on a dark left-to-right veil so text contrast holds over any frame */
.immersive .hero { position: relative; min-height: 100svh; display: grid; align-items: end; overflow: hidden; background: var(--bg); isolation: isolate; }
.immersive .hero::before { content: none; }
.immersive .aurora { position: absolute; inset: 0; width: 100%; height: 100%; z-index: -2; display: block; }
.immersive .hero::after { content: ""; position: absolute; inset: 0; z-index: -1;
  background: linear-gradient(90deg, rgba(var(--veil),.92) 0%, rgba(var(--veil),.7) 38%, rgba(var(--veil),.15) 70%), linear-gradient(0deg, var(--bg) 0%, transparent 30%); }
.immersive .hero-media { position: absolute; right: 5vw; top: 50%; left: auto; bottom: auto; height: auto; width: min(32vw, 440px); aspect-ratio: 4 / 5; z-index: 0;
  border-radius: 22px; overflow: hidden; border: 1px solid var(--edge); box-shadow: 0 40px 120px -30px var(--glow-1);
  transform: translateY(-50%) perspective(1200px) rotateY(-14deg) rotateX(4deg); }
.immersive .hero-media img { width: 100%; height: 100%; object-fit: cover; }
.immersive .hero-copy { position: relative; z-index: 1; padding: 0 0 12vh; max-width: 44rem; }
.immersive .eyebrow { color: var(--accent); font: 600 .78rem/1 ui-monospace, SFMono-Regular, Menlo, monospace; letter-spacing: .22em; text-transform: uppercase; }

/* Cards with lit edges */
.immersive .features { gap: 1rem; }
.immersive .features > li { background: linear-gradient(180deg, var(--card-hi), var(--card-lo)); border: 1px solid var(--edge);
  border-radius: 20px; padding: 1.6rem; position: relative; overflow: hidden; border-top: 1px solid var(--edge); }
.immersive .features > li::before { content: ""; position: absolute; inset: 0 0 auto; height: 1px; background: linear-gradient(90deg, transparent, var(--accent), transparent); opacity: .7; }
.immersive .stat { color: var(--accent); font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: clamp(2.4rem, 5vw, 3.6rem); }
.immersive .specs > div { border-color: var(--edge); }
.immersive .specs dt { color: var(--muted-i); font-family: ui-monospace, SFMono-Regular, Menlo, monospace; letter-spacing: .08em; text-transform: uppercase; font-size: .8rem; }
.immersive .specs dd { color: var(--ink-i); }
.immersive details { border-color: var(--edge); }
.immersive summary { color: var(--ink-i); }
.immersive .story-media img, .immersive .lead-img { border-radius: 22px; border: 1px solid var(--edge); }
.immersive .lead { background: linear-gradient(180deg, var(--card-hi), var(--card-lo)); border: 1px solid var(--edge); border-radius: 22px; }
.immersive input, .immersive textarea, .immersive select { background: var(--field); color: var(--ink-i); border: 1px solid var(--edge); border-radius: 12px; }
.immersive label, .immersive .field span { color: var(--ink-i); }
.immersive .err { color: #ff8a7a; }
.immersive .foot { border-top: 1px solid var(--edge); }

/* Scroll reveal: only once the script has marked the page (so without JS everything is simply visible) */
.immersive.js-reveal .sec:not(.hero) > .wrap { opacity: 0; transform: translateY(28px); transition: opacity .9s cubic-bezier(.2,.7,.2,1), transform .9s cubic-bezier(.2,.7,.2,1); }
.immersive.js-reveal .sec.in > .wrap { opacity: 1; transform: none; }
${Object.values(DIRECTIONS).map((d) => d.extra).join("\n")}
@media (prefers-reduced-motion: reduce) {
  .immersive.js-reveal .sec:not(.hero) > .wrap { opacity: 1; transform: none; transition: none; }
  .immersive .hero-media { transform: translateY(-50%); }
  .immersive .btn { transition: none; }
}
@media (max-width: 899px) {
  .immersive .hero-media { position: relative; right: auto; top: auto; width: 100%; aspect-ratio: 16 / 10; transform: none; margin-top: 6rem; }
  .immersive .hero { align-items: start; }
  .immersive .hero::after { background: linear-gradient(0deg, var(--bg) 8%, rgba(var(--veil),.78) 46%, rgba(var(--veil),.35) 100%); }
  .immersive .hero-copy { padding: 1.5rem 0 4rem; }
  .immersive .top .bar nav ul { display: none; }
}
`;

/** Aurora fragment shader: layered value noise drives flowing ribbons of accent light over near-black. */
export const AURORA_FRAG = `precision mediump float;
uniform vec2 r; uniform float t; uniform vec3 ca, cb, cg;
float h(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
float n(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(h(i),h(i+vec2(1,0)),f.x),mix(h(i+vec2(0,1)),h(i+1.),f.x),f.y);}
float fbm(vec2 p){float v=0.,a=.5;for(int k=0;k<5;k++){v+=a*n(p);p=p*2.02+vec2(1.7,9.2);a*=.5;}return v;}
void main(){
  vec2 uv=gl_FragCoord.xy/r; vec2 p=vec2(uv.x*r.x/r.y,uv.y);
  float w=fbm(p*1.6+vec2(t*.05,-t*.03));
  float band=uv.y-.55-.22*sin(p.x*1.3+t*.18+w*3.);
  float glow=exp(-pow(band*4.2,2.))*(.55+.45*fbm(p*3.+t*.1));
  float band2=uv.y-.32-.18*sin(p.x*.9-t*.12+w*2.4);
  float glow2=exp(-pow(band2*6.,2.))*.6;
  vec3 a=ca, b=cb, bg=cg;
  vec3 c=bg+a*glow*.85+b*glow2*.7+vec3(.05,.09,.08)*w;
  c+=vec3(1.)*pow(h(gl_FragCoord.xy+t),12.)*.06; // faint film grain
  gl_FragColor=vec4(c,1.);
}`;

/** js/immersive.js: the aurora (one quad, one shader, DPR-capped, paused when hidden, a single frame for reduced motion) and the
 *  scroll reveal. Fails quietly to the CSS background where WebGL isn't available. */
export const IMMERSIVE_JS = `(function () {
  var reduce = window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches;
  document.body.classList.add("js-reveal");
  var secs = document.querySelectorAll(".sec:not(.hero)");
  if (reduce || !("IntersectionObserver" in window)) secs.forEach(function (s) { s.classList.add("in"); });
  else { var io = new IntersectionObserver(function (es) { es.forEach(function (e) { if (e.isIntersecting) { e.target.classList.add("in"); io.unobserve(e.target); } }); }, { rootMargin: "0px 0px -12% 0px" }); secs.forEach(function (s) { io.observe(s); }); }

  var cv = document.querySelector("canvas.aurora"); if (!cv) return;
  var gl = cv.getContext("webgl", { antialias: false, premultipliedAlpha: false }); if (!gl) return;
  var vs = "attribute vec2 a;void main(){gl_Position=vec4(a,0.,1.);}", fs = ${JSON.stringify(AURORA_FRAG)};
  function sh(type, src) { var s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); return gl.getShaderParameter(s, gl.COMPILE_STATUS) ? s : null; }
  var v = sh(gl.VERTEX_SHADER, vs), f = sh(gl.FRAGMENT_SHADER, fs); if (!v || !f) return;
  var pr = gl.createProgram(); gl.attachShader(pr, v); gl.attachShader(pr, f); gl.linkProgram(pr); if (!gl.getProgramParameter(pr, gl.LINK_STATUS)) return;
  gl.useProgram(pr);
  var buf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buf); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1,1,-1,-1,1,1,1]), gl.STATIC_DRAW);
  var loc = gl.getAttribLocation(pr, "a"); gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
  var ur = gl.getUniformLocation(pr, "r"), ut = gl.getUniformLocation(pr, "t");
  // the direction's colours come from the canvas (data-a/-b/-g = "r,g,b" 0-1), so one shader serves every look
  ["a", "b", "g"].forEach(function (k) { var c = (cv.dataset[k] || "0,0,0").split(",").map(Number); gl.uniform3f(gl.getUniformLocation(pr, "c" + k), c[0], c[1], c[2]); });
  function size() { var d = Math.min(window.devicePixelRatio || 1, 1.5), w = cv.clientWidth * d | 0, h = cv.clientHeight * d | 0; if (cv.width !== w || cv.height !== h) { cv.width = w; cv.height = h; gl.viewport(0, 0, w, h); } }
  var t0 = performance.now(), raf = 0;
  function frame(now) { size(); gl.uniform2f(ur, cv.width, cv.height); gl.uniform1f(ut, reduce ? 12.0 : (now - t0) / 1000); gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4); if (!reduce) raf = requestAnimationFrame(frame); }
  document.addEventListener("visibilitychange", function () { if (reduce) return; cancelAnimationFrame(raf); if (!document.hidden) raf = requestAnimationFrame(frame); });
  window.addEventListener("resize", function () { if (reduce) frame(performance.now()); });
  raf = requestAnimationFrame(frame);
})();
`;

/** Headline accent: the last word (or a word wrapped in *stars* in the brief) set in the italic serif, like "Steady light *forever*." */
export function accentHeading(escaped: string): string {
  if (/\*[^*]+\*/.test(escaped)) return escaped.replace(/\*([^*]+)\*/, "<em>$1</em>");
  const m = /^(.*\s)(\S+?)([.!?]?)$/.exec(escaped);
  return m ? `${m[1]}<em>${m[2]}</em>${m[3]}` : escaped;
}

// ---- Scroll-scrubbed sequence ("sequence" section): a tall section whose stage sticks to the screen while scrolling plays the
// frames (a Blender fly-through from ARCH, say) on a canvas; chapters (the section's items) fade in at their share of the scroll.
// Without JS or with reduced motion it is a plain image of the first frame plus three key frames, and the chapters as text.
type SeqSection = { id: string; heading: string; body: string[]; items: { title: string; body: string; label?: string }[]; seq?: { path: string; count: number; width: number; height: number; alt: string } };
export const framePath = (pattern: string, i: number) => pattern.replace("%03d", String(i).padStart(3, "0"));
/** Key frames for the still fallback: start, middle, end (1-based). */
export const keyFrames = (count: number) => [1, Math.ceil(count / 2), count];
export function sequenceSection(x: SeqSection, attrs: string, esc: (t: string) => string): string {
  const q = x.seq!, keys = keyFrames(q.count);
  const stills = keys.map((k, i) => `<img class="seq-still" src="${esc(framePath(q.path, k))}" alt="${i ? "" : esc(q.alt)}" width="${q.width}" height="${q.height}" decoding="async">`).join(""); // not lazy: 3 small files, and the fallback must be ready
  const chapters = x.items.map((it, i) => `<li class="seq-ch" data-at="${((i + 0.5) / Math.max(1, x.items.length)).toFixed(3)}">${it.label ? `<span class="eyebrow">${esc(it.label)}</span>` : ""}<h3>${esc(it.title)}</h3><p>${esc(it.body)}</p></li>`).join("");
  return `<section ${attrs} style="--seq-len:${Math.min(8, 2 + q.count / 16).toFixed(2)}"><div class="seq-stage">`
    + `<canvas class="seq-canvas" role="img" aria-label="${esc(q.alt)}" data-path="${esc(q.path)}" data-count="${q.count}" width="${q.width}" height="${q.height}"></canvas>`
    + `<div class="seq-stills">${stills}</div><div class="wrap seq-copy"><h2 id="${x.id}-title">${esc(x.heading)}</h2>${x.body.map((p) => `<p>${esc(p)}</p>`).join("")}</div>`
    + `<ol class="seq-chapters">${chapters}</ol><div class="seq-bar" aria-hidden="true"><span></span></div></div></section>`;
}

export const SEQUENCE_CSS = `
/* Scroll-scrubbed sequence */
.immersive .sec-sequence { position: relative; height: calc(var(--seq-len, 4) * 100svh); padding: 0; }
.immersive .sec-sequence > .seq-stage { position: sticky; top: 0; height: 100svh; overflow: hidden; }
.immersive .seq-canvas { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; display: none; }
.immersive .seq-stills { display: grid; grid-template-columns: repeat(3, 1fr); gap: 2px; height: 100%; }
.immersive .seq-stills img { width: 100%; height: 100%; object-fit: cover; }
.immersive .seq-copy { position: absolute; inset: 0 0 auto; padding-top: 6.5rem; z-index: 2; pointer-events: none; }
.immersive .seq-copy h2 { text-shadow: 0 2px 30px rgba(0,0,0,.6); max-width: 18ch; }
.immersive .seq-copy p { color: var(--ink-i); text-shadow: 0 1px 12px rgba(0,0,0,.7); max-width: 40ch; }
.immersive .seq-chapters { position: absolute; right: 5vw; bottom: 10vh; width: min(380px, 86vw); z-index: 2; margin: 0; padding: 0; list-style: none; }
.immersive .seq-ch { position: absolute; inset: auto 0 0; padding: 1.2rem 1.4rem; border-radius: 18px; background: var(--glass);
  backdrop-filter: blur(12px); -webkit-backdrop-filter: blur(12px); border: 1px solid var(--edge); }
.immersive .seq-ch p { margin: .3rem 0 0; }
.immersive .seq-stage::after { content: ""; position: absolute; inset: 0; z-index: 1; pointer-events: none;
  background: linear-gradient(180deg, rgba(var(--veil),.7) 0%, transparent 32%, transparent 62%, rgba(var(--veil),.75) 100%); }
.immersive .seq-bar { position: absolute; left: 5vw; right: 5vw; bottom: 3vh; height: 2px; background: var(--edge); z-index: 2; }
.immersive .seq-bar span { display: block; height: 100%; width: calc(var(--p, 0) * 100%); background: var(--accent); box-shadow: 0 0 12px var(--accent); }
/* live mode (JS on, motion allowed): canvas instead of stills, one chapter at a time */
.immersive.seq-live .seq-canvas { display: block; }
.immersive.seq-live .seq-stills { display: none; }
.immersive.seq-live .seq-ch { opacity: 0; transform: translateY(14px); transition: opacity .5s ease, transform .5s ease; }
.immersive.seq-live .seq-ch.on { opacity: 1; transform: none; }
/* stills mode: the section is just one screen tall and the chapters stack as cards */
.immersive:not(.seq-live) .sec-sequence { height: auto; }
.immersive:not(.seq-live) .sec-sequence > .seq-stage { position: relative; height: auto; }
.immersive:not(.seq-live) .seq-stills { height: 60vh; }
.immersive:not(.seq-live) .seq-chapters { position: static; width: auto; display: grid; gap: .75rem; padding: 1.5rem 5vw 3rem; }
.immersive:not(.seq-live) .seq-ch { position: static; }
.immersive:not(.seq-live) .seq-bar { display: none; }
@media (max-width: 899px) { .immersive.seq-live .seq-chapters { left: 5vw; right: 5vw; width: auto; } }
`;

export const SEQUENCE_JS = `(function () {
  var reduce = window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches;
  var secs = document.querySelectorAll(".sec-sequence"); if (!secs.length || reduce) return;
  document.body.classList.add("seq-live");
  secs.forEach(function (sec) {
    var cv = sec.querySelector(".seq-canvas"), cx = cv.getContext("2d"), n = +cv.dataset.count, pat = cv.dataset.path;
    var imgs = new Array(n), shown = -1, chs = sec.querySelectorAll(".seq-ch");
    function src(i) { var s = String(i + 1); return pat.replace("%03d", ("000" + s).slice(-3)); }
    function load(i) { if (imgs[i]) return imgs[i]; var im = new Image(); im.decoding = "async"; im.src = src(i); im.onload = function () { if (i === want) draw(i); }; return (imgs[i] = im); }
    // load every 4th frame first (scrubbing works right away), then fill in
    for (var i = 0; i < n; i += 4) load(i); setTimeout(function () { for (var j = 0; j < n; j++) load(j); }, 600);
    var want = 0;
    function near(i) { for (var d = 0; d < n; d++) { var a = imgs[i - d], b = imgs[i + d]; if (a && a.complete && a.naturalWidth) return i - d; if (b && b.complete && b.naturalWidth) return i + d; } return -1; }
    function size() { var d = Math.min(devicePixelRatio || 1, 2), w = cv.clientWidth * d | 0, h = cv.clientHeight * d | 0; if (cv.width !== w || cv.height !== h) { cv.width = w; cv.height = h; shown = -1; } }
    function draw(i) {
      var k = near(i); if (k < 0 || k === shown) return; var im = imgs[k]; size();
      var s = Math.max(cv.width / im.naturalWidth, cv.height / im.naturalHeight), w = im.naturalWidth * s, h = im.naturalHeight * s;
      cx.drawImage(im, (cv.width - w) / 2, (cv.height - h) / 2, w, h); shown = k;
    }
    var ticking = false;
    function update() {
      ticking = false; var r = sec.getBoundingClientRect(), span = r.height - innerHeight, p = span > 0 ? Math.min(1, Math.max(0, -r.top / span)) : 0;
      want = Math.min(n - 1, Math.round(p * (n - 1))); load(want); draw(want); sec.style.setProperty("--p", p.toFixed(4));
      var on = Math.min(chs.length - 1, Math.floor(p * chs.length)); chs.forEach(function (c, j) { c.classList.toggle("on", j === on); });
    }
    addEventListener("scroll", function () { if (!ticking) { ticking = true; requestAnimationFrame(update); } }, { passive: true });
    addEventListener("resize", function () { shown = -1; update(); });
    update();
  });
})();
`;
