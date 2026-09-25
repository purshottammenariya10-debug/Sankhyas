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


def nse_session(delay=0.8):
    """Return an NSE session primed with cookies, or None if NSE refuses us."""
    t = Throttled(NSE_HEADERS, delay=delay)
    try:
        t.get(NSE_HOME, expect_json=False, retries=1)
        return t
    except requests.RequestException:
        return None
