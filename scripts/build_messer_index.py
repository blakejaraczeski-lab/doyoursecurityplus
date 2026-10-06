#!/usr/bin/env python3
"""Build a page index for Professor Messer's SY0-701 Course Notes.

Usage: python3 scripts/build_messer_index.py "/path/to/messer course notes.pdf"

This stores ONLY the table of contents: section title, objective code and page
number. No content from the notes is copied. The result lets the app say
"review this in your own copy, page 47" next to a misconception you keep missing,
which turns a remediation card into a jump to material you already own.
"""
import json, re, sys, pathlib
from pypdf import PdfReader

ROOT = pathlib.Path(__file__).resolve().parent.parent
LINE = re.compile(r"^(\d\.\d)\s*[-–]\s*(.+?)\s+(\d{1,3})$")

# Messer files a few sections under a neighbouring objective. Map them back to
# the objective CompTIA actually lists them under, so coverage lines up.
OVERRIDES = {"Log Data": "4.9"}
DOMAIN = re.compile(r"^(\d)\.0\s*[-–]\s*(.+?)\s+(\d{1,3})$")


def main(pdf_path):
    reader = PdfReader(pdf_path)
    entries, domains = [], []
    for page in reader.pages[:12]:
        for raw in (page.extract_text() or "").splitlines():
            line = raw.strip()
            m = DOMAIN.match(line)
            if m:
                domains.append({"domain": m.group(1), "title": m.group(2).strip(),
                                "page": int(m.group(3))})
                continue
            m = LINE.match(line)
            if m:
                title = m.group(2).strip()
                entries.append({"objective": OVERRIDES.get(title, m.group(1)),
                                "title": title, "page": int(m.group(3)),
                                "printedUnder": m.group(1) if title in OVERRIDES else None})
        if len(entries) > 40 and "1.1" not in [e["objective"] for e in entries[-5:]]:
            pass

    # de-duplicate, keep first occurrence (the contents listing)
    seen, clean = set(), []
    for e in entries:
        key = (e["objective"], e["title"])
        if key in seen:
            continue
        seen.add(key)
        clean.append(e)

    doc = {
        "source": {
            "title": "Professor Messer's SY0-701 CompTIA Security+ Course Notes",
            "author": "James Messer",
            "note": "Index only. Section titles and page numbers, so the app can point at the user's own copy. No content reproduced.",
        },
        "domains": domains,
        "sections": clean,
    }
    out = ROOT / "content" / "index" / "messer-notes.json"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(doc, indent=2) + "\n")
    print(f"indexed {len(clean)} sections across {len(domains)} domains -> {out.relative_to(ROOT)}")
    by_obj = {}
    for e in clean:
        by_obj.setdefault(e["objective"], []).append(e["title"])
    missing = []
    tax = json.loads((ROOT / "content" / "objectives.json").read_text())
    for d in tax["domains"]:
        for o in d["objectives"]:
            if o["id"] not in by_obj:
                missing.append(o["id"])
    print(f"  objectives covered: {len(by_obj)}/28")
    if missing:
        print(f"  no section found for: {', '.join(missing)}")


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else
         "/Users/blakejaraczeski/Downloads/messer course notes.pdf")
