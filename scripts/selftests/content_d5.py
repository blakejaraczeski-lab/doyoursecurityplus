"""Self test scenario: content-d5. Run alone with python3 scripts/selftest.py content-d5.

Domain 5 content, the recall deck and the glossary, read straight from the JSON:
topic ids on the objective's own list, the 5.2 recovery and risk-reporting gaps
filled, recall converted to graded scenario items and cut, glossary gaps closed.
"""
import json, re
from selftest import ROOT, scenario

OFF_EXAM_RECALL = {"Salt", "Hypertext Transfer Protocol", "File Transfer Protocol", "Simple Mail Transfer Protocol",
                   "SYN Flood Attack", "Tunnel", "Packet Filtering Firewall", "Exceptions", "Structured Exception Handler",
                   "Representational State Transfer", "False Acceptance Rate", "Environmental Variables"}
GAP_TOPICS = ["key-risk-indicators", "risk-identification", "risk-threshold", "risk-reporting", "avoid", "probability",
              "likelihood", "recovery-time-objective", "recovery-point-objective", "mean-time-between-failures"]
GLOSSARY_NEEDS = ["KRI", "PCI DSS", "HIPAA", "RoE", "GRC", "CISO"]
NEW_MENTOR_IDS = {"kri-vs-kpi", "identification-vs-assessment", "inherent-vs-residual", "risk-register-and-owner",
                  "risk-reporting-audience", "rules-of-engagement-scope", "pentest-activity-types"}
# A cross-objective tag is allowed only where this item is the bank's sole graded coverage of a topic in another
# objective (the blueprint-coverage check in selftest/30-readiness.js would otherwise lose it).
CROSS_OBJECTIVE = {("g-008", "insurance")}
MAX_RECALL_LEFT = 8      # kept only because 40-scheduler.js and 50-expected-points.js need at least one card


def load(path):
    return json.loads((ROOT / path).read_text())


@scenario("content-d5", order=215, browser=False)
def scenario_content_d5(rep, tmp):
    tax = load("content/objectives.json")
    lists = {o["id"]: {t["id"] for t in o["topics"]} for d in tax["domains"] for o in d["objectives"]}
    items = [it for f in sorted((ROOT / "content/items").glob("*.json")) for it in load(f.relative_to(ROOT))]
    d5 = [it for it in items if it.get("objective", "").startswith("5.") and it["type"] != "recall"]
    graded5 = [it for it in d5 if it["type"] in ("mcq", "mcq-multi")]

    rep.head("Domain 5 topic ids are on the objective's own list")
    bad = [(it["id"], t) for it in d5 for t in it.get("topics", []) if t not in lists[it["objective"]] and (it["id"], t) not in CROSS_OBJECTIVE]
    rep.check(not bad, f"every topic on {len(d5)} domain 5 items is on its objective's list", f"{bad[:8]}")
    mentors = [m for f in sorted((ROOT / "content/mentor").glob("5.*.json")) for m in load(f.relative_to(ROOT))]
    badm = [(m["id"], t) for m in mentors for t in m.get("topics", []) if t not in lists[m["objective"]]]
    rep.check(not badm, f"every topic on {len(mentors)} domain 5 corrections is on its objective's list", f"{badm[:8]}")

    rep.head("5.2 recovery and risk-reporting gaps")
    count = {t: sum(1 for it in graded5 if it["objective"] == "5.2" and t in it.get("topics", [])) for t in GAP_TOPICS}
    thin = {t: n for t, n in count.items() if n < 3}
    rep.check(not thin, "each gap topic has at least 3 graded items", f"thin: {thin}")

    rep.head("Recall: converted to graded items, then cut")
    recall = [it for it in items if it["type"] == "recall"]
    rep.check(len(recall) <= MAX_RECALL_LEFT, f"{len(recall)} recall cards left (at most {MAX_RECALL_LEFT})")
    left = {it["term"] for it in recall}
    rep.check(not (left & OFF_EXAM_RECALL), "no off-exam term (HTTP, FTP, Salt, Tunnel ...) is filed as recall",
              f"{sorted(left & OFF_EXAM_RECALL)}")
    badr = [(it["id"], t) for it in recall for t in it.get("topics", []) if t not in lists[it["objective"]] and (it["id"], t) not in CROSS_OBJECTIVE]
    rep.check(not badr, "every recall card's topics are on its objective's list", f"{badr[:6]}")
    derived = {it["id"] for it in items if it.get("source") == "derived-from-recall"}
    sources = {it["sourceItem"] for it in items if it.get("source") == "derived-from-recall"}
    rep.check(not (sources & {it["id"] for it in recall}), "no card is both converted and still served as recall")
    rep.check(len(derived) >= 90, f"{len(derived)} derived items (82 before the conversion)")
    scen = [it for it in graded5 if it["id"].startswith("r5-")]
    rep.check(len(scen) >= 25, f"{len(scen)} hand written domain 5 scenario items converted from recall and the gaps")

    rep.head("New items are fair and keep the house rules")
    keys = [next(i for i, o in enumerate(it["options"]) if o.get("correct")) for it in scen if it["type"] == "mcq"]
    rep.check(len(set(keys)) == 4 and max(keys.count(k) for k in set(keys)) <= len(keys) * 0.4,
              "the key sits in all four positions, none above 40 percent", f"{[keys.count(k) for k in range(4)]}")
    longest = sum(1 for it in scen if it["type"] == "mcq"
                  and max(it["options"], key=lambda o: len(o["text"])).get("correct")
                  and sorted(len(o["text"]) for o in it["options"])[-1] > sorted(len(o["text"]) for o in it["options"])[-2])
    rep.check(longest <= len(scen) * 0.4, f"the key is strictly the longest option in {longest} of {len(scen)} (at most 40 percent)")
    texts = json.dumps([scen, load("content/mentor/5.2.json")], ensure_ascii=False)
    rep.check("–" not in texts and "—" not in texts, "no en or em dash in the new items or 5.2 corrections")
    brit = re.findall(r"\b(organis\w+|programme\w*|behaviour\w*|centre\w*|licence\w*|annualised|recognis\w+|minimis\w+)\b",
                      json.dumps([scen, [m for m in mentors if m["id"] in NEW_MENTOR_IDS]], ensure_ascii=False), re.I)
    rep.check(not brit, "the new items use American spelling", f"{brit[:6]}")
    rep.check(all(o.get("why") for it in scen for o in it["options"]), "every option of every new item says why")

    rep.head("Glossary")
    glossary = load("content/glossary.json")
    missing = [a for a in GLOSSARY_NEEDS if a not in glossary]
    rep.check(not missing, "KRI, PCI DSS, HIPAA, RoE, GRC and CISO are in the glossary", f"missing {missing}")
