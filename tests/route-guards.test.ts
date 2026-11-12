import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import ts from "typescript";

// Static safety net for every API route (docs/SAFETY.md §6). Each exported handler must reach requireUser() (session + allowed
// email) or, if public, its own named check. Each state-changing handler must be covered by crossSiteBlocked(): src/middleware.ts
// runs it on every /api write, but its matcher skips paths ending in .png/.jpg/.svg/.webp/.webm/.mp4, so a route whose LAST segment is
// dynamic (/api/tasks/x.png) bypasses the middleware and must call crossSiteBlocked() itself. Exceptions need a reason below.

const ROOT = "src/app/api";
const METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE"];
const WRITES = new Set(["POST", "PUT", "PATCH", "DELETE"]);

// "route METHOD" (route = path under src/app/api) -> [the check it must reach instead of requireUser, or null; why].
const PUBLIC: Record<string, [string | null, string]> = {
  "health GET": [null, "liveness ping for the launcher and wake listener; returns nothing sensitive"],
  "studio/busy GET": ["loopbackOrigin", "night script polls it; localhost Host only, booleans only"],
  "remote POST": ["deviceFromCookie", "paired-phone command endpoint; device-token cookie"],
  "remote/pair POST": ["verifyPair", "phone pairing: the 6-digit code the PC shows issues the device token"],
  "remote/pair DELETE": [null, "only deletes this phone's own device cookie"],
  "remote/place GET": ["deviceFromCookie", "paired phone; device-token cookie"],
  "remote/place POST": ["deviceFromCookie", "paired phone; device-token cookie"],
  "remote/push GET": ["deviceFromCookie", "paired phone; device-token cookie"],
  "remote/push POST": ["deviceFromCookie", "paired phone; device-token cookie"],
  "remote/push DELETE": ["deviceFromCookie", "paired phone; device-token cookie"],
  "remote/screen GET": ["deviceFromCookie", "read-only second screen; device-token cookie"],
  "remote/shortcut POST": ["findShortcut", "Apple Shortcuts; per-action Bearer token"],
  "remote/thumb GET": ["deviceFromCookie", "paired phone; device-token cookie"],
  "business/chatwoot POST": ["chatwootSecretOk", "Chatwoot webhook: shared secret, constant-time; stores + drafts only, never sends"],
  "remote/ntfy-act POST": ["spendAct", "ntfy Approve/Reject button: HMAC-signed, 24 h, one-use token per single reversible approval"],
};
// "route METHOD" -> why that write handler (last segment dynamic) doesn't call crossSiteBlocked. Empty: keep it that way.
const NO_CSRF: Record<string, string> = {};
// The CSRF rule above relies on this exact matcher; if you change it, re-check which routes the middleware can miss.
const MATCHER = String.raw`"/((?!_next/static|_next/image|favicon.ico|.*\\.(?:png|jpg|svg|webp|webm|mp4)$).*)"`;


function routeFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? routeFiles(join(dir, e.name)) : e.name === "route.ts" ? [join(dir, e.name)] : []);
}

/** Exported handler name -> the set of guard calls it reaches (following calls to same-file functions). */
export function guardsByHandler(src: string): Map<string, Set<string>> {
  const sf = ts.createSourceFile("route.ts", src, ts.ScriptTarget.Latest, true);
  const locals = new Map<string, ts.Node>(); // top-level function / const-function bodies
  const exported = new Map<string, string>(); // exported name -> local name
  const isExported = (n: ts.Node) => ts.canHaveModifiers(n) && !!ts.getModifiers(n)?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword);
  for (const st of sf.statements) {
    if (ts.isFunctionDeclaration(st) && st.name) {
      locals.set(st.name.text, st);
      if (isExported(st)) exported.set(st.name.text, st.name.text);
    } else if (ts.isVariableStatement(st)) {
      for (const d of st.declarationList.declarations) if (ts.isIdentifier(d.name) && d.initializer) {
        locals.set(d.name.text, d.initializer);
        if (isExported(st)) exported.set(d.name.text, d.name.text);
      }
    } else if (ts.isExportDeclaration(st) && st.exportClause && ts.isNamedExports(st.exportClause) && !st.moduleSpecifier) {
      for (const s of st.exportClause.elements) exported.set(s.name.text, (s.propertyName ?? s.name).text);
    }
  }
  const reach = (start: string) => {
    const calls = new Set<string>(), seen = new Set<string>();
    const visit = (n: ts.Node): void => {
      if (ts.isIdentifier(n) && locals.has(n.text) && !seen.has(n.text)) { seen.add(n.text); visit(locals.get(n.text)!); }
      if (ts.isCallExpression(n) && ts.isIdentifier(n.expression)) calls.add(n.expression.text);
      ts.forEachChild(n, visit);
    };
    seen.add(start); visit(locals.get(start) ?? sf);
    return calls;
  };
  const out = new Map<string, Set<string>>();
  for (const [name, local] of exported) if (METHODS.includes(name)) out.set(name, reach(local));
  return out;
}

const routes = routeFiles(ROOT);

test("route guards: parser follows same-file helpers, aliases and arrow exports", () => {
  const g = guardsByHandler(`
    async function inner() { await requireUser(); }
    export async function GET() { return inner(); }
    export const POST = async (req: Request) => { if (crossSiteBlocked("POST", "/x", {})) return; };
    function del() {}
    export { del as DELETE };`);
  assert.ok(g.get("GET")!.has("requireUser"));
  assert.ok(g.get("POST")!.has("crossSiteBlocked") && !g.get("POST")!.has("requireUser"));
  assert.ok(g.has("DELETE") && !g.get("DELETE")!.has("requireUser"));
});

test("route guards: the middleware runs crossSiteBlocked with the matcher the CSRF rule assumes", () => {
  const mw = readFileSync("src/middleware.ts", "utf8");
  assert.ok(mw.includes(`matcher: [${MATCHER}]`), "middleware matcher changed: re-check the CSRF rule in this test");
  assert.ok(/export async function middleware[^{]*\{\s*if \(crossSiteBlocked\(request\.method/.test(mw), "middleware's first check is crossSiteBlocked");
});

test("route guards: every API handler checks auth, every write checks cross-site", () => {
  assert.ok(routes.length > 100, "found the API routes");
  const missing: string[] = [], seen = new Set<string>();
  let handlers = 0;
  for (const f of routes) {
    const route = relative(ROOT, f).replace(/\\/g, "/").replace(/\/?route\.ts$/, "") || ".";
    const middlewareCovers = !route.split("/").pop()!.startsWith("[");
    for (const [m, calls] of guardsByHandler(readFileSync(f, "utf8"))) {
      const k = `${route} ${m}`;
      handlers++;
      if (PUBLIC[k]) {
        seen.add(k);
        const check = PUBLIC[k][0];
        if (check && !calls.has(check)) missing.push(`${k}: public, but no ${check}()`);
      } else if (!calls.has("requireUser")) missing.push(`${k}: no requireUser()`);
      if (!WRITES.has(m) || middlewareCovers || calls.has("crossSiteBlocked")) continue;
      if (NO_CSRF[k]) seen.add(k);
      else missing.push(`${k}: no crossSiteBlocked()`);
    }
  }
  assert.ok(handlers > routes.length);
  assert.deepEqual(missing, [], "add the guard, or allow-list the route with a reason");
  const stale = [...Object.keys(PUBLIC), ...Object.keys(NO_CSRF)].filter((k) => !seen.has(k));
  assert.deepEqual(stale, [], "allow-list entries that no longer match a handler");
});
