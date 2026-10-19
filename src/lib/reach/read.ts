import { fetchPage, safeFetch } from "../memory";
import { JINA, httpsUrl } from "./pure";
import { UA, polite } from "./net";

/** A public page → readable text: ORBIT's own fetchPage (SSRF guard + HTML-to-text); anonymous Jina Reader only when that
 *  fails or finds almost no text (JavaScript-only pages). Capped at maxChars. */
export async function readUrl(url: string, maxChars = 8000): Promise<{ title: string; text: string; url: string; via: "direct" | "jina" }> {
  const u = httpsUrl(url.startsWith("http://") ? url.replace(/^http:/, "https:") : url);
  if (!u) throw new Error("Only public https links can be read");
  let direct: Awaited<ReturnType<typeof fetchPage>> | null = null, err: unknown = null;
  try { direct = await fetchPage(u); } catch (e) { err = e; }
  if (direct && direct.text.trim().length >= 300) return { ...direct, text: direct.text.slice(0, maxChars), via: "direct" };
  if (err instanceof Error && /not publicly reachable/.test(err.message)) throw err; // never hand a private address to a third party
  try {
    const text = await polite(JINA(u), async () => (await (await safeFetch(JINA(u), "text/plain", UA, 1_000_000)).res.text()));
    if (text.trim()) return { title: direct?.title || new URL(u).hostname, text: text.slice(0, maxChars), url: u, via: "jina" };
  } catch { /* fall through to whatever the direct read got */ }
  if (direct) return { ...direct, text: direct.text.slice(0, maxChars), via: "direct" };
  throw err instanceof Error ? err : new Error("Couldn't read that page");
}
