#!/usr/bin/env python3
"""Honest materials: a 1px border and a solid panel, colour from tokens.

Fails on box-shadow, any gradient, backdrop-filter, and on a hex, rgb or hsl
literal anywhere in styles.css outside the token blocks (:root, light and
dark). Everything else reads colour through var(--token), which is what keeps
both themes defined in one place and keeps a one-off hue from creeping in.

State is never colour alone (CONVENTIONS.md rule 7): a rule that sets a state
colour (--good, --warn, --bad, --ok, or a -soft tint) with only color,
background, fill or stroke, and no border, outline, content, text-decoration or
stroke-width change beside it, must be listed in CARRIERS with the cue that travels with it
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
    ".nav .badge.hot": "styles.css prints a ! before the count (.nav .badge.hot::before)",
    ".stat dd.warn": "styles.css prints a ! before the figure (.stat dd.warn::before)",
    ".stat dd.good": "styles.css prints a check before the figure (.stat dd.good::before)",
    ".dot.saved": "SYNC_TEXT prints a status word beside the dot (main.js syncFootHtml)",
    ".dot.saving": "SYNC_TEXT prints a status word beside the dot (main.js syncFootHtml)",
    ".dot.offline, .dot.conflict": "SYNC_TEXT prints a status word beside the dot (main.js syncFootHtml)",
    ".c-good": "mock list and PBQ score print a number beside 'pass'/'below' or the pass line; the timer says last 5 or 15 min in words (main.js tickMock)",
    ".c-warn": "mock timer says last 15 min in words; the score-big bands print a word beside the number: above, near or below the line (views.js), strong, partial or weak (pbq.js)",
    ".c-bad": "mock timer says last 5 min in words; PBQ trace rows carry a check or cross mark in the first cell; the score-big bands and the overconfidence percentage print a word (views.js, pbq.js)",
    ".exam-bar b": "bold sentence states it, and .exam-bar has its own 1px warn border",
    ".opt.correct .verdict": "the verdict is a check glyph (views.js verdict = &check;)",
    ".opt.wrong .verdict": "the verdict is a cross glyph (views.js verdict = &times;)",
    ".verdict-banner.yes .mark": "the mark is a check glyph; .verdict-banner.yes has its own border",
    ".verdict-banner.no .mark, .verdict-banner.bad .mark": "the mark is a cross or ! glyph; the banner has its own border",
    ".verdict-banner.warn .mark": "the mark is a ~ or ! glyph; the banner has its own border",
    ".tier-banner b": "bold text is the tier name; .tier-banner has a 1px border",
    ".tier-banner.t-third b": "bold text is the tier name; .t-third changes the border colour in its own rule",
    ".drill-banner.repair b": "bold text is the mode name; .drill-banner.repair has its own border",
    ".blockers > b": "bold sentence 'This sits on top of something still open'",
    ".quad.q-good b": "a count with a caption word (Sure and right); the quad has its own border",
    ".quad.q-bad b": "a count with a caption word (Sure and wrong); the quad has its own border",
    ".quad.q-warn b": "a count with a caption word (Guessed and wrong); the quad has its own border",
    ".mark.ok": "the mark holds a check glyph (common.js resultsHtml, views.js)",
    ".mark.no": "the mark holds a cross glyph (common.js resultsHtml, views.js)",
    ".mark.part": "the mark holds a ~ glyph (common.js resultsHtml)",
    ".s-strong span": "the heat cell prints the status word and the percentage (views.js)",
    ".s-ok span": "the heat cell prints the status word and the percentage (views.js)",
    ".s-shaky span": "the heat cell prints the status word and the percentage (views.js)",
    ".s-weak span": "the heat cell prints the status word and the percentage (views.js)",
    ".root-cause b": "bold text is the misconception label; the card has a .flag left border",
    ".next-up .mastery.s-weak": "the mastery prints the status word after the percentage (views.js)",
    ".next-up .mastery.s-shaky": "the mastery prints the status word after the percentage (views.js)",
    ".next-up .mastery.s-ok, .next-up .mastery.s-strong": "the mastery prints the status word after the percentage (views.js)",
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
    if not colour or any(re.match(r"(border[\w-]*|outline|content|text-decoration|stroke-width)\s*:", d) for d in decls):
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
