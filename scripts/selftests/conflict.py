"""Self test scenario: conflict. Run alone with python3 scripts/selftest.py conflict."""
import json, time
from selftest import APP_READY, http, throwaway, doc, log_rows, on_disk, scenario


@scenario("conflict", order=20)
def scenario_conflict(rep, tmp, browser):
    """Two sessions, one document: the stale save is refused, over HTTP and through the real client."""
    rep.head("Two sessions, one document")
    with throwaway(tmp, "conflict") as (base, data):
        state_url = f"{base}/api/state"
        st, _ = http("PUT", state_url, doc(1000))
        rep.check(st == 200, "the first save lands without a precondition", f"({st})")
        st, got = http("GET", state_url)
        b_version = got["updatedAt"]
        st, _ = http("PUT", state_url, doc(2000, items={"c-001": {"seen": 1}}), {"If-Match": "1000"})
        rep.check(st == 200, "session A saves on the version it read (If-Match: 1000)", f"({st})")
        st, body = http("PUT", state_url, doc(1500, items={"c-002": {"seen": 1}}), {"If-Match": str(b_version)})
        rep.check(st == 412 and body.get("serverUpdatedAt") == 2000 and body.get("state", {}).get("updatedAt") == 2000,
                  "session B, on that same version, gets 412 and A's copy back",
                  f"({st}, serverUpdatedAt {body.get('serverUpdatedAt')})")
        saved = on_disk(data)
        rep.check(saved["updatedAt"] == 2000 and "c-001" in saved["items"] and "c-002" not in saved["items"],
                  "the document on disk is still A's")
        merged = body["state"]
        merged["items"]["c-002"] = {"seen": 1}
        merged["updatedAt"] = 3000
        st, _ = http("PUT", state_url, merged)
        rep.check(st == 200, "B resolves it by replacing unconditionally", f"({st})")
        raw = (data / "state.json").read_bytes()
        rep.check(len(raw) == len(json.dumps(merged, indent=2)) and json.loads(raw)["updatedAt"] == 3000,
                  f"the state document is B's merged copy, {len(raw)} bytes")
        rep.check(log_rows(data) == 0, "the review log holds 0 rows: a state save never writes one", f"({log_rows(data)})")

        # The same conflict through the app. It pulls version 3000, another
        # session saves 4000, and then it tries to save a settings change.
        tab = browser.tab
        n0 = len(tab.errors)
        tab.navigate(f"{base}/")
        rep.check(tab.wait_for(APP_READY), "the app boots on the throwaway server")
        http("PUT", state_url, doc(4000, items={"c-003": {"seen": 1}}))
        tab.evaluate("document.querySelector('[data-action=nav][data-section=settings]').click()")
        tab.evaluate("const s = document.getElementById('f-goal'); s.value = '60';"
                     "s.dispatchEvent(new Event('change', { bubbles: true }))")
        rep.check(tab.wait_for("document.getElementById('sync-foot').textContent.includes('Another session')", 8),
                  "its save on version 3000 is refused and the sidebar says another session saved newer work")
        rep.check(on_disk(data)["updatedAt"] == 4000, "the newer copy is untouched", f"({on_disk(data)['updatedAt']})")
        tab.navigate("about:blank")   # pagehide: the last-resort beacon carries the same precondition
        time.sleep(0.6)
        rep.check(on_disk(data)["updatedAt"] == 4000, "leaving the page does not overwrite it either",
                  f"(updatedAt {on_disk(data)['updatedAt']})")
        rep.check(not tab.errors[n0:], "no console error", "; ".join(tab.errors[n0:])[:200])
