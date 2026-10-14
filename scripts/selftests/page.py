"""Self test scenario: page. Run alone with python3 scripts/selftest.py page."""
import time
from selftest import TIMEOUT_S, throwaway, scenario


@scenario("page", order=10)
def scenario_page(rep, tmp, browser):
    """selftest.html: every pure-function check, read out of the page."""
    rep.head("selftest.html")
    with throwaway(tmp, "page") as (base, _):
        tab = browser.tab
        r0 = len(tab.requests)
        tab.navigate(f"{base}/selftest.html")
        text = ""
        deadline = time.time() + TIMEOUT_S
        while time.time() < deadline:
            text = tab.evaluate("(document.getElementById('out') || {}).innerText || ''") or ""
            if text.strip() and not text.strip().startswith("Running"):
                break
            time.sleep(0.25)
        text = text.strip()
        print("\n".join("  " + line for line in text.splitlines()))
        if not text or "All checks passed." not in text:
            rep.failures += max(1, sum(1 for line in text.splitlines() if "FAIL" in line))
            print(f"  FAIL selftest.html did not finish in {TIMEOUT_S}s; console: {'; '.join(tab.errors)[:600] or 'no errors'}")

        # The page makes no request it does not serve itself, fonts included.
        tab.evaluate("document.fonts.ready.then(() => { window.__fontsReady = true; })")
        tab.wait_for("window.__fontsReady", 10)
        loaded = tab.evaluate("[...document.fonts].filter((f) => f.status === 'loaded').map((f) => f.family + ' ' + f.weight)") or []
        away = sorted({u for u in tab.requests[r0:] if not u.startswith(base) and not u.startswith("data:")})
        rep.check(not away, "every request on this load stayed on this origin", f"({away[:3]})")
        rep.check(any("Mono" in f for f in loaded) and any("Sans" in f for f in loaded),
                  f"IBM Plex loaded from this origin: {', '.join(sorted(set(loaded)))}", f"({loaded})")
