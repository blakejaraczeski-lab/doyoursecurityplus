#!/usr/bin/env python3
"""Extract CompTIA's acronym list into content/glossary.json.

The objectives document ships a list of acronyms and states candidates are
expected to have a working knowledge of all of them. The exam does not ask you
to expand them: it uses them inside a stem and moves on. A candidate who stalls
on "what was ARO again" has already lost the question on reading speed.

So the list is a glossary, not a question bank. The app expands every acronym
inline wherever it appears in a stem or an option, which is the moment the
expansion is actually needed.
"""
import json, re, pathlib

ROOT = pathlib.Path(__file__).resolve().parent.parent
SRC = ROOT / "reference" / "sy0-701-objectives-official.txt"
OUT = ROOT / "content" / "glossary.json"

# Lines are "ACRONYM  Spelled Out", with the expansion often wrapping onto the
# next line or two. Anything that is not a new acronym continues the previous.
ACRO = re.compile(r"^([A-Z][A-Za-z0-9\-\+/&\.]{1,13})\s{1,}([A-Z(].*)$")
NOISE = re.compile(r"CompTIA|Copyright|Acronym\s+Spelled|^\s*$|Certification Exam|"
                   r"Objectives Version|EXAM OBJECTIVES|DOMAIN|PERCENTAGE|TEST DETAILS")


def looks_like_acronym(tok):
    """An acronym is mostly capitals, or short with at least two of them (SaaS,
    IaaS). A title-case English word is neither, and reading one as an acronym
    both invents a junk entry and truncates the real entry above it."""
    alpha = [c for c in tok if c.isalpha()]
    if len(alpha) < 2:
        return False
    upper = sum(1 for c in alpha if c.isupper())
    return upper >= 2 and (upper / len(alpha) >= 0.6 or len(alpha) <= 5)


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
            cont = line.strip()
            if len(cont) < 60:
                out[current] = (out[current] + " " + cont).strip()
    clean = {}
    for k, v in out.items():
        v = re.sub(r"\s+", " ", v).strip(" .")
        # A two-token acronym ("USB OTG") is printed as "USB OTG USB On the Go":
        # the first token is read as the key and the second lands in the
        # expansion, followed by the key again.
        m = re.match(rf"^([A-Z0-9]{{2,6}}) {re.escape(k)} (.+)$", v)
        if m:
            k, v = f"{k} {m.group(1)}", m.group(2)
        # A heading that slipped the filter has no lowercase letters at all.
        if not any(c.islower() for c in v):
            continue
        if 4 <= len(v) <= 90:
            clean[k] = v
    return clean


def build():
    glossary = dict(sorted(parse().items()))
    OUT.write_text(json.dumps(glossary, indent=2, ensure_ascii=False) + "\n")
    print(f"{len(glossary)} acronyms -> {OUT.relative_to(ROOT)}")
    for k in list(glossary)[:3]:
        print(f"  {k}: {glossary[k]}")


if __name__ == "__main__":
    build()
