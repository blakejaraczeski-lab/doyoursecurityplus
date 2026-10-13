#!/usr/bin/env python3
"""Every number in the README comes from the content, not from memory.

The blocks between <!-- counts:start --> / <!-- counts:end --> and
<!-- thinnest:start --> / <!-- thinnest:end --> are generated here. Without
--write the script fails if the committed README differs from what the content
says; with --write it rewrites the blocks.
"""
import json, re, sys, pathlib
from collections import defaultdict

ROOT = pathlib.Path(__file__).resolve().parent.parent
README = ROOT / "README.md"


def counts():
    items = [it for f in sorted((ROOT / "content/items").glob("*.json")) for it in json.loads(f.read_text())]
    mentors = [m for f in sorted((ROOT / "content/mentor").glob("*.json")) for m in json.loads(f.read_text())]
    pbqs = [json.loads(f.read_text()) for f in sorted((ROOT / "content/pbq").glob("*.json"))]
    tax = json.loads((ROOT / "content/objectives.json").read_text())
    glossary = json.loads((ROOT / "content/glossary.json").read_text())
    edges = json.loads((ROOT / "content/graph/prerequisites.json").read_text())["edges"]
    units = defaultdict(int)
    for it in items:
        if it["type"] != "recall" and it.get("objective"):
            units[it["objective"]] += 1
    for p in pbqs:
        units[p["objective"]] += 1
    thinnest = sorted(units.items(), key=lambda kv: (kv[1], kv[0]))[:3]
    return {
        "domains": tax["counts"]["domains"], "objectives": tax["counts"]["objectives"], "topics": tax["counts"]["topics"],
        "misconceptions": len(mentors),
        "mcq": sum(1 for i in items if i["type"] == "mcq" and not i.get("source")),
        "multi": sum(1 for i in items if i["type"] == "mcq-multi"),
        "derived": sum(1 for i in items if i.get("source") == "derived-from-recall"),
        "recall": sum(1 for i in items if i["type"] == "recall"),
        "pbqs": len(pbqs), "engines": len({p["kind"] for p in pbqs}),
        "glossary": len(glossary), "edges": len(edges),
        "thinnest": thinnest,
    }


def blocks(c):
    counts_block = f"""| | |
|---|---|
| Objectives | {c['domains']} domains, {c['objectives']} objectives, {c['topics']} sub-topics from CompTIA's official objectives document, every one reached by a graded item |
| Misconceptions | {c['misconceptions']}, each with diagnosis, contrast table, rule of thumb, what to look for in the stem, and why the wrong answer looked right |
| Multiple choice | {c['mcq']} original items, every distractor mapped to a misconception |
| Multiple select | {c['multi']} "choose two/three" items, scored all or nothing like the exam |
| Derived discrimination | {c['derived']} generated from imported vocabulary: "which term is being described", with sibling terms as distractors |
| Recall vocabulary | {c['recall']} imported cards, served only when one out-ranks a graded question, and never more than about 12% |
| PBQs | {c['pbqs']} across {c['engines']} engines, graded per subtask with partial credit |
| Glossary | {c['glossary']} acronyms from CompTIA's own list, expanded inline wherever one appears in a question |
| Prerequisite edges | {c['edges']} authored dependencies between misconceptions, so the queue can route backward |"""
    thin = ", ".join(f"{o} ({n})" for o, n in c["thinnest"])
    thinnest_block = f"- Depth, not breadth. Every topic is reached; the thinnest objectives by graded units are {thin}."
    return {"counts": counts_block, "thinnest": thinnest_block}


def regenerate(text, generated):
    for name, body in generated.items():
        pat = re.compile(rf"(<!-- {name}:start[^>]*-->).*?(<!-- {name}:end -->)", re.S)
        if not pat.search(text):
            print(f"README.md has no <!-- {name}:start --> block")
            sys.exit(1)
        text = pat.sub(lambda m: m.group(1) + "\n" + body + "\n" + m.group(2), text)
    return text


if __name__ == "__main__":
    current = README.read_text()
    wanted = regenerate(current, blocks(counts()))
    if "--write" in sys.argv:
        README.write_text(wanted)
        print("README counts regenerated from content")
    elif wanted != current:
        print("README.md counts differ from the content. Run: python3 scripts/check_docs.py --write")
        sys.exit(1)
    else:
        print("README counts match the content")
