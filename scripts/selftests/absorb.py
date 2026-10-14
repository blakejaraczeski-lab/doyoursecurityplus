"""Self test scenario: absorb. Run alone with python3 scripts/selftest.py absorb."""
import json, time
from selftest import APP_READY, http, poll, throwaway, doc, log_rows, on_disk, scenario


@scenario("absorb", order=60)
def scenario_absorb(rep, tmp, browser):
    """A state.json from before the review log was a resource still carries
    reviews, mockHistory and per-PBQ attempt lists. The app folds all three
    into the log on first load, and the server does the same for a client that
    never updated."""
    rep.head("A document from before the review log was a resource")
    with throwaway(tmp, "absorb") as (base, data):
        tab = browser.tab
        n0 = len(tab.errors)
        now = int(time.time() * 1000)
        old = doc(
            5000,
            items={"c-001": {"seen": 2, "correct": 1, "wrong": 1, "lastSeen": now, "fsrs": None}},
            pbq={"pbq-diagram-001": {"attempts": [
                {"at": now - 3000, "percent": 60, "earned": 3, "max": 5},
                {"at": now - 2000, "percent": 100, "earned": 5, "max": 5}]}},
            reviews=[{"at": now - 5000, "kind": "item", "id": "c-001", "grade": 3},
                     {"at": now - 4000, "kind": "item", "id": "c-001", "grade": 1},
                     {"at": now - 4000, "kind": "misconception", "id": "control-category-vs-type", "item": "c-001", "grade": 1}],
            mockHistory=[{"at": now - 1000, "format": "short", "raw": 0.8, "scaled": 790, "seconds": 600, "unanswered": 0, "banked": 1}],
        )
        (data / "state.json").write_text(json.dumps(old, indent=2))
        before = (data / "state.json").stat().st_size
        tab.navigate(f"{base}/")
        rep.check(tab.wait_for(APP_READY), "the app boots on the old document")
        rep.check(poll(lambda: log_rows(data) == 6 and "reviews" not in on_disk(data), 15),
                  "6 rows reach the log: 3 reviews, 1 mock, 2 PBQ attempts", f"(got {log_rows(data)})")
        saved = on_disk(data)
        rep.check("reviews" not in saved and "mockHistory" not in saved, "the saved document carries neither array")
        rep.check(saved.get("pbq", {}).get("pbq-diagram-001") == {"attempts": 2, "best": 100, "lastAt": now - 2000},
                  "the PBQ record is a bounded summary", f"({saved.get('pbq')})")
        after = (data / "state.json").stat().st_size
        rep.check(after < before, f"the state document shrank from {before} to {after} bytes")
        tab.evaluate("document.querySelector('[data-action=nav][data-section=mock]').click()")
        rep.check(tab.evaluate("document.body.textContent.includes('Previous attempts') && document.body.textContent.includes('790')"),
                  "the absorbed mock shows under previous attempts")
        rep.check(not tab.errors[n0:], "no console error", "; ".join(tab.errors[n0:])[:200])

        # A second client that never updated sends the same old document. Its
        # history is already in the log and its copy is older than the saved
        # one: nothing is appended twice, and the newer progress stays.
        held = on_disk(data)["updatedAt"]
        st, body = http("PUT", f"{base}/api/state", {**old, "updatedAt": 9000})
        rep.check(st == 412 and log_rows(data) == 6 and on_disk(data)["updatedAt"] == held,
                  "a client that never updated re-sending that history adds nothing and replaces nothing",
                  f"({st}, {log_rows(data)} rows)")
        saved = on_disk(data)
        rep.check("reviews" not in saved and "mockHistory" not in saved, "and the saved document still carries neither array")
