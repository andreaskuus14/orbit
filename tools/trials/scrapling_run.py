"""Scrapling side of trial 29. argv: pages.json (list of urls) -> JSON {url: {fetcher: {text, links, sec, status}|{error}}} on stdout.
Plain Fetcher and DynamicFetcher (browser rendering) ONLY. No StealthyFetcher, no anti-bot/Cloudflare/CAPTCHA bypass: pages that
refuse are reported as refused. robots.txt is checked first; 3 s between requests to one host. Run inside tools/trials/.venv."""
import json, sys, time
from urllib import robotparser
from urllib.parse import urlparse, urljoin
from scrapling.fetchers import Fetcher, DynamicFetcher

UA = "orbit-trial/1.0 (personal research; respects robots.txt)"
_robots, _last = {}, {}

def allowed(url):
    u = urlparse(url); base = f"{u.scheme}://{u.netloc}"
    if base not in _robots:
        rp = robotparser.RobotFileParser(base + "/robots.txt")
        try: rp.read()
        except Exception: rp = None  # unreachable robots.txt: treated as allowed, like most crawlers
        _robots[base] = rp
    rp = _robots[base]
    return rp is None or rp.can_fetch(UA, url)

def run(kind, url):
    host = urlparse(url).netloc
    wait = 3 - (time.time() - _last.get(host, 0))
    if wait > 0: time.sleep(wait)
    t = time.perf_counter()
    try:
        page = Fetcher.get(url, timeout=20, stealthy_headers=False, headers={"User-Agent": UA}) if kind == "fetcher" else DynamicFetcher.fetch(url, headless=True, network_idle=True, timeout=45000, extra_headers={"User-Agent": UA})
    except Exception as e:
        return {"error": f"{type(e).__name__}: {str(e)[:160]}"}
    finally: _last[host] = time.time()
    final = str(getattr(page, "url", url) or url)
    text = page.get_all_text(separator="\n", strip=True, ignore_tags=("script", "style", "noscript"))
    links = [urljoin(final, str(h)) for h in page.css("a::attr(href)").getall()]
    return {"text": str(text)[:60000], "links": [l for l in links if l.startswith("http")][:200], "sec": time.perf_counter() - t, "status": getattr(page, "status", 0)}

out = {}
for url in json.load(open(sys.argv[1])):
    if not allowed(url): out[url] = {"fetcher": {"error": "disallowed by robots.txt"}, "dynamic": {"error": "disallowed by robots.txt"}}; continue
    out[url] = {"fetcher": run("fetcher", url), "dynamic": run("dynamic", url)}
print(json.dumps(out))
