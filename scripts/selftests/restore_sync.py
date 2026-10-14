"""Self test scenario: restore-sync. Run alone with python3 scripts/selftest.py restore-sync."""
import json, time
from selftest import APP_READY, http, poll, throwaway, doc, on_disk, seed_local, scenario


@scenario("restore-sync", order=180)
def scenario_restore_and_sync(rep, tmp, browser):
    """Restoring a backup and the first save of a tab. A restore from an export
    made before the log was its own resource still carries a `reviews` array;
    it must stick after a reload and its rows must reach the log. A tab whose
    first read of the server failed has no idea what the server holds, so it
    must not write over it; a server that answered 404 holds nothing, and the
    tab's first save must land."""
    rep.head("Restore a backup, and a first save that cannot see the server")
    mc = "rto-vs-rpo"
    with throwaway(tmp, "restore") as (base, data):
        tab = browser.tab
        n0 = len(tab.errors)
        future = int(time.time() * 1000) + 10_000_000      # a clock the browser's own saves cannot pass
        http("PUT", f"{base}/api/state", doc(future, misconceptions={"kept": {"hits": 1, "retired": True}}))
        tab.navigate(f"{base}/")
        rep.check(tab.wait_for(APP_READY), "the app boots on the server's newer progress")
        backup = doc(1000, misconceptions={mc: {"hits": 2, "retired": False, "lastAt": 1000}},
                     reviews=[{"at": 5000 + k, "kind": "item", "id": f"c-{k:03d}", "grade": 3} for k in range(3)])
        tab.evaluate("""((backup) => {
          const real = HTMLInputElement.prototype.click;
          HTMLInputElement.prototype.click = function () {
            if (this.type !== 'file') return real.call(this);
            const dt = new DataTransfer(); dt.items.add(new File([JSON.stringify(backup)], 'backup.json', { type: 'application/json' }));
            this.files = dt.files; this.onchange && this.onchange();
          };
          document.querySelector('[data-action=nav][data-section=settings]').click();
          document.querySelector('[data-action=import]').click();
        })(%s)""" % json.dumps(backup))
        landed = poll(lambda: mc in (on_disk(data).get("misconceptions") or {}), 8)
        rep.check(landed and "kept" not in on_disk(data)["misconceptions"],
                  "importing an old export replaces the server's saved document with it", f"({sorted(on_disk(data)['misconceptions'])})")
        rep.check("reviews" not in on_disk(data), "and the saved document carries no review history inside it")
        rows_now = lambda: sorted(json.loads(l)["id"] for l in (data / "reviews.jsonl").read_text().splitlines() if l.strip()) if (data / "reviews.jsonl").exists() else []
        poll(lambda: len(rows_now()) >= 3, 8)
        ids = rows_now()
        rep.check(ids == ["c-000", "c-001", "c-002"], "its review rows reached the log, once each", f"({ids})")
        tab.navigate(f"{base}/")
        rep.check(tab.wait_for(APP_READY), "the app boots again")
        time.sleep(1.0)
        rep.check(tab.evaluate(f"!!App.state.misconceptions[{json.dumps(mc)}] && !App.state.misconceptions.kept"),
                  "after a reload the restored progress is still what the page holds, not the server's older copy pulled back")

    with throwaway(tmp, "first-pull") as (base, data):
        tab = browser.tab
        n1 = len(tab.errors)
        future = int(time.time() * 1000) + 10_000_000
        http("PUT", f"{base}/api/state", doc(future, misconceptions={"kept": {"hits": 1, "retired": True}}))
        stale = doc(100, misconceptions={mc: {"hits": 1, "retired": False}})
        seed = seed_local(tab, stale)
        stub = tab.call("Page.addScriptToEvaluateOnNewDocument", source="""(() => {
          const real = window.fetch; let failed = false;
          window.fetch = (url, opts) => {
            const u = String(url instanceof Request ? url.url : url);
            if (!failed && u.endsWith('/api/state') && (!opts || !opts.method || opts.method === 'GET')) { failed = true; return Promise.reject(new TypeError('Failed to fetch')); }
            return real(url, opts);
          };
        })();""")["identifier"]
        tab.navigate(f"{base}/")
        tab.wait_for(APP_READY)
        time.sleep(4.0)    # past the 1.5 s save debounce, twice
        held = on_disk(data)
        rep.check(held["updatedAt"] == future and "kept" in held["misconceptions"] and mc not in held["misconceptions"],
                  "a tab whose first read of the server failed does not write its older copy over the server's newer progress", f"({held['updatedAt']} vs {future})")
        tab.call("Page.removeScriptToEvaluateOnNewDocument", identifier=stub)
        tab.call("Page.removeScriptToEvaluateOnNewDocument", identifier=seed)
        tab.evaluate("localStorage.clear()")
        rep.check(not tab.errors[n1:], "no console error", "; ".join(tab.errors[n1:])[:200])

    with throwaway(tmp, "first-save") as (base, data):
        tab = browser.tab
        local = doc(100, misconceptions={mc: {"hits": 1, "retired": False}})
        seed = seed_local(tab, local)
        tab.navigate(f"{base}/")
        tab.wait_for(APP_READY)
        ok = poll(lambda: (data / "state.json").exists() and mc in on_disk(data).get("misconceptions", {}), 6)
        rep.check(ok, "when the server answers 404 (nothing saved yet) the tab's first save still lands")
        tab.call("Page.removeScriptToEvaluateOnNewDocument", identifier=seed)
        tab.evaluate("localStorage.clear()")
