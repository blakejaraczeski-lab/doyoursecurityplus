"""Self test scenario: stale-tab. Run alone with python3 scripts/selftest.py stale-tab."""
from selftest import http, throwaway, doc, log_rows, on_disk, scenario


@scenario("stale-tab", order=30, browser=False)
def scenario_stale_tab(rep, tmp):
    """The incident of 2026-10-13: a tab running code from before the review
    log was a resource, open since September, saved its old copy with its old
    history inside. The server took the copy and appended 145 rows it already
    held. Replayed here exactly: newer progress on disk, an older document
    carrying a review array and no If-Match."""
    rep.head("A tab left open for weeks, running old code")
    with throwaway(tmp, "stale-tab") as (base, data):
        state_url, log_url = f"{base}/api/state", f"{base}/api/reviews"
        history = [{"at": 1000 + k, "kind": "item", "id": f"c-{k:03d}", "grade": 3} for k in range(20)]
        http("PUT", state_url, doc(9000, misconceptions={"kept": {"hits": 1, "retired": True}}))
        http("POST", log_url, history)
        rep.check(log_rows(data) == 20, "the log holds the 20 answers already sent")

        renamed = dict(history[5], id="old-name-for-c-005")          # the same answer under a pre-rename id
        novel = {"at": 5000, "kind": "item", "id": "c-099", "grade": 1}   # one answer the log never received
        stale = doc(4000, reviews=history + [renamed, novel])            # no If-Match: old code never sends it
        code, body = http("PUT", state_url, stale)
        held = on_disk(data)
        rep.check(code == 412 and held["updatedAt"] == 9000 and "kept" in held["misconceptions"],
                  "an older document from old code is refused, and the newer progress stays", f"({code}, updatedAt {held['updatedAt']})")
        rep.check(log_rows(data) == 21,
                  f"its history adds only the one answer the log lacked: 20 copies and a renamed copy skipped ({log_rows(data)} rows)")
        rep.check(isinstance(body, dict) and body.get("state", {}).get("updatedAt") == 9000, "and it is sent the saved copy back")

        # An old tab in active use looks newer, because every answer refreshes updatedAt. It is refused anyway.
        code, _ = http("PUT", state_url, doc(9500, reviews=[{"at": 9500, "kind": "item", "id": "c-098", "grade": 3}]))
        held = on_disk(data)
        rep.check(code == 412 and held["updatedAt"] == 9000 and "kept" in held["misconceptions"],
                  "an old tab whose document looks newer is refused, and the saved progress stays", f"({code}, updatedAt {held['updatedAt']})")
        code, _ = http("PUT", state_url, doc(9500, reviews=[]))
        rep.check(code == 412 and on_disk(data)["updatedAt"] == 9000, "old code with an empty history is old code too")
        code, _ = http("PUT", state_url, doc(9600), {"If-Match": "9000"})
        rep.check(code == 200 and on_disk(data)["updatedAt"] == 9600, "a current client with If-Match still saves")

        # An outbox retried after a lost reply: the same rows twice land once.
        retry = [{"at": 6000, "kind": "item", "id": "c-100", "grade": 3}, {"at": 6001, "kind": "item", "id": "c-101", "grade": 1}]
        http("POST", log_url, retry)
        code, body = http("POST", log_url, retry)
        rep.check(code == 200 and body.get("appended") == 0 and log_rows(data) == 24,
                  "an outbox sent twice lands once, and the server says none were new")
