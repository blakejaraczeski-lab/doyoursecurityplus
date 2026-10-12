#!/usr/bin/env python3
"""Index a study guide PDF the user owns: section titles and page numbers only.

Usage:
  python3 scripts/build_reference_index.py <pdf> <slug> "<display title>"
  python3 scripts/build_reference_index.py <pdf> messer-notes "<title>" --layout messer

No content from the source is copied. The output is a lookup table so a mentor
card can say "you own this, it is on page 211" instead of re-explaining from
scratch. Each section is matched to the SY0-701 objective it covers: by title
similarity against the official objective statements and topic labels, or, with
the messer layout, by the objective code printed in the table of contents.
Sections that match no objective are not written, because the app never reads
them.
"""
import json, re, sys, pathlib, argparse
from pypdf import PdfReader

ROOT = pathlib.Path(__file__).resolve().parent.parent
STOP = set("""the a an and or of to in for with on is are be by as at from that this it its
not no all any can may must should which what when who how use used using other into than
then only more most such via per within without between given scenario summarize explain
compare contrast various types common importance elements purpose activities associated""".split())

# "Title .... 123" or "Title 123"
TOC = re.compile(r"^(.{6,120}?)[\s.]{2,}(\d{1,4})\s*$")
TOC2 = re.compile(r"^(.{6,120}?)\s+(\d{1,4})\s*$")

# Messer's contents print the objective code on every line: "4.1 - Title  59".
MESSER_LINE = re.compile(r"^(\d\.\d)\s*[-–]\s*(.+?)\s+(\d{1,3})$")
# Messer files a few sections under a neighbouring objective. Map them back to
# the objective CompTIA actually lists them under, so coverage lines up.
MESSER_OVERRIDES = {"Log Data": "4.9"}


def words(s):
    return [w for w in re.findall(r"[a-z0-9]+", s.lower()) if w not in STOP and len(w) > 2]


def load_objectives():
    doc = json.loads((ROOT / "content" / "objectives.json").read_text())
    objs = []
    for d in doc["domains"]:
        for o in d["objectives"]:
            bag = set(words(o["title"]))
            topics = {t["id"]: set(words(t["label"])) for t in o["topics"]}
            objs.append({"id": o["id"], "title": o["title"], "bag": bag, "topics": topics})
    return objs


def match_objective(title, objs):
    toks = set(words(title))
    if not toks:
        return None
    best, score = None, 0.0
    for o in objs:
        s = 0.0
        if o["bag"]:
            s += 2.2 * len(o["bag"] & toks) / len(o["bag"])
        hits = sum(1 for tb in o["topics"].values() if tb and len(tb & toks) / len(tb) >= 0.6)
        s += min(hits, 4) * 0.5
        if s > score:
            best, score = o["id"], s
    return best if score >= 0.7 else None


def from_outline(reader, objs):
    """Ebook-style PDFs often have no printed page numbers in the contents, but
    they do carry a PDF outline with real page destinations. Use that instead."""
    out = []

    def walk(items):
        for it in items:
            if isinstance(it, list):
                walk(it)
                continue
            try:
                title = str(it.title).strip()
                page = reader.get_destination_page_number(it) + 1
            except Exception:
                continue
            if len(title) >= 4:
                out.append({"objective": match_objective(title, objs), "title": title, "page": page})

    try:
        walk(reader.outline)
    except Exception:
        return []
    return out


def generic_sections(reader, objs):
    entries, seen = [], set()
    # Table of contents lives in the front matter; scan generously then stop.
    for page in reader.pages[:25]:
        for raw in (page.extract_text() or "").splitlines():
            line = re.sub(r"\s+", " ", raw).strip()
            if len(line) < 8:
                continue
            m = TOC.match(line) or TOC2.match(line)
            if not m:
                continue
            title = m.group(1).strip(" .…-")
            page_no = int(m.group(2))
            if not title or page_no == 0 or page_no > len(reader.pages) + 50:
                continue
            if re.fullmatch(r"[\d\s.\-]+", title):
                continue
            key = title.lower()
            if key in seen:
                continue
            seen.add(key)
            entries.append({"objective": match_objective(title, objs), "title": title, "page": page_no})

    if len(entries) < 20:
        outline = from_outline(reader, objs)
        if len(outline) > len(entries):
            entries = outline
            print("  (used the PDF outline; no printed page numbers in the contents)")
    return entries


def messer_sections(reader):
    entries, seen = [], set()
    for page in reader.pages[:12]:
        for raw in (page.extract_text() or "").splitlines():
            m = MESSER_LINE.match(raw.strip())
            if not m:
                continue
            title = m.group(2).strip()
            key = (m.group(1), title)
            if key in seen:
                continue
            seen.add(key)
            entries.append({"objective": MESSER_OVERRIDES.get(title, m.group(1)),
                            "title": title, "page": int(m.group(3))})
    return entries


def main(pdf_path, slug, display, layout):
    reader = PdfReader(pdf_path)
    entries = messer_sections(reader) if layout == "messer" else generic_sections(reader, load_objectives())
    unmapped = sum(1 for e in entries if not e["objective"])
    entries = [e for e in entries if e["objective"]]

    out = ROOT / "content" / "index" / f"{slug}.json"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps({
        "source": {
            "slug": slug,
            "title": display,
            "note": "Index only: section titles and page numbers, so the app can point at the user's own copy. No content reproduced.",
        },
        "sections": entries,
    }, indent=2, ensure_ascii=False) + "\n")

    covered = {e["objective"] for e in entries}
    print(f"{display}: indexed {len(entries)} sections -> {out.relative_to(ROOT)}")
    print(f"  mapped to {len(covered)}/28 objectives; {unmapped} unmapped sections dropped")


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("pdf")
    ap.add_argument("slug")
    ap.add_argument("title")
    ap.add_argument("--layout", choices=["generic", "messer"], default="generic")
    a = ap.parse_args()
    main(a.pdf, a.slug, a.title, a.layout)
