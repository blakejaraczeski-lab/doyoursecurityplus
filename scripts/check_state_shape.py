#!/usr/bin/env python3
"""The state document never grows per answer.

It holds what you know, what you got wrong and when you studied, keyed by
item and misconception, so it grows with the bank and not with the number of
answers. Anything per answer is a row in the review log, its own resource.
Fails on a reviews key in DEFAULT_STATE, on any array in DEFAULT_STATE that is
pushed to, and on any push into the state that is not marked bounded.
"""
import re, sys, pathlib

ROOT = pathlib.Path(__file__).resolve().parent.parent
fails = []

state_src = (ROOT / "app/state.js").read_text()
m = re.search(r"export const DEFAULT_STATE = \{(.*?)\n\};", state_src, re.S)
block = m.group(1) if m else ""
if not m:
    fails.append("app/state.js: DEFAULT_STATE not found")
if re.search(r"^\s*reviews\s*:", block, re.M):
    fails.append("DEFAULT_STATE has a reviews key; the review log is its own resource (app/reviews.js)")

app_src = {p: p.read_text() for p in ROOT.glob("app/**/*.js")}
joined = "\n".join(app_src.values())

for key in set(re.findall(r"(\w+)\s*:\s*\[\]", block)):
    if re.search(r"\b%s\.push\(" % re.escape(key), joined):
        fails.append(f"DEFAULT_STATE.{key} is an array that app/ pushes to")

# Any push whose receiver is reached from the state: App.state.x.push, state.x.push,
# rec.x.push. A push that is genuinely bounded says so on the same line.
for p, src in app_src.items():
    for i, line in enumerate(src.splitlines(), 1):
        if re.search(r"\b(App\.state|state|rec|s)\.[\w.\[\]'\"]*\.push\(", line) and "// bounded:" not in line:
            fails.append(f"{p.relative_to(ROOT)}:{i} pushes into the state document: {line.strip()[:80]}")

if fails:
    print("\n".join("  x " + f for f in fails))
    sys.exit(1)
print("state document holds nothing that grows per answer")
