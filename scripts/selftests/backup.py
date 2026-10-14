"""Self test scenario: backup. Run alone with python3 scripts/selftest.py backup."""
import os, subprocess, sys, time, pathlib
from selftest import ROOT, APP_READY, http, throwaway, doc, log_rows, on_disk, scenario


@scenario("backup", order=90)
def scenario_backup(rep, tmp, browser):
    """A dated tarball out, a confirmed restore back, and the restore sticks
    against a tab that still holds the newer copy it was meant to replace."""
    rep.head("Backup and restore")
    with throwaway(tmp, "backup") as (base, data):
        tab = browser.tab
        n0 = len(tab.errors)
        backups = pathlib.Path(tmp) / "backups"
        env = {**os.environ, "DYSP_DATA": str(data), "DYSP_BACKUPS": str(backups)}
        run = lambda *args: subprocess.run([sys.executable, str(ROOT / "scripts/backup.py"), *args],
                                           env=env, capture_output=True, text=True, stdin=subprocess.DEVNULL, timeout=30)
        state_url = f"{base}/api/state"
        http("PUT", state_url, doc(1000, misconceptions={"acl-implicit-deny": {"hits": 1, "retired": False}}))
        http("POST", f"{base}/api/reviews", [{"at": 1, "kind": "item", "id": "c-001", "grade": 3}])

        r = run("backup")
        tarballs = sorted(backups.glob("dysp-*.tar.gz"))
        rep.check(r.returncode == 0 and len(tarballs) == 1, "backup writes one dated tarball outside the data directory",
                  f"(exit {r.returncode}: {r.stdout or r.stderr})")
        import tarfile
        with tarfile.open(tarballs[0]) as tar:
            names = set(tar.getnames())
        rep.check({"state.json", "reviews.jsonl", "snapshots"} <= names and any(n.startswith("snapshots/state-") for n in names),
                  "it holds state.json, reviews.jsonl and the snapshots", f"({sorted(names)})")

        # Life goes on: the misconception is cleared, another row lands, and a
        # tab loads the newer copy into its localStorage.
        http("PUT", state_url, doc(2000), {"If-Match": "1000"})
        http("POST", f"{base}/api/reviews", [{"at": 2, "kind": "item", "id": "c-002", "grade": 1}])
        tab.navigate(f"{base}/")
        rep.check(tab.wait_for(APP_READY) and tab.evaluate("App.state.updatedAt === 2000"), "a tab holds the newer copy")

        r = run("restore", str(tarballs[0]), "--yes")
        saved = on_disk(data)
        rep.check(r.returncode == 0 and "acl-implicit-deny" in saved["misconceptions"],
                  "restore brings the backed-up document back", f"(exit {r.returncode}: {r.stdout or r.stderr})")
        rep.check(saved["updatedAt"] > 2000, f"with a fresh updatedAt, so it is the newest copy anywhere ({saved['updatedAt']})")
        rep.check(log_rows(data) == 1, "the log is back to the backed-up rows", f"({log_rows(data)})")
        rep.check(len(sorted(backups.glob("dysp-*.tar.gz"))) == 2, "a safety backup of what was there was taken first")

        # The tab that was never closed reloads and takes the restored copy,
        # rather than winning the reconcile and pushing the replaced data back.
        tab.navigate(f"{base}/")
        ready = tab.wait_for(APP_READY)
        held = tab.evaluate("[App.state.updatedAt, Object.keys(App.state.misconceptions), App.screen]")
        rep.check(ready and tab.evaluate("'acl-implicit-deny' in App.state.misconceptions"),
                  "a reloaded tab takes the restored copy instead of pushing its own back",
                  f"(tab holds {held}; server {http('GET', state_url)[1].get('updatedAt')}; errors {tab.errors[n0:]})")
        # The backed-up record above has no scheduling card, as a hand-edited
        # or older document might. It is filled in on load, not fatal.
        rep.check(tab.evaluate("!!App.state.misconceptions['acl-implicit-deny']?.fsrs && Array.isArray(App.state.misconceptions['acl-implicit-deny'].cleanPasses)"),
                  "a restored record missing its card is filled in rather than taking the app down")
        time.sleep(2.2)   # past the save debounce, so any push it did make has landed
        rep.check("acl-implicit-deny" in on_disk(data)["misconceptions"] and on_disk(data)["updatedAt"] >= saved["updatedAt"],
                  "and the restored document is still on disk after the debounce")
        rep.check(not tab.errors[n0:], "no console error", "; ".join(tab.errors[n0:])[:200])

        before = on_disk(data)["updatedAt"]
        r = run("restore", str(tarballs[0]))   # no --yes and no terminal to ask: refuses
        rep.check(r.returncode != 0 and "nothing changed" in r.stdout and on_disk(data)["updatedAt"] == before,
                  "without a yes, restore changes nothing", f"(exit {r.returncode}: {(r.stdout + r.stderr)[-120:]!r})")
