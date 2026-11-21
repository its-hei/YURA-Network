#!/usr/bin/env python3
"""Opt-in CI smoke of the three public sources used by YURA Discord FFXIV news.
These are live third-party endpoints: transient downtime must not block deploying
the unrelated Twitch and Discord Cloud features.
"""
import json
import re
from urllib.request import Request, urlopen

SOURCES = [
    ("Lodestone News EU", "https://eu.finalfantasyxiv.com/lodestone/news/news.xml", "rss"),
    ("Lodestone News NA fallback", "https://na.finalfantasyxiv.com/lodestone/news/news.xml", "rss"),
    ("Lodestone Topics NA fallback", "https://na.finalfantasyxiv.com/lodestone/news/topics.xml", "rss"),
    ("Dalamud stable", "https://raw.githubusercontent.com/goatcorp/dalamud-distrib/main/version", "version"),
    ("Fashion Report weekly image", "https://fashionreportxiv.com/hint.png", "png")
]

results = {}
for name, url, kind in SOURCES:
    try:
        with urlopen(Request(url, headers={"User-Agent": "YURA-Cloud-FFXIV-News-Smoke/1.1"}), timeout=12) as resp:
            body = resp.read(6_000_000)
            if kind == "rss":
                s = body.decode("utf-8", "ignore")
                assert "<feed" in s and "<entry" in s, "Atom feed has no entries"
                assert "http://www.w3.org/2005/Atom" in s, "Expected official Atom namespace"
                assert re.search(r'<entry\b[\s\S]*?<title>', s), "Atom entries have no titles"
                detail = f"{len(re.findall('<entry', s))} Atom entries"
            elif kind == "version":
                v = json.loads(body)["AssemblyVersion"]
                assert re.fullmatch(r"\d+\.\d+\.\d+\.\d+", v), "Invalid stable version"
                detail = f"stable {v}"
            else:
                assert body.startswith(b"\x89PNG\r\n\x1a\n"), "Not a PNG"
                assert 20_000 < len(body) < 5_000_000, "Unexpected PNG size"
                detail = f"{len(body)} PNG bytes"
        results[name] = True
        print(f"OK   {name}: {detail}")
    except Exception as exc:
        results[name] = False
        print(f"WARN {name}: {type(exc).__name__}: {exc}")
print(f"\nSOURCE SMOKE: {sum(results.values())}/{len(results)} responding as expected.")
if not results["Dalamud stable"] or not results["Fashion Report weekly image"] or not (results["Lodestone News EU"] or results["Lodestone News NA fallback"]):
    raise SystemExit("One or more key source groups could not be verified (non-blocking CI step).")
