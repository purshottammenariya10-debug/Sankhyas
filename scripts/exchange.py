"""Shared HTTP helpers for NSE and BSE.

Both exchanges serve their public website data through JSON endpoints that expect
browser-like headers. NSE additionally needs session cookies from its home page and
often refuses requests from cloud IP ranges; callers must treat every call as
best-effort and keep previously fetched data when a call fails.
"""
import time

import requests

UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/126.0 Safari/537.36")

BSE_API = "https://api.bseindia.com/BseIndiaAPI/api"
BSE_HEADERS = {
    "User-Agent": UA,
    "Accept": "application/json, text/plain, */*",
    "Accept-Language": "en-US,en;q=0.9",
    "Referer": "https://www.bseindia.com/",
    "Origin": "https://www.bseindia.com",
}
NSE_HOME = "https://www.nseindia.com"
NSE_HEADERS = {
    "User-Agent": UA,
    "Accept": "application/json, text/plain, */*",
    "Accept-Language": "en-US,en;q=0.9",
    "Referer": "https://www.nseindia.com/",
}


class Throttled:
    """A requests session that waits `delay` seconds between calls and retries transient errors."""

    def __init__(self, headers, delay=0.6, timeout=30):
        self.s = requests.Session()
        self.s.headers.update(headers)
        self.delay = delay
        self.timeout = timeout
        self._last = 0.0

    def get(self, url, params=None, retries=2, expect_json=True):
        for attempt in range(retries + 1):
            wait = self.delay - (time.time() - self._last)
            if wait > 0:
                time.sleep(wait)
            self._last = time.time()
            try:
                r = self.s.get(url, params=params, timeout=self.timeout)
                if r.status_code in (429, 500, 502, 503, 504) and attempt < retries:
                    time.sleep(2 ** (attempt + 2))
                    continue
                r.raise_for_status()
                return r.json() if expect_json else r
            except (requests.RequestException, ValueError):
                if attempt >= retries:
                    raise
                time.sleep(2 ** (attempt + 1))
        return None


def bse_session(delay=0.6):
    return Throttled(BSE_HEADERS, delay=delay)


def fetch_text(url, referer="https://www.nseindia.com/", timeout=30):
    """Plain GET with browser headers (no cookies); raises on HTTP errors."""
    r = requests.get(url, headers={"User-Agent": UA, "Accept": "text/csv,text/plain,*/*", "Referer": referer}, timeout=timeout)
    r.raise_for_status()
    return r.text


def _site_config():
    """Supabase URL and public anon key from the environment or js/config.js."""
    import os
    import re
    from pathlib import Path
    url, key = os.environ.get("SUPABASE_URL", ""), os.environ.get("SUPABASE_ANON_KEY", "")
    if not (url and key):
        cfg = Path(__file__).resolve().parent.parent / "js" / "config.js"
        text = cfg.read_text() if cfg.exists() else ""
        m1 = re.search(r"supabaseUrl:\s*'([^']*)'", text)
        m2 = re.search(r"supabaseAnonKey:\s*'([^']*)'", text)
        url, key = url or (m1.group(1) if m1 else ""), key or (m2.group(1) if m2 else "")
    return url.rstrip("/"), key


class NseRelay:
    """NSE's JSON APIs through the Sankhyas nse-proxy Edge Function (Supabase, Mumbai region).
    NSE refuses GitHub's servers but answers there. Same get() interface as Throttled."""

    def __init__(self, url, key, delay=0.3, timeout=120):
        import os
        self.endpoint = url + "/functions/v1/nse-proxy"
        self.s = requests.Session()
        self.s.headers.update({"Authorization": "Bearer " + key, "apikey": key, "Content-Type": "application/json", "x-region": "ap-south-1"})
        if os.environ.get("NSE_PROXY_SECRET"):
            self.s.headers["x-proxy-secret"] = os.environ["NSE_PROXY_SECRET"]
        self.delay, self.timeout, self._last = delay, timeout, 0.0

    def get(self, url, params=None, retries=2, expect_json=True):
        from urllib.parse import quote, urlencode
        # %20 for spaces: the relay only accepts plain URL characters, not '+'
        path = url.replace(NSE_HOME, "", 1) + ("?" + urlencode(params or {}, safe=",", quote_via=quote) if params else "")
        # most relay paths are "endpoint?query"; the IPO lists take no query and are allowed bare
        if "?" not in path and path not in ("/api/ipo-current-issue", "/api/public-past-issues"):
            path += "?"
        for attempt in range(retries + 1):
            wait = self.delay - (time.time() - self._last)
            if wait > 0:
                time.sleep(wait)
            self._last = time.time()
            try:
                r = self.s.post(self.endpoint, json={"paths": [path]}, timeout=self.timeout)
                if r.status_code == 400:   # the relay refused the path: retrying cannot help
                    raise ValueError(f"relay refused {path[:80]}: {r.text[:120]}")
                r.raise_for_status()
                res = r.json()[0]
                if res.get("status") == 200:
                    return res.get("data")
                raise requests.HTTPError(f"NSE answered {res.get('status')} via relay")
            except (requests.RequestException, ValueError, IndexError, KeyError) as e:
                if attempt >= retries or "relay refused" in str(e):
                    raise
                time.sleep(2 ** (attempt + 1))
        return None


def nse_session(delay=0.8):
    """Return an NSE session: direct when NSE lets us in, else through the Sankhyas relay when
    the site has a Supabase project, else None."""
    t = Throttled(NSE_HEADERS, delay=delay)
    try:
        t.get(NSE_HOME, expect_json=False, retries=1)
        t.get(NSE_HOME + "/api/annual-reports", params={"index": "equities", "symbol": "TCS"}, retries=0)
        return t
    except (requests.RequestException, ValueError):
        pass
    url, key = _site_config()
    if url and key:
        relay = NseRelay(url, key)
        try:
            relay.get(NSE_HOME + "/api/annual-reports", params={"index": "equities", "symbol": "TCS"}, retries=1)
            print("NSE: direct access refused; using the Sankhyas relay (Supabase, Mumbai)")
            return relay
        except Exception as e:  # noqa: BLE001
            print(f"NSE relay unavailable: {str(e)[:100]}")
    return None
