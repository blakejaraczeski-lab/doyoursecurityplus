#!/usr/bin/env python3
"""Import an Anki .apkg into the item bank as recall items, auto-tagged to the
SY0-701 objective taxonomy.

Usage: python3 scripts/import_anki.py /path/to/deck.apkg

Anki notes are term/definition pairs. They are imported as `recall` items, which
are a separate type from `mcq`: no distractors, so no misconception mapping.
They carry vocabulary. The MCQ and PBQ banks carry the discrimination practice.
"""
import sqlite3, zipfile, tempfile, json, re, html, sys, pathlib, os
from collections import Counter

ROOT = pathlib.Path(__file__).resolve().parent.parent
STOP = set("""the a an and or of to in for with on is are be by as at from that this
it its not no all any can may must should which what when who how use used using
other others into than then only more most such via per within without between""".split())


def clean(s: str) -> str:
    s = re.sub(r"\[sound:[^\]]*\]", " ", s)
    s = re.sub(r"<br\s*/?>", " ", s, flags=re.I)
    s = re.sub(r"<[^>]+>", " ", s)
    s = html.unescape(s)
    return re.sub(r"\s+", " ", s).strip()


def words(s: str):
    return [w for w in re.findall(r"[a-z0-9]+", s.lower()) if w not in STOP and len(w) > 2]


def load_taxonomy():
    doc = json.loads((ROOT / "content" / "objectives.json").read_text())
    topics = []
    for d in doc["domains"]:
        for o in d["objectives"]:
            for t in o["topics"]:
                label = t["label"]
                acro = re.findall(r"\(([A-Za-z0-9/\.\-\+ ]{2,12})\)", label)
                base = re.sub(r"\([^)]*\)", " ", label)
                topics.append({
                    "topic": t["id"], "objective": o["id"], "domain": d["id"],
                    "label": label,
                    "terms": set(words(base)),
                    "acronyms": {a.strip().lower() for a in acro if a.strip()},
                })
    return doc, topics


def tag(text: str, topics):
    """Score every topic against the note text, return the best objective plus
    the topics that matched. Acronym hits are weighted heavily because an exact
    acronym match is a near certain signal."""
    toks = set(words(text))
    raw = text.lower()
    scored = []
    for t in topics:
        if not t["terms"] and not t["acronyms"]:
            continue
        hits = t["terms"] & toks
        score = 0.0
        if t["terms"]:
            score = len(hits) / len(t["terms"])
            # full phrase present in order is a much stronger signal
            phrase = re.sub(r"\([^)]*\)", "", t["label"]).strip().lower()
            if len(phrase) > 4 and phrase in raw:
                score += 1.0
        for a in t["acronyms"]:
            if re.search(rf"\b{re.escape(a)}\b", raw):
                score += 1.2
        if score >= 0.6:
            scored.append((score, t))
    if not scored:
        return None, [], 0.0
    scored.sort(key=lambda x: -x[0])
    best = scored[0]
    votes = Counter()
    for s, t in scored[:8]:
        votes[t["objective"]] += s
    objective = votes.most_common(1)[0][0]
    matched = [t["topic"] for s, t in scored[:5] if t["objective"] == objective]
    return objective, matched or [best[1]["topic"]], round(best[0], 2)


def main(apkg):
    doc, topics = load_taxonomy()
    with tempfile.TemporaryDirectory() as tmp:
        with zipfile.ZipFile(apkg) as z:
            z.extractall(tmp)
        db = None
        for name in ("collection.anki21b", "collection.anki21", "collection.anki2"):
            p = os.path.join(tmp, name)
            if os.path.exists(p):
                con = sqlite3.connect(p)
                n = con.execute("select count(*) from notes").fetchone()[0]
                if db is None or n > db[1]:
                    db = (p, n)
                con.close()
        if not db:
            sys.exit("no Anki collection found inside the package")
        con = sqlite3.connect(db[0])
        rows = list(con.execute("select id, flds from notes"))

    items, untagged, seen = [], 0, set()
    for nid, flds in rows:
        parts = [clean(p) for p in flds.split("\x1f")]
        front = parts[0] if parts else ""
        back = next((p for p in parts[1:] if p), "")
        extra = [p for p in parts[2:] if p]
        if not front or not back:
            continue
        key = front.lower()
        if key in seen:
            continue
        seen.add(key)
        objective, matched, conf = tag(f"{front} {back} {' '.join(extra)}", topics)
        # A card the tagger cannot place has no objective, and the scheduler
        # requires one: pickNewItems filters on `it.objective || isAcronym(it)`
        # and buildMock takes only type "mcq". An untagged recall card is
        # therefore reachable by no code path. Dropping it at import is the
        # honest version of what the app was already doing silently.
        if objective is None:
            untagged += 1
            continue
        items.append({
            "id": f"anki-{nid}",
            "type": "recall",
            "source": "anki-import",
            "objective": objective,
            "topics": matched,
            "difficulty": 2,
            "term": front,
            "definition": back,
            "aka": extra[0] if extra else None,
        })

    out = ROOT / "content" / "items" / "anki-imported.json"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(items, indent=2) + "\n")

    by_obj = Counter(i["objective"] for i in items if i["objective"])
    print(f"imported {len(items)} recall items from {pathlib.Path(apkg).name}")
    print(f"  auto-tagged: {len(items)}   dropped as untaggable: {untagged}")
    print(f"  wrote {out.relative_to(ROOT)}")
    print("  per domain:")
    dom = Counter(o.split(".")[0] for o in by_obj.elements())
    for d in doc["domains"]:
        print(f"    {d['id']}.0 {d['title']:<45} {dom.get(d['id'], 0):4d} items  "
              f"(exam weight {d['weight']:.0%})")
    thin = [(o["id"], by_obj.get(o["id"], 0)) for d in doc["domains"] for o in d["objectives"]]
    empty = [o for o, n in thin if n == 0]
    if empty:
        print(f"  objectives with zero imported items ({len(empty)}): {', '.join(empty)}")


if __name__ == "__main__":
    if len(sys.argv) < 2:
        sys.exit("usage: import_anki.py <deck.apkg>")
    main(sys.argv[1])
