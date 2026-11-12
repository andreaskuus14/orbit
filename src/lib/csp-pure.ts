// Content Security Policy for ORBIT's pages: scripts only from ORBIT itself, with a per-request nonce for Next's own inline bootstrap
// ('strict-dynamic' lets those trusted scripts load their chunks). Injected HTML can't run script. Styles stay inline-friendly (React
// style props, R3F), media/workers may be blob: (textures, voice), WebAssembly may compile (local AI models). API routes and the
// sandboxed workspace/shop previews keep their own headers. Applied in middleware.ts. Tests: tests/csp.test.ts.

/** Pages get the policy; API responses, the /w workspace previews and the shop preview (own CSP, framed by ORBIT) don't. */
export const cspApplies = (path: string) => !path.startsWith("/api/") && !path.startsWith("/w/") && path !== "/w" && !path.startsWith("/p/") && !path.startsWith("/_next/");

/** `supabase`: the project URL; its origin is allowed for fetch/websocket even over plain http (a local Supabase). */
export function csp(nonce: string, dev = false, supabase = ""): string {
  let sb = ""; try { const u = new URL(supabase); sb = ` ${u.origin} ${u.origin.replace(/^http/, "ws")}`; } catch { /* unset */ }
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic' 'wasm-unsafe-eval'${dev ? " 'unsafe-eval'" : ""}`, // dev: React refresh needs eval
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https:",
    "media-src 'self' data: blob: https:",
    "font-src 'self' data:",
    "connect-src 'self' https: wss:" + sb + (dev ? " ws:" : ""),
    "worker-src 'self' blob:",
    "frame-src 'self' https://www.youtube-nocookie.com https://www.youtube.com",
    "object-src 'self'", // VAULT's PDF preview
    "base-uri 'self'",
    "form-action 'self'",
  ].join("; ");
}
/** 128-bit random nonce, base64 (Web Crypto: middleware runs on the edge runtime). */
export function newNonce(): string {
  const b = new Uint8Array(16); crypto.getRandomValues(b);
  let s = ""; for (const x of b) s += String.fromCharCode(x);
  return btoa(s);
}
