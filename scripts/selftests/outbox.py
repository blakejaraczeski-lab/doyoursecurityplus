"""Self test scenario: outbox. Run alone with python3 scripts/selftest.py outbox."""
import json, time
from selftest import APP_READY, poll, throwaway, log_rows, scenario


@scenario("outbox", order=50)
def scenario_outbox(rep, tmp, browser):
    """Rows written while the server was down wait in localStorage and are replayed on the next load."""
    rep.head("An outbox left behind while the server was down")
    with throwaway(tmp, "outbox") as (base, data):
        tab = browser.tab
        n0 = len(tab.errors)
        now = int(time.time() * 1000)
        rows = [{"at": now - 100 * (i + 1), "kind": "item", "id": f"c-00{i + 1}", "grade": 3, "conf": "sure"} for i in range(5)]
        rows += [{"at": now - 50, "kind": "misconception", "id": "control-category-vs-type", "item": "c-001", "grade": 1},
                 {"at": now - 40, "kind": "pbq", "id": "pbq-diagram-001", "percent": 80, "earned": 4, "max": 5}]
        tab.navigate(f"{base}/api/health")   # same origin, before the app runs
        tab.evaluate(f"localStorage.setItem('dysp.v1.outbox', {json.dumps(json.dumps(rows))})")
        tab.navigate(f"{base}/")
        rep.check(tab.wait_for(APP_READY), "the app boots with 7 rows waiting")
        rep.check(poll(lambda: log_rows(data) == 7, 10), "all 7 reach the log within the debounce", f"(got {log_rows(data)})")
        rep.check(tab.evaluate("localStorage.getItem('dysp.v1.outbox')") == "[]", "the outbox is empty once the server has them")
        ring = tab.evaluate("document.querySelector('.goal-ring b').textContent") or ""
        rep.check(ring.startswith("5/"), f"the goal ring counts the five replayed answers ({ring})")
        rep.check(not (data / "state.json").exists(), "no state document was written: a replay is not a save")
        rep.check(not tab.errors[n0:], "no console error", "; ".join(tab.errors[n0:])[:200])
