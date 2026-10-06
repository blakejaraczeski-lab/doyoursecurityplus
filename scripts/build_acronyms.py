#!/usr/bin/env python3
"""Extract CompTIA's acronym list and turn it into discrimination questions.

The objectives document ships a list of acronyms and states candidates are
expected to have a working knowledge of all of them. The exam does not ask you
to expand them: it uses them inside a stem and moves on. A candidate who stalls
on "what was ARO again" has already lost the question on reading speed.

So these are recognition drills with sibling expansions as distractors, not
fill-in-the-blank. The expansion also carries the meaning: ARO is a RATE, which
is exactly why it multiplies rather than adds.
"""
import json, re, pathlib, random
from collections import defaultdict

ROOT = pathlib.Path(__file__).resolve().parent.parent
SRC = ROOT / "reference" / "sy0-701-objectives-official.txt"
OUT_ITEMS = ROOT / "content" / "items" / "acronyms.json"
OUT_MENTOR = ROOT / "content" / "mentor" / "acronyms.json"

# Lines are "ACRONYM  Spelled Out", with the expansion often wrapping onto the
# next line or two. Anything that is not a new acronym continues the previous.
ACRO = re.compile(r"^([A-Z][A-Za-z0-9\-\+/&\.]{1,13})\s{1,}([A-Z(].*)$")
NOISE = re.compile(r"CompTIA|Copyright|Acronym\s+Spelled|^\s*$|Certification Exam|"
                   r"Objectives Version|EXAM OBJECTIVES|DOMAIN|PERCENTAGE|TEST DETAILS")


def looks_like_acronym(tok):
    """An acronym is mostly capitals. A title-case English word is not.

    Without this, a wrapped expansion line such as "Common Knowledge" is read as
    a new entry named "Common", which both invents a junk item AND truncates the
    real one above it: ATT&CK lost "Common Knowledge" off the end of its
    expansion exactly this way.
    """
    alpha = [c for c in tok if c.isalpha()]
    if len(alpha) < 2:
        return False
    upper = sum(1 for c in alpha if c.isupper())
    return upper >= 2 and upper / len(alpha) >= 0.6


def parse():
    if not SRC.exists():
        raise SystemExit(f"missing {SRC} (it is gitignored; re-extract from the official PDF)")
    out, current = {}, None
    for raw in SRC.read_text().splitlines():
        line = raw.rstrip()
        if NOISE.search(line):
            current = None
            continue
        m = ACRO.match(line.strip())
        if m and len(m.group(1)) <= 13 and looks_like_acronym(m.group(1)):
            current = m.group(1).strip()
            out[current] = m.group(2).strip()
        elif current and line.strip():
            # A wrapped expansion. Anything that is not itself a new acronym
            # belongs to the entry above it.
            cont = line.strip()
            if len(cont) < 60:
                out[current] = (out[current] + " " + cont).strip()
    # tidy
    clean = {}
    for k, v in out.items():
        v = re.sub(r"\s+", " ", v).strip(" .")
        if v.isupper() and len(v) > 6:
            continue                      # a heading that slipped the filter
        if 4 <= len(v) <= 90:
            clean[k] = v
    return clean


def build():
    acros = parse()
    rng = random.Random(20261006)
    terms = list(acros.items())
    by_letter = defaultdict(list)
    for a, e in terms:
        by_letter[a[0]].append((a, e))

    items = []
    # SOC (Security Operations Center) and SoC (System on Chip) are both on this
    # exam and both slug to "acr-soc". Case is the only thing separating them,
    # so the id has to carry it.
    used = {}
    for acro, expansion in sorted(terms):
        # Distractors: other acronyms' real expansions. Same first letter when
        # possible, because that is the confusion that actually happens
        # (SLE/SLA, MTTR/MTBF, DAC/MAC/RBAC).
        pool = [x for x in by_letter[acro[0]] if x[0] != acro]
        if len(pool) < 3:
            pool = pool + [x for x in terms if x[0] != acro and x not in pool]
        if len(pool) < 3:
            continue
        picks = rng.sample(pool[:40], 3)

        opts = [{"text": expansion, "correct": True}] + [{"text": e, "correct": False, "from": a} for a, e in picks]
        rng.Random(f"{acro}-order").shuffle(opts) if hasattr(rng, "Random") else rng.shuffle(opts)

        options = []
        for i, o in enumerate(opts):
            entry = {"id": "abcd"[i], "text": o["text"]}
            if o.get("correct"):
                entry["correct"] = True
                entry["why"] = f"{acro} is {o['text']}."
            else:
                entry["misconception"] = "acronym-fluency"
                entry["why"] = f"That is {o['from']}, not {acro}."
            options.append(entry)

        slug = f"acr-{acro.lower().replace('/', '-').replace('.', '')}"
        if slug in used:
            slug = f"{slug}-{''.join('u' if c.isupper() else 'l' for c in acro if c.isalpha())}"
        used[slug] = acro

        items.append({
            "id": slug,
            "type": "mcq",
            "derived": True,
            "source": "acronym-list",
            "objective": None,
            "topics": [],
            "difficulty": 1,
            "stem": f"The exam uses this acronym without expanding it. What is {acro}?",
            "options": options,
            "selectCount": 1,
        })

    mentor = [{
        "id": "acronym-fluency",
        "label": "Stalling on an acronym mid-stem",
        "objective": "1.2",
        "topics": [],
        "severity": "medium",
        "mentor": {
            "diagnosis": "You lost time working out what an acronym meant instead of answering the question. The exam never expands them, and a stem you have to decode twice is a stem you answer slowly and badly.",
            "contrast": [
                ["Acronym", "Expansion", "What the words tell you"],
                ["ARO", "Annualized Rate of Occurrence", "It is a RATE, so it multiplies. Once in four years is 0.25, not 4"],
                ["SLE", "Single Loss Expectancy", "SINGLE: one event, not a year"],
                ["ALE", "Annualized Loss Expectancy", "ANNUALIZED: SLE times ARO"],
                ["RPO", "Recovery POINT Objective", "A point in the past: how much data you can lose"],
                ["RTO", "Recovery TIME Objective", "A duration forward: how long until you are back"],
                ["MTBF", "Mean Time BETWEEN Failures", "Between: reliability across a life"],
                ["MTTR", "Mean Time To Repair", "To repair: how long a fix takes"],
            ],
            "rule": "Expand the acronym in your head and the answer is usually inside the words. Rate multiplies, point looks backwards, time looks forwards, single means one event.",
            "tell": "Any stem with a bare three-letter acronym and numbers in the options is testing whether you know which word the acronym hides.",
            "trap": "The ones that catch people are the pairs that differ by one word: SLE and SLA, RPO and RTO, MTBF and MTTR, DAC and MAC. Learning the pair together is faster than learning either alone.",
        },
        "retireAfter": 2,
    }]

    OUT_ITEMS.write_text(json.dumps(items, indent=2) + "\n")
    OUT_MENTOR.write_text(json.dumps(mentor, indent=2) + "\n")
    print(f"parsed {len(acros)} acronyms from the official list")
    print(f"generated {len(items)} recognition items -> {OUT_ITEMS.relative_to(ROOT)}")
    print(f"sample: {items[0]['stem']}")
    for o in items[0]["options"]:
        print(f"   {'*' if o.get('correct') else ' '} {o['text'][:64]}")


if __name__ == "__main__":
    build()
