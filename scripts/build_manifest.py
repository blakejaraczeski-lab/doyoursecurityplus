#!/usr/bin/env python3
"""Regenerate content/manifest.json. The browser cannot list a directory, so the
app reads this to know which content files exist. Run after adding content."""
import json, pathlib

ROOT = pathlib.Path(__file__).resolve().parent.parent
C = ROOT / "content"

def ls(sub):
    d = C / sub
    return sorted(p.name for p in d.glob("*.json")) if d.exists() else []

manifest = {"items": ls("items"), "pbq": ls("pbq"), "mentor": ls("mentor"), "index": ls("index")}
(C / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")
for k, v in manifest.items():
    print(f"  {k}: {len(v)} file(s) {v if len(v) < 8 else ''}")
print("wrote content/manifest.json")
