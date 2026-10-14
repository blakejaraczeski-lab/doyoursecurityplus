"""Self test scenario: server-rows. Run alone with python3 scripts/selftest.py server-rows."""
import json
from selftest import http, throwaway, doc, scenario


@scenario("server-rows", order=170, browser=False)
def scenario_server_rows(rep, tmp):
    """Two server promises about what is on disk: a torn last line in the log
    does not swallow the next good row, and the newest snapshot is the latest
    write, not the first of a busy second."""
    rep.head("Server: a torn log line and the snapshot of the last write")
    with throwaway(tmp, "server-rows") as (base, data):
        state_url, log_url = f"{base}/api/state", f"{base}/api/reviews"
        http("POST", log_url, [{"at": 1, "kind": "item", "id": "c-001", "grade": 3}])
        with (data / "reviews.jsonl").open("a") as f:
            f.write('{"at": 5, "kind": "it')          # a crash mid write: no closing, no newline
        code, body = http("POST", log_url, [{"at": 9, "kind": "item", "id": "c-good", "grade": 3}])
        ids = [r.get("id") for r in http("GET", log_url)[1]["reviews"]]
        rep.check(code == 200 and ids == ["c-001", "c-good"],
                  "a row posted after a torn last line is kept and readable, and the torn fragment is skipped", f"({code}, {ids})")
        code, body = http("POST", log_url, [{"at": 10, "kind": "item", "id": "c-next", "grade": 1}])
        ids = [r.get("id") for r in http("GET", log_url)[1]["reviews"]]
        rep.check(ids == ["c-001", "c-good", "c-next"], "and the rows after that are fine too", f"({ids})")

        http("PUT", state_url, doc(100))
        lagged = 0
        for k in range(1, 7):      # six pairs of writes, most of them inside one clock second
            http("PUT", state_url, doc(100 + 2 * k - 1), {"If-Match": str(100 + 2 * k - 2)})
            http("PUT", state_url, doc(100 + 2 * k), {"If-Match": str(100 + 2 * k - 1)})
            newest = sorted((data / "snapshots").glob("state-*.json"))[-1]
            lagged += json.loads(newest.read_text())["updatedAt"] != 100 + 2 * k
        rep.check(lagged == 0, f"after every write the newest snapshot holds that write ({lagged} of 6 lagged)")
