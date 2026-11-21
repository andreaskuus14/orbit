// Every source file stays plain UTF-8: no BOM and no mojibake. Windows PowerShell 5.1 (Set-Content / Out-File) once
// re-saved i18n-pure.ts as UTF-8-with-BOM after reading it as Windows-1252, turning "·" into "Â·" and "⋯" into "â‹¯"
// (#693, fixed in #696). Estonian letters (õ ä ö ü š ž) break the same way, so this check fails the gate instead.
import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

const ROOTS = ["src", "tests", "scripts", "tools"];
const EXT = /\.(ts|tsx|mjs|js|json|css|md|ps1|py|html)$/i;
const SKIP = /(^|[\\/])(node_modules|\.next|fixtures|\.venv|venv|ComfyUI[^\\/]*|env)([\\/]|$)/;
// UTF-8 bytes of common characters decoded as Windows-1252, then saved again as UTF-8.
const MOJIBAKE = /Ã[µ¤¶¼•„–Ÿ©]|Å[¡¾ ½]|Â[·°²³ ]|â€[™œ”“¦¢]|â‹|â†|âœ/;

function walk(dir: string, out: string[]) {
  let names: string[] = [];
  try { names = readdirSync(dir); } catch { return; }
  for (const n of names) {
    const p = path.join(dir, n);
    if (SKIP.test(p)) continue;
    let st; try { st = statSync(p); } catch { continue; }
    if (st.isDirectory()) walk(p, out);
    else if (EXT.test(n) && st.size < 2_000_000) out.push(p);
  }
}

test("source files are UTF-8 without BOM and without mojibake", () => {
  const files: string[] = [];
  for (const r of ROOTS) walk(r, files);
  assert.ok(files.length > 100, "found the source files");
  const bom: string[] = [], bad: string[] = [];
  for (const f of files) {
    if (f.endsWith(path.join("tests", "encoding.test.ts"))) continue; // this file names the patterns
    const buf = readFileSync(f);
    if (buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) bom.push(f);
    const m = buf.toString("utf8").match(MOJIBAKE);
    if (m) bad.push(`${f} (${JSON.stringify(m[0])})`);
  }
  assert.deepEqual(bom, [], `UTF-8 BOM found; save as UTF-8 without BOM`);
  assert.deepEqual(bad, [], `mojibake found (file was read as Windows-1252 and re-saved)`);
});
