#!/usr/bin/env python3
"""Validate the content bank. Run after any content edit.

Enforces the rules in docs/CONTENT-SCHEMA.md, most importantly: every wrong MCQ
option and every PBQ subtask must name a misconception that exists. A distractor
without one is wasted teaching surface, and a dangling reference means the mentor
engine silently drops the correction.
"""
import json, glob, sys, pathlib
from collections import defaultdict

ROOT = pathlib.Path(__file__).resolve().parent.parent
errors, warnings = [], []


def err(m): errors.append(m)
def warn(m): warnings.append(m)


def _ip(a):
    return int.from_bytes(bytes(int(o) for o in a.split(".")), "big")


def _addr_match(rule_addr, ip):
    if not rule_addr or rule_addr == "any":
        return True
    if "/" in rule_addr:
        net, bits = rule_addr.split("/")
        bits = int(bits)
        if bits == 0:
            return True
        mask = (0xFFFFFFFF << (32 - bits)) & 0xFFFFFFFF
        return (_ip(net) & mask) == (_ip(ip) & mask)
    return rule_addr == ip


def _val_match(rv, pv):
    return not rv or rv == "any" or str(rv) == str(pv)


def _addr_covers(a, b):
    """Is address spec `a` at least as broad as address spec `b`?
    Mirrors addrCovers() in app/grade/acl.js. Unlike _addr_match, the second
    argument may itself be a CIDR block rather than a single host."""
    if a == "any":
        return True
    if a == b:
        return True
    if "/" in a and "/" not in b:
        return _addr_match(a, b)
    if "/" in a and "/" in b:
        a_bits = int(a.split("/")[1])
        b_bits = int(b.split("/")[1])
        return a_bits <= b_bits and _addr_match(a, b.split("/")[0])
    return False


def _evaluate(rules, pkt):
    """Mirror of app/grade/acl.js evaluate(): first match wins, implicit deny."""
    for i, r in enumerate(rules):
        if (_val_match(r.get("protocol"), pkt["protocol"])
                and _addr_match(r.get("src"), pkt["src"])
                and _val_match(r.get("srcPort"), pkt["srcPort"])
                and _addr_match(r.get("dst"), pkt["dst"])
                and _val_match(r.get("dstPort"), pkt["dstPort"])):
            return r["action"], i
    return "deny", -1


def verify_references(pbqs):
    """A PBQ whose own reference answer does not score full marks is a broken
    PBQ: either the answer or the test cases are wrong. This is the check that
    catches an unsatisfiable requirement."""
    for p in pbqs:
        if p["kind"] == "acl-table":
            ref = p["solution"].get("reference")
            if not ref:
                warn(f"{p['id']}: no reference rule list, cannot self-verify")
                continue
            for tc in p["solution"]["testCases"]:
                got, idx = _evaluate(ref, tc["packet"])
                if got != tc["expect"]:
                    err(f"{p['id']}/{tc['id']}: reference answer yields '{got}' but the "
                        f"test expects '{tc['expect']}' ({tc['label'][:60]}). The test case "
                        f"is unsatisfiable alongside the other requirements.")
            last = ref[-1]
            for ck in p["solution"]["checks"]:
                if ck["type"] == "explicit-deny-last" and not (
                        last["action"] == "deny" and last["src"] == "any" and last["dst"] == "any"):
                    err(f"{p['id']}: reference answer fails its own explicit-deny-last check")
                if ck["type"] == "no-permit-any-any" and any(
                        r["action"] == "permit" and r["src"] == "any" and r["dst"] == "any"
                        and r.get("dstPort", "any") == "any" for r in ref):
                    err(f"{p['id']}: reference answer fails its own no-permit-any-any check")
                if ck["type"] == "source-not-broad":
                    for r in ref:
                        if (r["action"] == "permit"
                                and _addr_covers(r["dst"], ck["match"]["dst"])
                                and _val_match(r.get("dstPort"), ck["match"]["dstPort"])
                                and r["src"] not in ck["allowedSources"]):
                            err(f"{p['id']}: reference answer fails its own least privilege check "
                                f"(source {r['src']})")

        elif p["kind"] == "wireless-config":
            opts = {f["id"]: {o["value"] for o in f.get("options", [])}
                    for f in p["config"]["fields"]}
            for fid, spec in p["solution"].get("fields", {}).items():
                for v in spec.get("accept", []):
                    if opts.get(fid) and v not in opts[fid]:
                        err(f"{p['id']}: solution for '{fid}' accepts '{v}', "
                            f"which is not one of its options")

        elif p["kind"] == "drag-order":
            if p["config"]["mode"] == "sequence":
                if len(p["solution"].get("order", [])) != len(p["config"]["items"]):
                    err(f"{p['id']}: reference order does not place every item")
            elif len(p["solution"].get("placements", {})) != len(p["config"]["items"]):
                err(f"{p['id']}: reference placements do not cover every item")

        elif p["kind"] == "network-diagram":
            tasks = {t["id"]: t for t in p["config"]["tasks"]}
            for tid, ans in p["solution"].items():
                t = tasks.get(tid)
                if not t:
                    err(f"{p['id']}: solution references unknown task '{tid}'")
                elif t["type"] == "choice":
                    vals = {o["value"] for o in t["options"]}
                    if ans not in vals:
                        err(f"{p['id']}/{tid}: solution '{ans}' is not an available option")


def main():
    tax = json.loads((ROOT / "content" / "objectives.json").read_text())
    objectives = {o["id"] for d in tax["domains"] for o in d["objectives"]}
    # `topics` accepts alias spellings too, but `topic_count` is the real number
    # of distinct sub-topics in the taxonomy.
    topics, topic_count = set(), 0
    for d in tax["domains"]:
        for o in d["objectives"]:
            for t in o["topics"]:
                topic_count += 1
                topics.add(t["id"])
                topics.update(t.get("aliases", []))
    domain_of = {o["id"]: d["id"] for d in tax["domains"] for o in d["objectives"]}
    weights = {d["id"]: d["weight"] for d in tax["domains"]}

    # --- misconceptions ---
    mis = {}
    for f in sorted(glob.glob(str(ROOT / "content/mentor/*.json"))):
        for m in json.loads(pathlib.Path(f).read_text()):
            name = pathlib.Path(f).name
            if m["id"] in mis:
                err(f"duplicate misconception id {m['id']} in {name}")
            mis[m["id"]] = m
            if m.get("objective") not in objectives:
                err(f"{m['id']}: unknown objective {m.get('objective')}")
            for t in m.get("topics", []):
                if t not in topics:
                    warn(f"{m['id']}: unknown topic tag '{t}'")
            mt = m.get("mentor", {})
            for k in ("diagnosis", "rule", "tell"):
                if not mt.get(k):
                    err(f"{m['id']}: mentor.{k} is missing")
            if m.get("severity") not in ("high", "medium", "low"):
                err(f"{m['id']}: severity must be high, medium or low")
            rows = mt.get("contrast") or []
            widths = {len(r) for r in rows}
            if len(widths) > 1:
                err(f"{m['id']}: contrast table rows have inconsistent column counts {sorted(widths)}")

    # --- items ---
    items, ids = [], set()
    for f in sorted(glob.glob(str(ROOT / "content/items/*.json"))):
        for it in json.loads(pathlib.Path(f).read_text()):
            if it["id"] in ids:
                err(f"duplicate item id {it['id']}")
            ids.add(it["id"])
            items.append(it)
            if it.get("objective") and it["objective"] not in objectives:
                err(f"{it['id']}: unknown objective {it['objective']}")
            if it["type"] in ("mcq", "mcq-multi"):
                opts = it.get("options", [])
                correct = [o for o in opts if o.get("correct")]
                want = it.get("selectCount", 1) if it["type"] == "mcq-multi" else 1
                if it["type"] == "mcq-multi" and want < 2:
                    err(f"{it['id']}: mcq-multi needs selectCount >= 2")
                if len(correct) != want:
                    err(f"{it['id']}: selectCount {want} but {len(correct)} options marked correct")
                if len(opts) < 3:
                    err(f"{it['id']}: only {len(opts)} options")
                for o in opts:
                    if not o.get("why"):
                        err(f"{it['id']}/{o.get('id')}: missing 'why'")
                    if not o.get("correct"):
                        if not o.get("misconception"):
                            err(f"{it['id']}/{o.get('id')}: distractor has no misconception")
                        elif o["misconception"] not in mis:
                            err(f"{it['id']}/{o.get('id')}: unknown misconception '{o['misconception']}'")
            elif it["type"] == "recall":
                if not it.get("term") or not it.get("definition"):
                    err(f"{it['id']}: recall item missing term or definition")

    # --- pbqs ---
    pbqs = []
    kinds = {"wireless-config", "acl-table", "network-diagram", "drag-order"}
    for f in sorted(glob.glob(str(ROOT / "content/pbq/*.json"))):
        p = json.loads(pathlib.Path(f).read_text())
        pbqs.append(p)
        if p["kind"] not in kinds:
            err(f"{p['id']}: no grader for kind '{p['kind']}'")
        if p.get("objective") not in objectives:
            err(f"{p['id']}: unknown objective {p.get('objective')}")
        for s in p.get("subtasks", []):
            if s.get("misconception") and s["misconception"] not in mis:
                err(f"{p['id']}/{s['id']}: unknown misconception '{s['misconception']}'")
            if not s.get("points"):
                err(f"{p['id']}/{s['id']}: subtask has no points")
        sol = p.get("solution", {})
        if p["kind"] == "wireless-config":
            fields = {fl["id"] for fl in p["config"]["fields"]}
            for s in p["subtasks"]:
                if s["field"] not in fields:
                    err(f"{p['id']}/{s['id']}: references unknown field '{s['field']}'")
            for fid in sol.get("fields", {}):
                if fid not in fields:
                    err(f"{p['id']}: solution names unknown field '{fid}'")
        if p["kind"] == "acl-table":
            for t in sol.get("testCases", []) + sol.get("checks", []):
                if t.get("misconception") and t["misconception"] not in mis:
                    err(f"{p['id']}/{t['id']}: unknown misconception '{t['misconception']}'")
            if not sol.get("testCases"):
                err(f"{p['id']}: acl-table PBQ has no traffic test cases")
        if p["kind"] == "drag-order":
            ids = {i["id"] for i in p["config"]["items"]}
            if p["config"]["mode"] == "sequence":
                order = sol.get("order", [])
                if set(order) != ids:
                    err(f"{p['id']}: solution order must cover exactly the item set")
                if len(order) != len(set(order)):
                    err(f"{p['id']}: solution order repeats an item")
            else:
                buckets = {b["id"] for b in p["config"].get("buckets", [])}
                for item, b in sol.get("placements", {}).items():
                    if item not in ids:
                        err(f"{p['id']}: placement names unknown item '{item}'")
                    if b not in buckets:
                        err(f"{p['id']}: placement names unknown bucket '{b}'")
                if set(sol.get("placements", {})) != ids:
                    err(f"{p['id']}: every item needs a placement in the solution")
            for st in p["subtasks"]:
                if st.get("item") not in ids:
                    err(f"{p['id']}/{st['id']}: references unknown item '{st.get('item')}'")

        if p["kind"] == "network-diagram":
            node_ids = {n["id"] for n in p["config"]["nodes"]}
            task_ids = {t["id"] for t in p["config"]["tasks"]}
            for s in p["subtasks"]:
                if s["task"] not in task_ids:
                    err(f"{p['id']}/{s['id']}: references unknown task '{s['task']}'")
            for tid, ans in sol.items():
                if isinstance(ans, list):
                    for n in ans:
                        if n not in node_ids:
                            err(f"{p['id']}: solution for {tid} names unknown node '{n}'")

    # --- prerequisite graph ---
    gpath = ROOT / "content" / "graph" / "prerequisites.json"
    if gpath.exists():
        graph = json.loads(gpath.read_text())
        adj = {}
        for e in graph.get("edges", []):
            if e["id"] not in mis:
                err(f"prerequisite graph: unknown misconception '{e['id']}'")
            for r in e["requires"]:
                if r not in mis:
                    err(f"prerequisite graph: '{e['id']}' requires unknown '{r}'")
                if r == e["id"]:
                    err(f"prerequisite graph: '{e['id']}' requires itself")
            if not e.get("why"):
                err(f"prerequisite graph: edge '{e['id']}' has no rationale")
            adj.setdefault(e["id"], []).extend(e["requires"])

        # A cycle means the queue could route backward forever.
        color = {}
        def visit(n, stack):
            color[n] = 1
            for m2 in adj.get(n, []):
                if color.get(m2, 0) == 1:
                    err(f"prerequisite graph: cycle {' -> '.join(stack + [n, m2])}")
                elif color.get(m2, 0) == 0:
                    visit(m2, stack + [n])
            color[n] = 2
        for n in list(adj):
            if color.get(n, 0) == 0:
                visit(n, [])
        print(f"prerequisite graph: {len(graph.get('edges', []))} edges over "
              f"{len(adj)} dependent concepts, acyclic")

    # --- reference solutions must actually score full marks ---
    verify_references(pbqs)

    # --- teaching reachability: can each misconception actually be retired? ---
    used = defaultdict(set)
    for it in items:
        for o in it.get("options", []):
            if o.get("misconception"):
                used[o["misconception"]].add(it["id"])
    for p in pbqs:
        for s in p.get("subtasks", []):
            if s.get("misconception"):
                used[s["misconception"]].add(p["id"])
        for t in p.get("solution", {}).get("testCases", []) + p.get("solution", {}).get("checks", []):
            if t.get("misconception"):
                used[t["misconception"]].add(p["id"])

    unreachable, single = [], []
    for mid, m in mis.items():
        need = m.get("retireAfter", 2)
        n = len(used.get(mid, ()))
        if n == 0:
            unreachable.append(mid)
        elif n < need:
            single.append((mid, n, need))

    # --- coverage vs exam weights ---
    per_domain = defaultdict(int)      # graded, exam-shaped practice
    recall_domain = defaultdict(int)   # imported vocabulary
    for it in items:
        if not it.get("objective"):
            continue
        d = domain_of[it["objective"]]
        if it["type"] == "recall":
            recall_domain[d] += 1
        else:
            per_domain[d] += 1
    for p in pbqs:
        if p.get("objective"):
            per_domain[domain_of[p["objective"]]] += 1
    total = sum(per_domain.values()) or 1
    recall_total = sum(recall_domain.values()) or 1

    print(f"objectives {len(objectives)}  topics {topic_count}")
    print(f"misconceptions {len(mis)}  items {len(items)}  pbqs {len(pbqs)}")
    print(f"\ndomain balance of GRADED practice ({total} mcq + pbq) vs exam weight:")
    print(f"  {'':49}{'yours':>7} {'exam':>6}   {'recall':>7}")
    for d in tax["domains"]:
        share = per_domain[d["id"]] / total
        rshare = recall_domain[d["id"]] / recall_total
        flag = "under" if share < weights[d["id"]] - 0.03 else "over" if share > weights[d["id"]] + 0.03 else "ok"
        print(f"  {d['id']}.0 {d['title']:<45} {share:6.1%} {weights[d['id']]:5.0%}  {flag:<5} {rshare:6.1%}")
    print(f"  (recall column is {recall_total} imported vocabulary items, counted separately:")
    print("   they build recognition, they do not test discrimination)")

    print(f"\nmisconception reachability:")
    print(f"  retirable now (enough distinct items): {len(mis) - len(unreachable) - len(single)}")
    if single:
        print(f"  only one item, cannot be retired ({len(single)}): " +
              ", ".join(f"{m} ({n}/{k})" for m, n, k in single))
    if unreachable:
        print(f"  no item tests these ({len(unreachable)}): {', '.join(sorted(unreachable))}")

    if warnings:
        print(f"\n{len(warnings)} warning(s):")
        for w in warnings[:20]:
            print(f"  ! {w}")
    if errors:
        print(f"\n{len(errors)} ERROR(s):")
        for e in errors:
            print(f"  x {e}")
        sys.exit(1)
    print("\ncontent valid")


if __name__ == "__main__":
    main()
