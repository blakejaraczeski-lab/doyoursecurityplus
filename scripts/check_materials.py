#!/usr/bin/env python3
"""Honest materials: a 1px border and a solid panel, colour from tokens.

Fails on box-shadow, any gradient, backdrop-filter, and on a hex, rgb or hsl
literal anywhere in styles.css outside the token blocks (:root, light and
dark). Everything else reads colour through var(--token), which is what keeps
both themes defined in one place and keeps a one-off hue from creeping in.

State is never colour alone (CONVENTIONS.md rule 7): a rule that sets a state
colour (--good, --warn, --bad, --ok, or a -soft tint) with only color,
background, fill or stroke, and no border, outline, content or text-decoration
change beside it, must be listed in CARRIERS with the cue that travels with it
in the markup. A new colour-only rule fails until someone says where its glyph
or word is; a CARRIERS entry whose rule is gone fails too. A machine cannot see
the markup glyph itself, so this makes the claim explicit and reviewable.

Exemptions (none today). To add one, list the exact declaration here with the
reason, and it is skipped by string match:
"""
EXEMPT = {
    # "box-shadow: 0 0 0 2px var(--accent)": "reason",
}

CARRIERS = {
    ".nav .badge.hot": "the badge holds a count",
    ".stat dd.warn": "the figure is text beside its label",
    ".stat dd.good": "the figure is text beside its label",
    ".dot.saved": "the dot is followed by a status word",
    ".dot.saving": "the dot is followed by a status word",
    ".dot.offline, .dot.conflict": "the dot is followed by a status word",
    ".c-good": "a number or word, never an empty swatch",
    ".c-warn": "a number or word, never an empty swatch",
    ".c-bad": "a number or word, never an empty swatch",
    ".exam-bar b": "bold text states the condition",
    ".opt.correct .verdict": "the verdict is a glyph",
    ".opt.wrong .verdict": "the verdict is a glyph",
    ".verdict-banner.yes .mark": "the mark holds a glyph",
    ".verdict-banner.no .mark, .verdict-banner.bad .mark": "the mark holds a glyph",
    ".verdict-banner.warn .mark": "the mark holds a glyph",
    ".tier-banner b": "bold text names the tier",
    ".tier-banner.t-third b": "bold text names the tier",
    ".drill-banner.repair b": "bold text names the mode",
    ".blockers > b": "bold text names the blockers",
    ".quad.q-good b": "a count and a caption word",
    ".quad.q-bad b": "a count and a caption word",
    ".quad.q-warn b": "a count and a caption word",
    ".mark.ok": "the mark holds a glyph",
    ".mark.no": "the mark holds a glyph",
    ".mark.part": "the mark holds a glyph",
    ".node.selected rect, .node.selected ellipse": "the selected node is also named in the detail panel",
    ".s-strong span": "the cell prints the percentage",
    ".s-ok span": "the cell prints the percentage",
    ".s-shaky span": "the cell prints the percentage",
    ".s-weak span": "the cell prints the percentage",
    ".root-cause b": "bold text is the misconception name",
    ".next-up .mastery.s-weak": "the mastery percentage is text",
    ".next-up .mastery.s-shaky": "the mastery percentage is text",
    ".next-up .mastery.s-ok, .next-up .mastery.s-strong": "the mastery percentage is text",
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

# Colour alone: see CARRIERS above.
seen = set()
for m in re.finditer(r"([^{}]+)\{([^{}]*)\}", body):
    sel, decls = " ".join(m.group(1).split()), [d.strip() for d in m.group(2).split(";") if d.strip()]
    colour = [d for d in decls if re.match(r"(color|background(-color)?|fill|stroke)\s*:", d)
              and re.search(r"var\(--(good|warn|bad|ok)(-soft)?\)", d)]
    if not colour or any(re.match(r"(border[\w-]*|outline|content|text-decoration)\s*:", d) for d in decls):
        continue
    seen.add(sel)
    if sel not in CARRIERS:
        fails.append(f"colour alone, name the glyph or word that travels with it in CARRIERS: {sel[:80]}")
for sel in sorted(set(CARRIERS) - seen):
    fails.append(f"CARRIERS lists a rule that is not colour-only any more: {sel}")

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
