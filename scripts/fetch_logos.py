"""Company logos for the company pages: each company's own icon, saved once as a small PNG.

For every company with a website (from its Yahoo file), the best icon is looked for in order:
  1. the icons the home page declares (apple-touch-icon, icon with sizes, og:image is not used),
  2. /apple-touch-icon.png,
  3. Google's and DuckDuckGo's icon services,
and the largest square-ish one of at least 48 px is resized to 96x96 and saved as
data/logos/<SYMBOL>.png. data/logos/_index.json records what was tried ({symbol: [status, date]})
so companies without a usable icon are retried only after 60 days. The site shows the initials
when there is no logo (scripts/build_index.mjs marks companies that have one).

Usage: python scripts/fetch_logos.py [--max 800] [--workers 16]
"""
import argparse
import concurrent.futures as cf
import datetime as dt
import io
import json
import re
import sys
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import urljoin

import requests
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
YAHOO = ROOT / "data" / "yahoo"
OUT = ROOT / "data" / "logos"
UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/126.0 Safari/537.36")
SIZE = 96
MIN = 48
RETRY_DAYS = 60


class IconLinks(HTMLParser):
    """<link rel="...icon..." href sizes> in a page's <head>."""
    def __init__(self):
        super().__init__()
        self.icons = []

    def handle_starttag(self, tag, attrs):
        if tag != "link":
            return
        a = {k.lower(): (v or "") for k, v in attrs}
        rel = a.get("rel", "").lower()
        if "icon" in rel and a.get("href"):
            m = re.search(r"(\d+)x(\d+)", a.get("sizes", ""))
            size = int(m.group(1)) if m else (180 if "apple" in rel else 0)
            self.icons.append((size, a["href"]))


def get(session, url, timeout=12):
    r = session.get(url, timeout=timeout, allow_redirects=True)
    r.raise_for_status()
    return r


def image_of(data):
    """A PIL image from icon bytes (the largest frame of an .ico), or None."""
    try:
        im = Image.open(io.BytesIO(data))
        if getattr(im, "format", "") == "ICO" and hasattr(im, "ico"):
            sizes = sorted(im.ico.sizes(), key=lambda s: s[0] * s[1])
            if sizes:
                im.size = sizes[-1]
        im.load()
        return im
    except Exception:  # noqa: BLE001 (SVG, HTML error pages, broken files)
        return None


def usable(im):
    if im is None:
        return False
    w, h = im.size
    return min(w, h) >= MIN and max(w, h) <= 3 * min(w, h)


def candidates(session, site):
    """Icon URLs worth trying for a website, best first."""
    base = "https://" + site.strip("/") + "/"
    out = []
    try:
        r = get(session, base)
        p = IconLinks()
        p.feed(r.text[:300_000])
        for size, href in sorted(p.icons, key=lambda x: -x[0]):
            if not href.lower().endswith(".svg"):
                out.append(urljoin(r.url, href))
        base = r.url
    except Exception:  # noqa: BLE001 (site down, blocks bots)
        pass
    domain = re.sub(r"^https?://", "", base).split("/")[0]
    out += [urljoin(base, "/apple-touch-icon.png"),
            f"https://www.google.com/s2/favicons?domain={domain}&sz=128",
            f"https://icons.duckduckgo.com/ip3/{domain}.ico",
            urljoin(base, "/favicon.ico")]
    seen, uniq = set(), []
    for u in out:
        if u not in seen:
            seen.add(u)
            uniq.append(u)
    return uniq


def logo_for(sym, site):
    """Save the company's logo; returns 'ok' or 'none'."""
    s = requests.Session()
    s.headers.update({"User-Agent": UA, "Accept": "text/html,image/*,*/*;q=0.8"})
    best = None
    for url in candidates(s, site):
        try:
            im = image_of(get(s, url).content)
        except Exception:  # noqa: BLE001
            continue
        if usable(im) and (best is None or min(im.size) > min(best.size)):
            best = im
            if min(im.size) >= SIZE:
                break
    if best is None:
        return "none"
    im = best.convert("RGBA")
    # square it on a transparent background, then shrink
    side = max(im.size)
    sq = Image.new("RGBA", (side, side), (0, 0, 0, 0))
    sq.paste(im, ((side - im.size[0]) // 2, (side - im.size[1]) // 2))
    sq = sq.resize((SIZE, SIZE), Image.LANCZOS)
    sq.save(OUT / f"{sym}.png", optimize=True)
    return "ok"


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--max", type=int, default=800, help="companies to try this run")
    ap.add_argument("--workers", type=int, default=16)
    args = ap.parse_args(argv)

    OUT.mkdir(parents=True, exist_ok=True)
    idx_file = OUT / "_index.json"
    try:
        index = json.loads(idx_file.read_text())
    except (OSError, ValueError):
        index = {}
    # largest companies first (metrics.json from the last build), then the rest
    mcap = {}
    try:
        for c in json.loads((YAHOO / "metrics.json").read_text()).get("companies", []):
            mcap[c["s"]] = (c.get("m") or {}).get("marketCap") or 0
    except (OSError, ValueError):
        pass
    today = dt.date.today()
    todo = []
    for f in YAHOO.glob("*.json"):
        sym = f.stem
        if sym != sym.upper() or sym in ("INDEX", "METRICS"):
            continue
        st = index.get(sym)
        if st and (st[0] == "ok" and (OUT / f"{sym}.png").exists() or
                   st[0] == "none" and (today - dt.date.fromisoformat(st[1])).days < RETRY_DAYS):
            continue
        try:
            site = (json.loads(f.read_text()).get("website") or "").strip()
        except ValueError:
            continue
        site = re.sub(r"^https?://", "", site).strip("/")
        if site:
            todo.append((sym, site))
    todo.sort(key=lambda x: -mcap.get(x[0], 0))
    todo = todo[:args.max]
    print(f"Logos: {len(todo)} companies to look up ({sum(1 for v in index.values() if v[0] == 'ok')} logos so far)")
    done = 0
    with cf.ThreadPoolExecutor(args.workers) as ex:
        futs = {ex.submit(logo_for, sym, site): sym for sym, site in todo}
        for fu in cf.as_completed(futs):
            sym = futs[fu]
            try:
                st = fu.result()
            except Exception as e:  # noqa: BLE001
                print(sym, "failed:", e, file=sys.stderr)
                st = "none"
            index[sym] = [st, today.isoformat()]
            done += st == "ok"
    idx_file.write_text(json.dumps(index, separators=(",", ":"), sort_keys=True))
    print(f"Logos: {done} of {len(todo)} found; {sum(1 for v in index.values() if v[0] == 'ok')} companies have one")
    return 0


if __name__ == "__main__":
    sys.exit(main())
