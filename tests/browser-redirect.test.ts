// S01: a public page that redirects to a private address must not make the hidden browser request that address at all
// (not just hide the result). Real Chromium against two local servers: "public" (allowed by the injected host check) redirects to
// "private" (refused). Skips when no browser is installed.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { browsePage } from "../src/lib/browser.ts";

const listen = (s: Server) => new Promise<number>((ok) => s.listen(0, "127.0.0.1", () => ok((s.address() as { port: number }).port)));

test("redirect hops onto a refused host are never requested (navigation and subresource)", async (t) => {
  let privateHits = 0;
  const priv = createServer((_q, r) => { privateHits++; r.end("secret"); }), pp = await listen(priv);
  const target = `http://localhost:${pp}/secret`; // "localhost" is the refused host; 127.0.0.1 plays the public site
  const pub = createServer((q, r) => {
    if (q.url === "/hop") { r.writeHead(302, { location: target }); return r.end(); }
    if (q.url === "/ok") { r.writeHead(301, { location: "/landing" }); return r.end(); }
    if (q.url === "/landing") { r.setHeader("content-type", "text/html"); return r.end("<p>landed safely</p>"); }
    if (q.url === "/img") { r.writeHead(302, { location: target + ".js" }); return r.end(); }
    r.setHeader("content-type", "text/html"); r.end(`<p>public</p><script src="/img"></script>`);
  });
  const port = await listen(pub), hostOk = async (h: string) => h === "127.0.0.1";
  t.after(() => { pub.close(); priv.close(); });
  const page = await browsePage(`http://127.0.0.1:${port}/`, [], false, () => false, hostOk);
  if (page === null) return t.skip("no hidden browser here");
  const nav = await browsePage(`http://127.0.0.1:${port}/hop`, [], false, () => false, hostOk);
  assert.equal(nav, null, "a page that lands on a refused host returns nothing");
  assert.equal(privateHits, 0, "the refused host was never contacted");
  const ok = await browsePage(`http://127.0.0.1:${port}/ok`, [], false, () => false, hostOk);
  assert.ok(ok && "text" in ok && /landed safely/.test(ok.text) && ok.url.endsWith("/landing"), "allowed redirects still work");
});
