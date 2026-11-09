# scrape_page (Scrapling)

CORE's `scrape_page` tool reads pages that `fetch_url` can't (JS-heavy sites, pages that block plain fetches), through
[Scrapling](https://github.com/D4Vinci/Scrapling) in a separate Python process.

Install once on the PC that runs ORBIT:

    pip install "scrapling[fetchers]"
    scrapling install            # browsers for "browser" and "stealth"

Optional `.env.local`:

    ORBIT_PYTHON=python                          # which Python runs the helper
    ORBIT_SCRAPE_STEALTH=example.com,shop.example.org   # sites where stealth mode may be used (subdomains included)

Modes: `fast` (plain HTTP with browser-like TLS, default), `browser` (real Chromium), `stealth` (anti-bot browser; only on the sites
listed above, each use logged in Activity). Every mode honours robots.txt, refuses private/internal addresses (before and after
redirects), and waits between requests to the same site (3 s / 6 s / 15 s). Respect each site's terms: stealth can get an IP or account
blocked by the site.
