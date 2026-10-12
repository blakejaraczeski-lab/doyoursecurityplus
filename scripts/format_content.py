#!/usr/bin/env python3
"""Rewrite every item and mentor file in one canonical shape.

Same keys in the same order in every record, defaults left out, one option or
contrast row per line. Run after any content edit so the files stay legible
and a diff shows the change rather than the formatting.
"""
import json, pathlib

ROOT = pathlib.Path(__file__).resolve().parent.parent
ITEM_KEYS = ["id", "type", "source", "sourceItem", "objective", "topics", "difficulty",
             "stem", "options", "selectCount", "term", "definition", "aka"]
OPTION_KEYS = ["id", "text", "correct", "misconception", "missedMisconception", "definition", "why"]
MENTOR_KEYS = ["id", "label", "objective", "topics", "severity", "retireAfter", "mentor"]
GUIDE_KEYS = ["diagnosis", "contrast", "rule", "tell", "trap"]


def ordered(d, keys):
    out = {k: d[k] for k in keys if k in d}
    out.update({k: v for k, v in d.items() if k not in out})
    return out


def dumps(v):
    return json.dumps(v, ensure_ascii=False)


def clean_item(it):
    it = dict(it)
    it.pop("derived", None)                      # implied by `source`
    if it.get("type") != "mcq-multi":
        it.pop("selectCount", None)              # 1 is the default
    if not it.get("topics"):
        it.pop("topics", None)
    if not it.get("aka"):
        it.pop("aka", None)
    if "options" in it:
        it["options"] = [ordered(o, OPTION_KEYS) for o in it["options"]]
    return ordered(it, ITEM_KEYS)


def clean_mentor(m):
    m = dict(m)
    if not m.get("topics"):
        m.pop("topics", None)
    if m.get("retireAfter") == 2:
        m.pop("retireAfter", None)               # the default
    m["mentor"] = ordered(m.get("mentor", {}), GUIDE_KEYS)
    return ordered(m, MENTOR_KEYS)


def fmt_record(rec, pad="  "):
    """indent-2 JSON, except that options and contrast rows stay on one line."""
    lines = [pad + "{"]
    keys = list(rec)
    for i, k in enumerate(keys):
        v = rec[k]
        comma = "," if i < len(keys) - 1 else ""
        if k == "options":
            body = ",\n".join(f"{pad}    {dumps(o)}" for o in v)
            lines.append(f'{pad}  "options": [\n{body}\n{pad}  ]{comma}')
        elif k == "mentor":
            g = []
            gkeys = list(v)
            for j, gk in enumerate(gkeys):
                gc = "," if j < len(gkeys) - 1 else ""
                if gk == "contrast" and v[gk]:
                    rows = ",\n".join(f"{pad}      {dumps(r)}" for r in v[gk])
                    g.append(f'{pad}    "contrast": [\n{rows}\n{pad}    ]{gc}')
                else:
                    g.append(f'{pad}    {dumps(gk)}: {dumps(v[gk])}{gc}')
            lines.append(f'{pad}  "mentor": {{\n' + "\n".join(g) + f"\n{pad}  }}{comma}")
        else:
            lines.append(f"{pad}  {dumps(k)}: {dumps(v)}{comma}")
    lines.append(pad + "}")
    return "\n".join(lines)


def write(path, records):
    body = ",\n".join(fmt_record(r) for r in records)
    path.write_text("[\n" + body + "\n]\n")


def main():
    n_items = n_mentor = 0
    for f in sorted((ROOT / "content" / "items").glob("*.json")):
        recs = [clean_item(it) for it in json.loads(f.read_text())]
        write(f, recs)
        n_items += len(recs)
    for f in sorted((ROOT / "content" / "mentor").glob("*.json")):
        recs = [clean_mentor(m) for m in json.loads(f.read_text())]
        write(f, recs)
        n_mentor += len(recs)
    print(f"formatted {n_items} items and {n_mentor} misconceptions")


if __name__ == "__main__":
    main()
