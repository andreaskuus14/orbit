import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { orbitDataDir } from "./data-dir";
import { fetchPage, safeFetch } from "./memory";
import { docFromYaml, docUrls, fresh, pageUrl, parseYaml, pruneCache, validName, type ApiDoc, type CacheEntry } from "./roblox-docs-pure";

// Roblox API reference lookup: Roblox's open-source Creator Docs YAML from GitHub (create.roblox.com page text as a summary-only fallback),
// compacted and cached in ORBIT's data folder for 7 days. Best effort: a lookup never throws, it just returns fewer docs.

const UA = "ORBIT/0.2 (personal game-dev tool)";
const file = () => path.join(orbitDataDir(), "roblox-docs.json");
type State = { cache?: Promise<Record<string, CacheEntry>>; write: Promise<unknown>; inflight: Map<string, Promise<ApiDoc | null>> };
const g = globalThis as unknown as { __orbitRbxDocs?: State };
const st: State = (g.__orbitRbxDocs ??= { write: Promise.resolve(), inflight: new Map() });

function cache(): Promise<Record<string, CacheEntry>> {
  return (st.cache ??= readFile(file(), "utf8").then((t: string) => pruneCache(JSON.parse(t) as Record<string, CacheEntry>, Date.now())).catch(() => ({}))); // missing or corrupt = empty
}

function save(c: Record<string, CacheEntry>) {
  st.write = st.write.catch(() => {}).then(async () => {
    const kept = pruneCache(c, Date.now());
    for (const k of Object.keys(c)) if (!(k in kept)) delete c[k]; // the in-memory copy stays bounded too
    await mkdir(path.dirname(file()), { recursive: true });
    await writeFile(`${file()}.tmp`, JSON.stringify(kept));
    await rename(`${file()}.tmp`, file());
  }).catch((e) => console.warn("[orbit] roblox docs cache not saved", e));
}

/** null = not a documented API (both 404). Throws on network errors (caller falls back to the docs page). */
async function fetchYaml(name: string): Promise<ApiDoc | null> {
  for (const url of docUrls(name)) {
    try {
      const { res } = await safeFetch(url, "text/plain", UA, 2_000_000);
      return docFromYaml(parseYaml(await res.text()));
    } catch (e) {
      if (e instanceof Error && /answered 404/.test(e.message)) continue;
      throw e;
    }
  }
  return null;
}

async function fetchDoc(name: string): Promise<{ doc: ApiDoc | null; keep: boolean }> {
  try { return { doc: await fetchYaml(name), keep: true }; }
  catch {
    try { // summary-only doc, not cached, never used by the validator
      const p = await fetchPage(pageUrl(name));
      return { doc: { name, kind: name.startsWith("Enum.") ? "enum" : "class", summary: p.text.slice(0, 1200), inherits: [], members: [], partial: true }, keep: false };
    } catch { return { doc: null, keep: false }; }
  }
}

/** Docs for these names (and with `chain`, every ancestor class too, for the validator), keyed by name. Gives up waiting after timeoutMs. */
export async function lookupApi(names: string[], opts: { chain?: boolean; timeoutMs?: number } = {}): Promise<Record<string, ApiDoc>> {
  const out: Record<string, ApiDoc> = Object.create(null);
  const c = await cache();
  const one = async (n: string): Promise<void> => {
    if (!validName(n) || Object.hasOwn(out, n)) return;
    let e = Object.hasOwn(c, n) ? c[n] : undefined;
    if (!fresh(e, Date.now())) {
      let p = st.inflight.get(n);
      if (!p) {
        p = fetchDoc(n).then(({ doc, keep }) => { if (keep) { c[n] = { at: Date.now(), doc }; save(c); } return doc; });
        st.inflight.set(n, p);
        void p.finally(() => st.inflight.delete(n));
      }
      e = { at: Date.now(), doc: await p };
    }
    if (!e.doc) return;
    out[n] = e.doc;
    if (opts.chain && e.doc.inherits[0]) await one(e.doc.inherits[0]); // Object (inherits: []) ends the chain
  };
  const work = Promise.all([...new Set(names)].slice(0, 20).map((n) => one(n).catch(() => {})));
  await Promise.race([work, new Promise((r) => setTimeout(r, opts.timeoutMs ?? 8000))]);
  return Object.assign(Object.create(null) as Record<string, ApiDoc>, out); // a snapshot: late fetches don't change it
}
