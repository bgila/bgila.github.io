#!/usr/bin/env python3
"""Build the hosted email archive + data.json for the Connie Chan AI project.

Source lives outside this repo (the raw mailbox pull); this script turns it into
the static files served from /projects/connie-chan-ai/.

    python3 build.py [--src ~/Downloads/wiener-chan-emails]

What it does, per email:
  * strips `nvep` and `hmac` from every NGP VAN click-tracking URL. `nvep` is
    base64 JSON that embeds the RECIPIENT'S EMAIL ADDRESS in 263 links across
    the corpus -- it must never be published.
  * drops the unsubscribe links entirely (they carry a per-recipient token).
  * drops the open-tracking pixel, so readers don't ping the campaign's CRM.
  * downloads remote images and rewrites them to local paths, so the page
    doesn't hotlink EveryAction's CDN or leak referrers.
  * wraps the original HTML in a small archive banner.

Run it again any time the corpus changes; output is deterministic.
"""

import argparse
import base64
import csv
import hashlib
import json
import os
import re
import shutil
import urllib.parse
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
OUT_EMAILS = os.path.join(HERE, "emails")
OUT_IMAGES = os.path.join(OUT_EMAILS, "images")

# Query params that carry per-recipient identity.
PII_PARAMS = {"nvep", "hmac", "emci", "emdi", "ceid", "unsubscribedata"}

BANNER = """<div style="font:14px/1.5 -apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;\
background:#f0efec;border-bottom:1px solid #d8d6d0;padding:12px 16px;color:#52514e">
<strong style="color:#0b0b0b">Archived campaign email</strong> &mdash; {subject}<br>
Sent {date} by Connie Chan for Congress.
<a href="../#{anchor}" style="color:#2a78d6">&larr; back to the analysis</a>
</div>
"""


def strip_pii(url):
    """Remove per-recipient query params from a URL."""
    parts = urllib.parse.urlsplit(url)
    if not parts.query:
        return url
    kept = [
        (k, v)
        for k, v in urllib.parse.parse_qsl(parts.query, keep_blank_values=True)
        if k.lower() not in PII_PARAMS
    ]
    return urllib.parse.urlunsplit(
        (parts.scheme, parts.netloc, parts.path, urllib.parse.urlencode(kept), parts.fragment)
    )


def local_image(url, cache):
    """Download an image once, return its local filename."""
    if url in cache:
        return cache[url]
    clean = strip_pii(url)
    ext = os.path.splitext(urllib.parse.urlsplit(clean).path)[1].lower() or ".png"
    if ext not in (".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg"):
        ext = ".png"
    name = hashlib.sha1(clean.encode()).hexdigest()[:16] + ext
    dest = os.path.join(OUT_IMAGES, name)
    if not os.path.exists(dest):
        try:
            req = urllib.request.Request(clean, headers={"User-Agent": "Mozilla/5.0"})
            with urllib.request.urlopen(req, timeout=30) as r, open(dest, "wb") as f:
                shutil.copyfileobj(r, f)
        except Exception as e:  # noqa: BLE001 - a missing image shouldn't kill the build
            print(f"    ! image failed ({e}): {clean[:80]}")
            cache[url] = None
            return None
    cache[url] = name
    return name


def sanitize(html, subject, date, anchor, cache):
    # 1. open-tracking pixel: <img src="https://click.ngpvan.com/j/...">
    html = re.sub(r'<img[^>]+src="https://click\.ngpvan\.com/j/[^"]*"[^>]*/?>', "", html)

    # 2. unsubscribe / preference links -> inert
    def kill_unsub(m):
        return 'href="#" data-removed="unsubscribe"'

    html = re.sub(r'href="https://secure\.ngpvan\.com/[^"]*"', kill_unsub, html)

    # 3. remaining links: strip identity params
    html = re.sub(
        r'href="(https?://[^"]+)"',
        lambda m: 'href="' + strip_pii(m.group(1).replace("&amp;", "&")).replace("&", "&amp;") + '"',
        html,
    )

    # 4. images -> local
    def localize(m):
        name = local_image(m.group(1).replace("&amp;", "&"), cache)
        return f'src="images/{name}"' if name else 'src="" data-missing="1"'

    html = re.sub(r'src="(https?://[^"]+)"', localize, html)

    # 5. the campaign ships an empty <title>; name the tab so 19 open archives
    #    stay tellable apart
    title = f"{date} &mdash; {subject.replace('<', '&lt;')}"
    if re.search(r"<title>\s*</title>", html):
        html = re.sub(r"<title>\s*</title>", f"<title>{title}</title>", html, count=1)
    elif "<head" in html:
        html = re.sub(r"(<head[^>]*>)", r"\1" + f"<title>{title}</title>", html, count=1)

    banner = BANNER.format(subject=subject.replace("<", "&lt;"), date=date, anchor=anchor)
    if "<body" in html:
        html = re.sub(r"(<body[^>]*>)", r"\1" + banner, html, count=1)
    else:
        html = banner + html
    return html


def audit(html):
    """Return a list of PII findings, so a leak fails loudly instead of shipping."""
    problems = []
    for m in re.findall(r"nvep=([A-Za-z0-9%+/=_-]+)", html):
        problems.append("nvep param survived")
        break
    if "unsubscribedata=" in html:
        problems.append("unsubscribe token survived")
    if "americanpolitics" in html:
        problems.append("recipient address in plaintext")
    for m in re.findall(r"[A-Za-z0-9+/]{24,}={0,2}", html):
        try:
            dec = base64.b64decode(m + "=" * (-len(m) % 4)).decode("utf-8", "ignore")
        except Exception:  # noqa: BLE001
            continue
        if "americanpolitics" in dec:
            problems.append("recipient address in base64")
            break
    return problems


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--src", default=os.path.expanduser("~/Downloads/wiener-chan-emails"))
    args = ap.parse_args()
    src = args.src

    os.makedirs(OUT_IMAGES, exist_ok=True)

    results = {
        r["date"]: r
        for r in csv.DictReader(open(os.path.join(src, "results/pangram-results-chan.csv")))
    }
    corpus = {c["date"]: c for c in json.load(open(os.path.join(src, "results/corpus_chan.json")))}
    index = {
        e["id"].replace("chan-", ""): e
        for e in json.load(open(os.path.join(src, "emails-html/index.json")))
    }

    cache = {}
    emails = []
    failures = []

    for date in sorted(results, reverse=True):
        r = results[date]
        meta = index.get(date, {})
        anchor = f"e{date}"
        raw = open(os.path.join(src, f"emails-html/html/chan-{date}.html"), encoding="utf-8").read()
        clean = sanitize(raw, r["subject"], date, anchor, cache)

        problems = audit(clean)
        if problems:
            failures.append((date, problems))

        out = os.path.join(OUT_EMAILS, f"chan-{date}.html")
        with open(out, "w", encoding="utf-8") as f:
            f.write(clean)

        emails.append(
            {
                "date": date,
                "subject": r["subject"],
                "sender": r["sender"],
                "words": int(r["words"]),
                "verdict": r["verdict"],
                "fraction_ai": float(r["fraction_ai"]),
                "version": r["version"],
                "html": f"emails/chan-{date}.html",
                "links": meta.get("n_links", 0),
                "text": corpus.get(date, {}).get("text", ""),
            }
        )

    if failures:
        print("\nPII AUDIT FAILED -- not writing data.json:")
        for d, p in failures:
            print(f"  {d}: {', '.join(p)}")
        raise SystemExit(1)

    n = len(emails)
    counts = {v: sum(1 for e in emails if e["verdict"] == v) for v in ("Human", "Mixed", "AI")}
    data = {
        "model": emails[0]["version"] if emails else "",
        "summary": {
            "n": n,
            "counts": counts,
            "any_ai": sum(1 for e in emails if e["fraction_ai"] > 0),
            "all_ai": sum(1 for e in emails if e["fraction_ai"] == 1),
            "mean_fraction_ai": round(sum(e["fraction_ai"] for e in emails) / n, 3),
            "words": sum(e["words"] for e in emails),
            "first": min(e["date"] for e in emails),
            "last": max(e["date"] for e in emails),
        },
        "emails": emails,
    }
    with open(os.path.join(HERE, "data.json"), "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2, ensure_ascii=False)

    print(f"{n} emails written, {len(set(v for v in cache.values() if v))} images localized")
    print(f"PII audit: clean")
    print(json.dumps(data["summary"], indent=2))


if __name__ == "__main__":
    main()
