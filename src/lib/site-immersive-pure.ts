// "Immersive" site style (W02 / F3): the same brief, sections, form and QA as the classic page, dressed as a cinematic dark site:
// a live WebGL aurora behind the hero (one fragment shader, no libraries, works offline), glass navigation, large type that mixes a
// sans with an italic serif, glowing accent, cards with light edges, and sections that rise in as you scroll. Content stays plain
// HTML (readable without JS, editable as copy); motion stops for prefers-reduced-motion (one still frame) and when the tab is hidden.

/** Brand tokens for the immersive look; the first lines of css/immersive.css. */
export const IMMERSIVE_TOKENS = { bg: "#05070a", ink: "#eef2ef", muted: "#9aa59f", accent: "#b8ff5c", accent2: "#2fe6c8", glass: "rgba(14,18,20,.62)" };

export const IMMERSIVE_CSS = `/* Immersive style: tokens first (change these to rebrand). */
body.immersive {
  --bg: ${IMMERSIVE_TOKENS.bg}; --ink-i: ${IMMERSIVE_TOKENS.ink}; --muted-i: ${IMMERSIVE_TOKENS.muted};
  --accent: ${IMMERSIVE_TOKENS.accent}; --accent-2: ${IMMERSIVE_TOKENS.accent2}; --glass: ${IMMERSIVE_TOKENS.glass};
  --muted: var(--muted-i); --edge: rgba(255,255,255,.09); --serif: "Iowan Old Style", "Palatino Linotype", Palatino, Georgia, serif;
  background: var(--bg); color: var(--ink-i);
}
.immersive .sec, .immersive .foot { background: transparent; color: var(--ink-i); }
.immersive p, .immersive dd, .immersive .lead { color: var(--muted-i); }
.immersive h1, .immersive h2, .immersive h3 { color: var(--ink-i); letter-spacing: -.02em; }
.immersive h1 { font-size: clamp(2.6rem, 7vw, 6rem); line-height: .98; font-weight: 600; }
.immersive h2 { font-size: clamp(2rem, 4.5vw, 3.6rem); line-height: 1.02; font-weight: 600; }
.immersive h1 em, .immersive h2 em { font-family: var(--serif); font-style: italic; font-weight: 400; color: var(--ink-i); }
.immersive a { color: var(--accent); }
.immersive .skip { background: var(--accent); color: #0b0f0a; }

/* Glass pill navigation */
.immersive .top { position: fixed; inset: .9rem .9rem auto; background: none; border: 0; z-index: 20; }
.immersive .top .bar { background: var(--glass); backdrop-filter: blur(14px) saturate(140%); -webkit-backdrop-filter: blur(14px) saturate(140%);
  border: 1px solid var(--edge); border-radius: 999px; padding: .45rem .55rem .45rem 1rem; }
.immersive .top a:not(.btn) { color: var(--ink-i); }
.immersive .btn, .immersive .top .btn { color: #0b0f0a; }
.immersive .btn-quiet { color: var(--ink-i); }
.immersive .brand { color: var(--ink-i); }

/* Buttons: accent with a soft glow */
.immersive .btn { background: var(--accent); color: #0b0f0a; border: 0; border-radius: 999px; font-weight: 650;
  box-shadow: 0 0 0 1px rgba(184,255,92,.35), 0 8px 30px -6px rgba(184,255,92,.55); transition: transform .2s ease, box-shadow .2s ease; }
.immersive .btn:hover { transform: translateY(-1px); box-shadow: 0 0 0 1px rgba(184,255,92,.6), 0 12px 40px -6px rgba(184,255,92,.75); }
.immersive .btn-quiet { background: transparent; color: var(--ink-i); box-shadow: inset 0 0 0 1px var(--edge); }
.immersive :focus-visible { outline: 2px solid var(--accent); outline-offset: 3px; }

/* Hero: the aurora canvas fills it; copy sits on a dark left-to-right veil so text contrast holds over any frame */
.immersive .hero { position: relative; min-height: 100svh; display: grid; align-items: end; overflow: hidden; background: var(--bg); isolation: isolate; }
.immersive .hero::before { content: none; }
.immersive .aurora { position: absolute; inset: 0; width: 100%; height: 100%; z-index: -2; display: block; }
.immersive .hero::after { content: ""; position: absolute; inset: 0; z-index: -1;
  background: linear-gradient(90deg, rgba(5,7,10,.92) 0%, rgba(5,7,10,.7) 38%, rgba(5,7,10,.15) 70%), linear-gradient(0deg, var(--bg) 0%, transparent 30%); }
.immersive .hero-media { position: absolute; right: 5vw; top: 50%; left: auto; bottom: auto; height: auto; width: min(32vw, 440px); aspect-ratio: 4 / 5; z-index: 0;
  border-radius: 22px; overflow: hidden; border: 1px solid var(--edge); box-shadow: 0 40px 120px -30px rgba(47,230,200,.35);
  transform: translateY(-50%) perspective(1200px) rotateY(-14deg) rotateX(4deg); }
.immersive .hero-media img { width: 100%; height: 100%; object-fit: cover; }
.immersive .hero-copy { position: relative; z-index: 1; padding: 0 0 12vh; max-width: 44rem; }
.immersive .eyebrow { color: var(--accent); font: 600 .78rem/1 ui-monospace, SFMono-Regular, Menlo, monospace; letter-spacing: .22em; text-transform: uppercase; }

/* Cards with lit edges */
.immersive .features { gap: 1rem; }
.immersive .features > li { background: linear-gradient(180deg, rgba(255,255,255,.05), rgba(255,255,255,.015)); border: 1px solid var(--edge);
  border-radius: 20px; padding: 1.6rem; position: relative; overflow: hidden; border-top: 1px solid var(--edge); }
.immersive .features > li::before { content: ""; position: absolute; inset: 0 0 auto; height: 1px; background: linear-gradient(90deg, transparent, var(--accent), transparent); opacity: .7; }
.immersive .stat { color: var(--accent); font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: clamp(2.4rem, 5vw, 3.6rem); }
.immersive .specs > div { border-color: var(--edge); }
.immersive .specs dt { color: var(--muted-i); font-family: ui-monospace, SFMono-Regular, Menlo, monospace; letter-spacing: .08em; text-transform: uppercase; font-size: .8rem; }
.immersive .specs dd { color: var(--ink-i); }
.immersive details { border-color: var(--edge); }
.immersive summary { color: var(--ink-i); }
.immersive .story-media img, .immersive .lead-img { border-radius: 22px; border: 1px solid var(--edge); }
.immersive .lead { background: linear-gradient(180deg, rgba(255,255,255,.05), rgba(255,255,255,.02)); border: 1px solid var(--edge); border-radius: 22px; }
.immersive input, .immersive textarea, .immersive select { background: rgba(255,255,255,.04); color: var(--ink-i); border: 1px solid var(--edge); border-radius: 12px; }
.immersive label, .immersive .field span { color: var(--ink-i); }
.immersive .err { color: #ff8a7a; }
.immersive .foot { border-top: 1px solid var(--edge); }

/* Scroll reveal: only once the script has marked the page (so without JS everything is simply visible) */
.immersive.js-reveal .sec:not(.hero) > .wrap { opacity: 0; transform: translateY(28px); transition: opacity .9s cubic-bezier(.2,.7,.2,1), transform .9s cubic-bezier(.2,.7,.2,1); }
.immersive.js-reveal .sec.in > .wrap { opacity: 1; transform: none; }
@media (prefers-reduced-motion: reduce) {
  .immersive.js-reveal .sec:not(.hero) > .wrap { opacity: 1; transform: none; transition: none; }
  .immersive .hero-media { transform: translateY(-50%); }
  .immersive .btn { transition: none; }
}
@media (max-width: 899px) {
  .immersive .hero-media { position: relative; right: auto; top: auto; width: 100%; aspect-ratio: 16 / 10; transform: none; margin-top: 6rem; }
  .immersive .hero { align-items: start; }
  .immersive .hero::after { background: linear-gradient(0deg, var(--bg) 8%, rgba(5,7,10,.78) 46%, rgba(5,7,10,.35) 100%); }
  .immersive .hero-copy { padding: 1.5rem 0 4rem; }
  .immersive .top .bar nav ul { display: none; }
}
`;

/** Aurora fragment shader: layered value noise drives flowing ribbons of accent light over near-black. */
export const AURORA_FRAG = `precision mediump float;
uniform vec2 r; uniform float t;
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
  vec3 a=vec3(.72,1.,.36), b=vec3(.18,.9,.78), bg=vec3(.02,.027,.04);
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
