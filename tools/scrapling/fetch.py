"""ORBIT scrape_page helper (Scrapling). Reads {"url", "mode", "select", "timeout", "retries"} as JSON on stdin, prints
{"url", "title", "text", "status"} or {"error"} as JSON. Refuses private/internal addresses before and after fetching (redirects included).
No proxy is ever set. timeout (seconds) / retries come from scrape.ts so one page ends before ORBIT's own limit: Scrapling's defaults
(3 tries x 30 s) outlasted it, and its retry warning "Proxy 'None' failed (attempt 1)" (any connect/timeout error, no proxy needed)
was all ORBIT saw. Scrapling's own log lines go to stderr at ERROR level only.
Install once:  powershell -File tools/scrapling/setup.ps1  (venv in tools/scrapling/.venv)"""
import ipaddress, json, logging, socket, sys
from urllib.parse import urlparse

def public(url):
    host = urlparse(url).hostname or ""
    try: infos = socket.getaddrinfo(host, None)
    except OSError: return False
    return all(not (ipaddress.ip_address(i[4][0]).is_private or ipaddress.ip_address(i[4][0]).is_loopback or ipaddress.ip_address(i[4][0]).is_link_local or ipaddress.ip_address(i[4][0]).is_reserved) for i in infos)

def browser_fetch(cls, url, timeout_s, retries):
    # Browser fetchers take milliseconds; older Scrapling versions don't know every keyword, so fall back step by step.
    for kw in ({"timeout": timeout_s * 1000, "retries": retries}, {"timeout": timeout_s * 1000}, {}):
        try: return cls.fetch(url, headless=True, network_idle=True, **kw)
        except TypeError: continue
    return cls.fetch(url, headless=True, network_idle=True)

def main():
    req = json.load(sys.stdin); url, mode, sel = req["url"], req.get("mode", "fast"), req.get("select")
    timeout_s = max(3, min(int(req.get("timeout") or 20), 120)); retries = max(1, min(int(req.get("retries") or 1), 3))
    if urlparse(url).scheme not in ("http", "https") or not public(url): return {"error": "only public http(s) addresses"}
    try:
        import scrapling.fetchers as F
        import scrapling.core.utils  # noqa: F401  sets Scrapling's logger up (INFO); quieted right after
        logging.getLogger("scrapling").setLevel(logging.ERROR)
        if mode == "stealth":
            page = browser_fetch(F.StealthyFetcher, url, timeout_s, retries)
        elif mode == "browser":
            Dyn = getattr(F, "DynamicFetcher", None) or getattr(F, "PlayWrightFetcher", None)
            if Dyn is None: return {"error": "browser mode needs Scrapling with DynamicFetcher: pip install -U \"scrapling[fetchers]\""}
            page = browser_fetch(Dyn, url, timeout_s, retries)
        else:
            try: page = F.Fetcher.get(url, stealthy_headers=True, timeout=timeout_s, retries=retries)
            except TypeError: page = F.Fetcher.get(url, stealthy_headers=True, timeout=timeout_s)  # older Scrapling: no retries keyword
    except Exception as e:
        return {"error": f"{type(e).__name__}: {str(e)[:200]}"}
    final = getattr(page, "url", url) or url
    if not public(final): return {"error": "the page redirected to a private address"}
    nodes = page.css(sel) if sel else None
    text = "\n".join(n.get_all_text(separator=" ", strip=True) for n in nodes) if nodes else page.get_all_text(separator="\n", strip=True, ignore_tags=("script", "style", "noscript"))
    title = page.css("title::text").get() or urlparse(final).hostname
    return {"url": final, "title": str(title).strip()[:200], "text": str(text)[:60000], "status": getattr(page, "status", 0)}

print(json.dumps(main()))
