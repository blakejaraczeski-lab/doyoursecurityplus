#!/usr/bin/env python3
"""Honest materials: a 1px border and a solid panel, colour from tokens.

Fails on box-shadow, any gradient, backdrop-filter, and on a hex, rgb or hsl
literal anywhere in styles.css outside the token blocks (:root, light and
dark). Everything else reads colour through var(--token), which is what keeps
both themes defined in one place and keeps a one-off hue from creeping in.

Exemptions (none today). To add one, list the exact declaration here with the
reason, and it is skipped by string match:
"""
EXEMPT = {
    # "box-shadow: 0 0 0 2px var(--accent)": "reason",
}

import re, sys, pathlib

ROOT = pathlib.Path(__file__).resolve().parent.parent
css = (ROOT / "styles.css").read_text()
fails = []

# Drop comments, then the token blocks: `:root {` at top level and inside the
# dark media query. A token block ends at its own closing brace.
body = re.sub(r"/\*.*?\*/", "", css, flags=re.S)
body = re.sub(r":root\s*\{[^}]*\}", "", body)

for i, line in enumerate(body.splitlines(), 1):
    bare = line.strip()
    if any(ex in bare for ex in EXEMPT):
        continue
    for name, pat in (("box-shadow", r"\bbox-shadow\s*:"),
                      ("gradient", r"\b(linear|radial|conic)-gradient\("),
                      ("backdrop-filter", r"\bbackdrop-filter\s*:"),
                      ("colour literal", r"(#[0-9a-fA-F]{3,8}\b|\brgba?\(|\bhsla?\()")):
        if re.search(pat, bare):
            fails.append(f"{name}: {bare[:90]}")

# Motion stays under 150 ms: every duration in a transition or animation, and
# the --dur token itself, wherever it is declared.
for i, line in enumerate(css.splitlines(), 1):
    bare = line.strip()
    if re.search(r"\b(transition|animation)\s*:|--dur\s*:", bare):
        for n, unit in re.findall(r"(\d*\.?\d+)(ms|s)\b", bare):
            ms = float(n) * (1000 if unit == "s" else 1)
            if ms >= 150:
                fails.append(f"motion {ms:.0f} ms, not under 150: {bare[:80]}")

if fails:
    print("\n".join("  x " + f for f in fails))
    sys.exit(1)
print("materials honest: no shadow, no gradient, no blur, every colour a token, all motion under 150 ms")
