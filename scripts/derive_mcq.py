#!/usr/bin/env python3
"""Turn imported vocabulary into exam-shaped discrimination questions.

Why this exists
---------------
The SY0-701 exam is multiple choice (single and multiple select) plus PBQs.
There is no free-text question: you never type a definition. A term/definition
flashcard that you reveal and grade yourself therefore trains the wrong
operation twice over:

  1. It is RECOGNITION, not discrimination. The exam never asks "what is a warm
     site", it offers you hot, warm and cold and makes you separate them.
  2. Self-grading invites the fluency illusion. You read the answer, it feels
     familiar, you press Good, and you have learned nothing.

This script keeps the vocabulary and changes the operation. Each card becomes a
four-option question whose distractors are the SIBLING TERMS most likely to be
confused with it, drawn from the same objective. A wrong answer is told exactly
which term it actually picked, which is the correction that matters.

Usage: python3 scripts/derive_mcq.py [--target 250]
"""
import json, re, random, argparse, pathlib
from collections import defaultdict

ROOT = pathlib.Path(__file__).resolve().parent.parent
SRC = ROOT / "content" / "items" / "recall.json"
OUT_ITEMS = ROOT / "content" / "items" / "derived.json"
OUT_MENTOR = ROOT / "content" / "mentor" / "terminology.json"

MIN_DEF_WORDS = 7          # anything shorter cannot carry a fair question
# Near-siblings are what make a question instructive: hot vs warm vs cold site
# overlap heavily in wording and are not remotely ambiguous, because the
# description names the attribute that separates them. So the cap is set high,
# and only catches definitions that are effectively the same concept twice.
MAX_OVERLAP = 0.72
# ...and a floor on the CLOSEST distractor. A term drawn from the same objective
# is not automatically plausible: the imported deck was auto-tagged, so a pool
# can hold genuinely unrelated terms. Offering "Custodian" against "Perfect
# Forward Secrecy" is not a discrimination question, it is a free mark.
#
# Requiring all three distractors to clear a floor throws away most of the bank,
# so the rule is that at least ONE must be a real neighbour. That matches how
# exam items are actually built: one strong distractor and two weaker ones.
MIN_CLOSEST_OVERLAP = 0.08
STOP = set("""the a an and or of to in for with on is are be by as at from that this it its
not no all any can may must should which what when who how use used using other into than
then only more most such via per within without between also may""".split())


def words(s):
    return {w for w in re.findall(r"[a-z0-9]+", s.lower()) if w not in STOP and len(w) > 2}


def jaccard(a, b):
    if not a or not b:
        return 0.0
    return len(a & b) / len(a | b)


def gives_itself_away(term, definition):
    """A definition containing its own term makes the question free."""
    t = term.lower().strip()
    d = definition.lower()
    if t and t in d:
        return True
    # also catch the head noun of a multi-word term, e.g. "Hot Site" -> "site"
    parts = [p for p in re.findall(r"[a-z]+", t) if p not in STOP and len(p) > 3]
    return any(re.search(rf"\b{re.escape(p)}\b", d) for p in parts[-1:]) if len(parts) > 1 else False


def _norm(text):
    """Normalise a term for exact comparison: drop parentheticals, punctuation
    and a trailing plural. Nothing fuzzier than that."""
    text = re.sub(r"\([^)]*\)", " ", text).lower()
    toks = []
    for w in re.findall(r"[a-z0-9]+", text):
        if w.endswith("ies") and len(w) > 4:
            w = w[:-3] + "y"
        elif w.endswith("s") and not w.endswith("ss") and len(w) > 3:
            w = w[:-1]
        toks.append(w)
    return " ".join(toks)


def official_vocabulary():
    """Every term CompTIA's own objectives document actually names, mapped to the
    objective that names it.

    This replaces the auto-tagger for anything that becomes a question. The
    tagger scores word overlap, which put 'Governance Committee' in change
    management and 'Security Identifier' in vulnerabilities. Worse, a fuzzy
    lookup against the official list is no better: matching on a single shared
    word sends 'Public Key' to data classification because 3.3 contains the
    word 'Public'.

    So the rule is exact match only, on the whole label or a whole acronym. It
    rejects a lot. Everything it accepts is placed where the blueprint places
    it, which is the only claim worth making about a study bank.
    """
    tax = json.loads((ROOT / "content" / "objectives.json").read_text())
    vocab = {}
    for d in tax["domains"]:
        for o in d["objectives"]:
            for t in o["topics"]:
                vocab.setdefault(_norm(t["label"]), o["id"])
                for a in re.findall(r"\(([A-Za-z0-9/\.\-\+ ]{2,14})\)", t["label"]):
                    key = _norm(a)
                    if len(key) >= 2:
                        vocab.setdefault(key, o["id"])
    return vocab


def load():
    items = json.loads(SRC.read_text())
    tax = json.loads((ROOT / "content" / "objectives.json").read_text())
    weights, objectives_in_domain, obj_title = {}, defaultdict(int), {}
    for d in tax["domains"]:
        for o in d["objectives"]:
            weights[o["id"]] = d["weight"]
            objectives_in_domain[d["id"]] += 1
            obj_title[o["id"]] = o["title"]
    per_obj_share = {
        oid: weights[oid] / objectives_in_domain[oid.split(".")[0]] for oid in weights
    }
    return items, per_obj_share, obj_title


def build(target_total):
    items, share, obj_title = load()
    vocab = official_vocabulary()
    rng = random.Random(20260922)
    off_syllabus = retagged = 0

    usable = defaultdict(list)
    for it in items:
        d = (it.get("definition") or "").strip()
        t = (it.get("term") or "").strip()
        if len(d.split()) < MIN_DEF_WORDS or not t:
            continue
        if gives_itself_away(t, d):
            continue
        # The objective comes from the blueprint, never from the tagger. A term
        # the blueprint does not name is not on this exam, so it does not become
        # a question no matter how good the card is.
        oid = vocab.get(_norm(t))
        if oid is None:
            off_syllabus += 1
            continue
        if oid != it.get("objective"):
            retagged += 1
        usable[oid].append({**it, "objective": oid, "_w": words(d)})

    derived, skipped_thin, weak = [], 0, 0
    for oid, pool in sorted(usable.items()):
        if len(pool) < 4:
            skipped_thin += len(pool)
            continue
        quota = max(3, round(target_total * share.get(oid, 0.01)))
        # Prefer the most distinctive definitions: they make the fairest
        # questions. Walk the whole pool rather than slicing to the quota first,
        # so a candidate rejected for having no near-neighbour is replaced rather
        # than simply lost.
        pool.sort(key=lambda x: -len(x["_w"]))
        made = 0

        for it in pool:
            if made >= quota:
                break
            siblings = [
                s for s in pool
                if s["id"] != it["id"]
                and jaccard(s["_w"], it["_w"]) < MAX_OVERLAP
                and s["term"].lower() not in it["term"].lower()
                and it["term"].lower() not in s["term"].lower()
            ]
            if len(siblings) < 3:
                continue
            # Closest-but-still-distinct siblings are the most instructive distractors:
            # shared topic tags first, then definition similarity just under the cap.
            shared = set(it.get("topics") or [])
            # Most confusable first: the closest neighbour is the one worth
            # being able to rule out under time pressure.
            siblings.sort(
                key=lambda s: -(jaccard(s["_w"], it["_w"]) + 0.15 * len(shared & set(s.get("topics") or [])))
            )
            picks = siblings[:3]
            if jaccard(picks[0]["_w"], it["_w"]) < MIN_CLOSEST_OVERLAP:
                weak += 1
                continue

            opts = [{"term": it["term"], "definition": it["definition"], "correct": True}] + [
                {"term": s["term"], "definition": s["definition"], "correct": False} for s in picks
            ]
            r = random.Random(f"{it['id']}-order")
            r.shuffle(opts)

            options = []
            for i, o in enumerate(opts):
                # `definition` travels with the option so the mentor card can build
                # a real side-by-side from what you actually picked, without
                # parsing it back out of the prose.
                entry = {
                    "id": "abcd"[i],
                    "text": o["term"],
                    "definition": o["definition"].rstrip("."),
                }
                if o["correct"]:
                    entry["correct"] = True
                    entry["why"] = f"{o['term']} is the term for this."
                else:
                    entry["misconception"] = f"terminology-{oid.replace('.', '-')}"
                    entry["why"] = f"That is {o['term']}: {o['definition'].rstrip('.')}."
                options.append(entry)

            made += 1
            derived.append({
                "id": f"d-{it['id'].replace('anki-', '')}",
                "type": "mcq",
                "source": "derived-from-recall",
                "sourceItem": it["id"],
                "objective": oid,
                **({"topics": it["topics"]} if it.get("topics") else {}),
                "difficulty": 2,
                "stem": f"Which term is being described?\n\n“{it['definition'].rstrip('.')}”",
                "options": options,
            })

    # --- one terminology misconception per objective that produced questions ---
    mentors = []
    for oid in sorted({d["objective"] for d in derived}):
        # No static contrast table here. The terms in an objective are not a
        # family just because they share an auto-assigned tag, and a table of
        # unrelated definitions under the heading "what separates it" teaches
        # nothing. The card builds its table at read time from the pairs this
        # user has actually confused. See mentor.js.
        mentors.append({
            "id": f"terminology-{oid.replace('.', '-')}",
            "label": f"Confusing neighbouring terms in {oid}",
            "objective": oid,
            "severity": "medium",
            "mentor": {
                "diagnosis": (
                    f"You picked a term that belongs to a neighbour of the one described. "
                    f"Objective {oid} ({obj_title.get(oid, '')}) contains families of terms that "
                    f"sound interchangeable and are separated by one attribute each."
                ),
                "contrast": [],
                "rule": (
                    "When two terms in the same family feel interchangeable, do not memorise both "
                    "definitions. Find the single attribute the exam uses to tell them apart, and "
                    "learn that attribute."
                ),
                "tell": (
                    "The exam rarely asks you to define a term. It gives you a scenario and offers "
                    "you the whole family, so the only thing that earns the mark is the difference."
                ),
                "trap": (
                    "Reading a definition and recognising it feels like knowing it. Recognition is "
                    "much easier than discrimination, which is why a flashcard you reveal to "
                    "yourself overstates how ready you are."
                ),
            },
        })

    OUT_ITEMS.write_text(json.dumps(derived, indent=2) + "\n")
    OUT_MENTOR.write_text(json.dumps(mentors, indent=2) + "\n")

    by_obj = defaultdict(int)
    for d in derived:
        by_obj[d["objective"]] += 1
    print(f"derived {len(derived)} discrimination questions from {len(items)} recall cards")
    print(f"  across {len(by_obj)} objectives, quota weighted by exam weight")
    print(f"  wrote {OUT_ITEMS.relative_to(ROOT)}")
    print(f"  wrote {OUT_MENTOR.relative_to(ROOT)} ({len(mentors)} terminology misconceptions)")
    print(f"  rejected, term not named in the official objectives: {off_syllabus}")
    print(f"  re-tagged from the auto-tagger to the blueprint objective: {retagged}")
    print(f"  skipped, no plausible near-neighbour to offer: {weak}")
    print(f"  recall cards left as vocabulary only: {len(items) - len(derived)}")


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--target", type=int, default=250)
    build(ap.parse_args().target)
