"""Self test scenarios: data_safety. Run alone with python3 scripts/selftest.py data-safety-server data-safety-page.

Reset, export and the safety backup touch real study data in use, so every
check here runs against a throwaway data directory the harness made.
"""
import gzip, json, os, pathlib, shutil, tarfile, time, urllib.request
from selftest import APP_READY, http, poll, throwaway, doc, log_rows, on_disk, seed_heavy, scenario


def tarball(path):
    with tarfile.open(path) as tar:
        names = tar.getnames()
        state = json.load(tar.extractfile("state.json")) if "state.json" in names else None
        rows = len([l for l in tar.extractfile("reviews.jsonl").read().splitlines() if l.strip()]) if "reviews.jsonl" in names else 0
    return state, rows


def raw_get(url, headers=None):
    req = urllib.request.Request(url, headers=headers or {})
    with urllib.request.urlopen(req, timeout=10) as r:
        return r.status, dict(r.headers), r.read()


def backups_of(data):
    return sorted((data.parent / f"{data.name}-backups").glob("dysp-*.tar.gz"))


@scenario("data-safety-server", order=200, browser=False)
def scenario_data_safety_server(rep, tmp):
    """Erasing progress writes a safety backup first and is refused without one; the log and state responses are gzipped."""
    rep.head("Reset, safety backup and compression on the server")
    with throwaway(tmp, "datasafety") as (base, data):
        mis = {"acl-implicit-deny": {"hits": 1, "retired": False}}
        http("PUT", f"{base}/api/state", doc(1000, misconceptions=mis, items={"c-001": {"seen": 1}}))
        http("POST", f"{base}/api/reviews", [{"at": i + 1, "kind": "item", "id": "c-001", "grade": 3} for i in range(3)]
             + [{"at": 10, "kind": "mock", "scaled": 707}])
        rep.check(log_rows(data) == 4, "seeded: 4 log rows")

        st, _ = http("DELETE", f"{base}/api/progress")
        rep.check(st == 400 and log_rows(data) == 4 and (data / "state.json").exists(),
                  "an erase without confirm=erase is refused and touches nothing", f"({st})")

        st, body = http("DELETE", f"{base}/api/progress?confirm=erase")
        found = backups_of(data)
        rep.check(st == 200 and body.get("backup") and len(found) == 1 and "before-reset" in found[0].name,
                  "an erase answers with a named before-reset safety backup", f"({st} {body})")
        saved, rows = tarball(found[0]) if found else (None, -1)
        rep.check(saved and "c-001" in saved["items"] and "acl-implicit-deny" in saved["misconceptions"] and rows == 4,
                  "the backup holds the items, the corrections and all 4 log rows", f"({rows} rows)")
        rep.check(not (data / "state.json").exists() and log_rows(data) == 0 and not (data / "snapshots").exists(),
                  "state, log and snapshots are gone")
        st, _ = http("GET", f"{base}/api/state")
        _, h = http("GET", f"{base}/api/health")
        rep.check(st == 404 and h.get("reviews") == 0 and h.get("snapshots") == 0, "the server reads as empty", f"({st} {h})")
        rep.check(h.get("lastBackup") == found[0].name and abs(h.get("lastBackupAt", 0) - time.time() * 1000) < 60000,
                  "health names the newest backup and when it was written", f"({h.get('lastBackup')})")

        # Starting clean and erasing again has nothing to copy: no empty archive.
        st, body = http("DELETE", f"{base}/api/progress?confirm=erase")
        rep.check(st == 200 and body.get("backup") is None and len(backups_of(data)) == 1, "erasing nothing writes no empty backup")

        # A safety backup that cannot be written stops the erase.
        http("PUT", f"{base}/api/state", doc(2000, misconceptions=mis))
        http("POST", f"{base}/api/reviews", [{"at": 5, "kind": "item", "id": "c-002", "grade": 1}])
        shutil.rmtree(data.parent / f"{data.name}-backups")
        (data.parent / f"{data.name}-backups").write_text("a file where the backup directory should be")
        st, body = http("DELETE", f"{base}/api/progress?confirm=erase")
        rep.check(st == 500 and "nothing was erased" in body.get("error", "") and on_disk(data)["updatedAt"] == 2000 and log_rows(data) == 1,
                  "when the backup cannot be written nothing is erased", f"({st} {body})")
        (data.parent / f"{data.name}-backups").unlink()

        # A copy on request, with a fixed set of labels, and bounded.
        st, body = http("POST", f"{base}/api/backups", {"label": "before-import"})
        rep.check(st == 200 and "before-import" in (body.get("backup") or ""), "POST /api/backups writes a before-import copy", f"({st} {body})")
        st, _ = http("POST", f"{base}/api/backups", {"label": "../../x"})
        rep.check(st == 400, "any other label is refused", f"({st})")
        for _ in range(12):
            http("POST", f"{base}/api/backups", {"label": "before-import"})
        safety = [p for p in backups_of(data) if "before-" in p.name]
        rep.check(len(safety) == 10, f"safety copies are bounded at 10 ({len(safety)})")
        keep = data.parent / f"{data.name}-backups" / "dysp-20200101-000000.tar.gz"
        keep.write_bytes(b"a backup the person asked for")
        http("POST", f"{base}/api/backups", {"label": "before-import"})
        rep.check(keep.exists(), "pruning never touches a backup the person asked for")

        # Compression: the state and log are gzipped when asked, identical when decoded.
        seed_heavy(data, 3000)
        for path in ("/api/state", "/api/reviews?since=0"):
            _, plain_h, plain = raw_get(f"{base}{path}")
            _, zip_h, zipped = raw_get(f"{base}{path}", {"Accept-Encoding": "gzip"})
            rep.check(zip_h.get("Content-Encoding") == "gzip" and plain_h.get("Content-Encoding") is None
                      and json.loads(gzip.decompress(zipped)) == json.loads(plain) and len(zipped) < len(plain) / 4,
                      f"{path.split('?')[0]} is gzipped on request, same JSON, {len(plain):,} to {len(zipped):,} bytes")
        st, _ = http("GET", f"{base}/api/reviews?since=abc")
        rep.check(st == 400, "a malformed since is a 400, not a server error", f"({st})")


@scenario("data-safety-page", order=210)
def scenario_data_safety_page(rep, tmp, browser):
    """Reset erases the log too; export carries it; import shows a summary first and says what happened."""
    rep.head("Reset, export and import in the page")
    with throwaway(tmp, "datasafetypage") as (base, data):
        tab = browser.tab
        n0 = len(tab.errors)
        seed_heavy(data, 400)
        tab.navigate(f"{base}/")
        rep.check(tab.wait_for(APP_READY), "the app boots on a seeded record")
        rows0 = log_rows(data)
        items0 = len(on_disk(data)["items"])
        go_settings = "document.querySelector('[data-action=nav][data-section=settings]').click()"
        click = lambda action: tab.evaluate(f"document.querySelector('[data-action={action}]').click()")
        main = lambda: tab.evaluate("document.getElementById('main').innerText") or ""
        tab.evaluate(go_settings)
        rep.check(tab.wait_for("document.querySelector('[data-action=reset]')"), "Settings opens")

        # Export, captured from the page rather than the download.
        tab.evaluate("window.__blob = null; const o = URL.createObjectURL; URL.createObjectURL = (b) => { window.__blob = b; return o.call(URL, b); };"
                     "HTMLAnchorElement.prototype.click = function () {};")
        click("export")
        rep.check(tab.wait_for("window.__blob"), "Export produces a file")
        tab.evaluate("window.__blob.text().then((t) => { window.__exp = t; })")
        rep.check(tab.wait_for("window.__exp"), "and it can be read")
        exported = json.loads(tab.evaluate("window.__exp"))
        mocks = [r for r in exported.get("reviews", []) if r["kind"] == "mock"]
        rep.check(exported.get("format") == "doyoursecurityplus-export" and len(exported["reviews"]) == rows0 and len(mocks) == 6
                  and len(exported["state"]["items"]) == items0,
                  f"the export holds the state ({items0} items) and all {rows0} log rows, 6 mocks among them",
                  f"({len(exported.get('reviews', []))} rows)")
        rep.check("Exported your progress and" in main(), "the page says what was exported")

        # Reset: asks in the page, cancel changes nothing.
        click("reset")
        rep.check(tab.wait_for("document.querySelector('[data-panel]')") and "Erase everything?" in main(), "Reset asks first, in the page")
        click("reset-cancel")
        rep.check(not tab.evaluate("!!document.querySelector('[data-panel]')") and log_rows(data) == rows0, "Cancel changes nothing")

        click("reset")
        click("reset-confirm")
        rep.check(poll(lambda: log_rows(data) == 0, 10), "Reset erases the log, not just the state")
        rep.check(poll(lambda: len(on_disk(data)["items"]) == 0, 10), "and the state document on disk starts empty")
        found = backups_of(data)
        saved, rows = tarball(found[0]) if found else (None, -1)
        rep.check(len(found) == 1 and saved and len(saved["items"]) == items0 and rows == rows0,
                  f"a safety backup holds the {items0} items and {rows0} rows that were erased")
        rep.check(tab.wait_for("document.querySelector('[role=status]')?.innerText.includes('safety backup')"),
                  "the page says it is erased and names the safety backup")
        ring = tab.evaluate("document.querySelector('.goal-ring b').textContent") or ""
        rep.check(ring.startswith("0/"), f"the goal ring is empty ({ring})")
        tab.navigate(f"{base}/")
        rep.check(tab.wait_for(APP_READY) and tab.evaluate("Object.keys(App.state.items).length") == 0, "a reload comes up empty")
        tab.evaluate("document.querySelector('[data-action=nav][data-section=readiness]').click()")
        text = main()
        rep.check("707" not in text and "266 answers" not in text and "6 mocks" not in text,
                  "Readiness no longer shows answers or mock scores from the erased history", text[:300].replace("\n", " | "))

        # Import: a summary and a Cancel first, then the whole record.
        tab.evaluate(go_settings)
        tab.evaluate("window.__file = null")
        file_json = json.dumps(json.dumps(exported))
        tab.evaluate(f"""(() => {{ const i = document.createElement('input'); const orig = document.createElement.bind(document);
            document.createElement = (t) => {{ const e = orig(t); if (t === 'input') {{ e.click = () => {{
              Object.defineProperty(e, 'files', {{ value: [new File([{file_json}], 'x.json')] }}); e.onchange(); }}; }} return e; }}; }})()""")
        click("import")
        rep.check(tab.wait_for("document.querySelector('[data-panel]')"), "Import shows a confirmation, not a silent replace")
        text = main()
        rep.check("This file" in text and f"{items0} items" in text and f"{rows0} logged answers" in text and "Now" in text and "safety backup" in text,
                  "it shows the file's date, items, open corrections and answers beside the current ones", text[:300].replace("\n", " | "))
        click("import-cancel")
        rep.check(log_rows(data) == 0 and not tab.evaluate("!!document.querySelector('[data-panel]')"), "Cancel imports nothing")
        click("import")
        tab.wait_for("document.querySelector('[data-action=import-confirm]')")
        click("import-confirm")
        rep.check(poll(lambda: log_rows(data) == rows0, 15), f"Import brings all {rows0} log rows back")
        rep.check(poll(lambda: len(on_disk(data)["items"]) == items0, 10), "and the state document")
        rep.check(tab.wait_for("document.querySelector('[role=status]')?.innerText.includes('Saved to disk')"), "the page says it is saved to disk")
        rep.check(len(backups_of(data)) == 2 and any("before-import" in p.name for p in backups_of(data)), "what was on disk was copied before the import")
        tab.evaluate("document.querySelector('[data-action=nav][data-section=readiness]').click()")
        text = main()
        rep.check("707" in text or "6 mocks" in text, "Readiness has its mock history again", text[:300].replace("\n", " | "))

        # A file that is not an export is a sentence, not a stack message.
        tab.evaluate(go_settings)
        tab.evaluate(f"""document.createElement = ((orig) => (t) => {{ const e = orig(t); if (t === 'input') {{ e.click = () => {{
            Object.defineProperty(e, 'files', {{ value: [new File(['not json'], 'x.json')] }}); e.onchange(); }}; }} return e; }})(Document.prototype.createElement.bind(document))""")
        click("import")
        rep.check(tab.wait_for("document.querySelector('[role=status]')?.innerText.includes('Not done')"), "a bad file is reported in the page")
        rep.check("Unexpected token" not in main() and "not a doyoursecurityplus progress export" in main(), "in plain words")

        # Exam date: a past date is not saved, and says why beside the field.
        saved_date = tab.evaluate("App.state.profile.examDate")
        tab.evaluate("const f = document.getElementById('f-date'); f.value = '2025-01-01'; f.dispatchEvent(new Event('change', { bubbles: true }));")
        rep.check(tab.wait_for("document.getElementById('f-date-note')?.innerText.includes('already passed')"), "a past exam date gets a message beside the field")
        rep.check(saved_date and tab.evaluate("App.state.profile.examDate") == saved_date and tab.evaluate("document.getElementById('f-date').value") == saved_date,
                  "and is not saved: the field shows what is saved")
        tab.evaluate("const f = document.getElementById('f-date'); f.value = '2099-01-01'; f.dispatchEvent(new Event('change', { bubbles: true }));")
        rep.check(tab.evaluate("App.state.profile.examDate") == saved_date, "a date years out is refused too")
        rep.check(not tab.errors[n0:], "no console error", "; ".join(tab.errors[n0:])[:300])
