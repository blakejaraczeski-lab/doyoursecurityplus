"""Self test scenario: snapshot. Run alone with python3 scripts/selftest.py snapshot."""
import json
from selftest import http, throwaway, doc, log_rows, scenario


@scenario("snapshot", order=40, browser=False)
def scenario_snapshot(rep, tmp):
    """A corrupt primary is read from its snapshot and healed by the next save."""
    rep.head("A corrupt state.json")
    with throwaway(tmp, "snapshot") as (base, data):
        state_url = f"{base}/api/state"
        d1 = doc(1000, misconceptions={"acl-implicit-deny": {"hits": 1, "retired": False}})
        http("PUT", state_url, d1)
        rep.check(len(list((data / "snapshots").glob("state-*.json"))) == 1, "the first save wrote one snapshot")
        (data / "state.json").write_text("{ half a document")
        st, got = http("GET", state_url)
        rep.check(st == 200 and got.get("state") == d1, "GET /api/state answers from the snapshot", f"({st})")
        st, h = http("GET", f"{base}/api/health")
        rep.check(h.get("misconceptionsOpen") == 1, "health reads the same copy", f"({h})")
        d2 = {**d1, "updatedAt": 2000}
        st, _ = http("PUT", state_url, d2, {"If-Match": "1000"})
        rep.check(st == 200, "the next save, on the restored version, is accepted", f"({st})")
        raw = (data / "state.json").read_bytes()
        rep.check(json.loads(raw) == d2 and len(raw) == len(json.dumps(d2, indent=2)),
                  f"the state document is whole again, {len(raw)} bytes")
        rep.check(log_rows(data) == 0, "the review log holds 0 rows", f"({log_rows(data)})")
