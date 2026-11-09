"""ORBIT scrape_page helper (Scrapling). Reads {"url", "mode", "select"} as JSON on stdin, prints {"url", "title", "text", "status"}
or {"error"} as JSON. Refuses private/internal addresses before and after fetching (redirects included).
Install once:  pip install "scrapling[fetchers]" && scrapling install"""
import ipaddress, json, socket, sys
from urllib.parse import urlparse

def public(url):
    host = urlparse(url).hostname or ""
    try: infos = socket.getaddrinfo(host, None)
    except OSError: return False
    return all(not (ipaddress.ip_address(i[4][0]).is_private or ipaddress.ip_address(i[4][0]).is_loopback or ipaddress.ip_address(i[4][0]).is_link_local or ipaddress.ip_address(i[4][0]).is_reserved) for i in infos)

def main():
    req = json.load(sys.stdin); url, mode, sel = req["url"], req.get("mode", "fast"), req.get("select")
    if urlparse(url).scheme not in ("http", "https") or not public(url): return {"error": "only public http(s) addresses"}
    try:
        if mode == "stealth":
            from scrapling.fetchers import StealthyFetcher
            page = StealthyFetcher.fetch(url, headless=True, network_idle=True)
        elif mode == "browser":
            import scrapling.fetchers as F  # the plain-browser fetcher's name changed across versions
            Dyn = getattr(F, "DynamicFetcher", None) or getattr(F, "PlayWrightFetcher", None)
            if Dyn is None: return {"error": "browser mode needs Scrapling with DynamicFetcher: pip install -U \"scrapling[fetchers]\""}
            page = Dyn.fetch(url, headless=True, network_idle=True)
        else:
            from scrapling.fetchers import Fetcher
            page = Fetcher.get(url, stealthy_headers=True, timeout=20)
    except Exception as e:
        return {"error": f"{type(e).__name__}: {str(e)[:200]}"}
    final = getattr(page, "url", url) or url
    if not public(final): return {"error": "the page redirected to a private address"}
    nodes = page.css(sel) if sel else None
    text = "\n".join(n.get_all_text(separator=" ", strip=True) for n in nodes) if nodes else page.get_all_text(separator="\n", strip=True, ignore_tags=("script", "style", "noscript"))
    title = page.css("title::text").get() or urlparse(final).hostname
    return {"url": final, "title": str(title).strip()[:200], "text": str(text)[:60000], "status": getattr(page, "status", 0)}

print(json.dumps(main()))
