"""Self test scenario: mock-resume. Run alone with python3 scripts/selftest.py mock-resume."""
import json, time
from selftest import APP_READY, throwaway, scenario

MULTI = "sec-1.1-015"
KEY = "dysp.mock"


@scenario("mock-resume", order=156)
def scenario_mock_resume(rep, tmp, browser):
    """A mock interrupted by a reload comes back where it was, with the wall
    clock still running; one whose time ran out while the page was gone is
    scored once, as a timed-out sitting; a finished or abandoned mock is not
    resumed."""
    rep.head("Mock exam: resume after a reload")
    with throwaway(tmp, "mock-resume") as (base, data):
        tab = browser.tab
        n0 = len(tab.errors)
        tab.navigate(f"{base}/")
        rep.check(tab.wait_for(APP_READY), "the app boots")
        js = lambda code: tab.evaluate(code)
        click = lambda sel: js(f"document.querySelector({json.dumps(sel)})?.click()")
        text = lambda: js("document.getElementById('main').innerText") or ""
        hide = ("Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' }); document.dispatchEvent(new Event('visibilitychange'));"
                "Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' })")

        def mocks():
            f = data / "reviews.jsonl"
            rows = [json.loads(l) for l in f.read_text().splitlines() if l.strip()] if f.exists() else []
            return [r for r in rows if r["kind"] == "mock" and not r.get("abandoned")]   # scored sittings; the abandoned one is its own row

        def reload():
            tab.navigate(f"{base}/")
            return tab.wait_for(APP_READY)

        snap = lambda: js("""(() => { const m = App.mock; if (!m) return null;
          return { idx: m.idx, endsAt: m.endsAt, startedAt: m.startedAt, flagged: [...m.flagged].sort(), answers: m.answers, format: m.format,
                   ids: m.items.map((e) => e.item?.id || e.pbq?.id).join(), screen: App.screen,
                   order: m.items.filter((e) => e.kind === 'item').map((e) => e.item.options.map((o) => o.id).join('')).join('|') }; })()""")

        click("[data-action=nav][data-section=mock]")
        click("[data-action=mock-select][data-format=short]")
        click("[data-action=mock-start]")
        rep.check(js(f"localStorage.getItem('{KEY}')") is not None, "starting a mock saves it")
        js(f"""{{ const m = App.mock; const i = m.items.findIndex((e) => e.kind === 'item');
          m.items[i] = {{ kind: 'item', item: App.content.itemsById['{MULTI}'] }}; m.idx = i; }}""")
        click("[data-action=mock-review]")
        click("[data-action=mock-resume]")
        first = js(f"App.content.itemsById['{MULTI}'].options.find((o) => o.correct).id")
        click(f"[data-action=mock-answer][data-opt={first}]")
        click("[data-action=mock-flag]")
        click("[data-action=mock-next]")
        click("[data-action=mock-next]")
        first_item = js("(() => { const e = App.mock.items[App.mock.idx]; return e.item ? e.item.id : null })()")
        if first_item:
            js(f"App.mock.answers['{first_item}'] = App.mock.items[App.mock.idx].item.options.find((o) => o.correct).id")
        click("[data-action=mock-prev]")
        time.sleep(1.6)     # the one second tick keeps the saved copy current
        before = snap()
        rep.check(before and before["flagged"] and any(isinstance(v, list) for v in before["answers"].values()),
                  "the sitting under test has a flag and a half-answered choose-two", f"({before and before['answers']})")

        rep.check(reload(), "the page reloads")
        rep.check(tab.wait_for("!!App.mock", 8), "the mock is back after the reload")
        after = snap()
        rep.check(after == before, "same questions, answers, flags, option order, place and end time", f"(before {before}, after {after})")
        rep.check(js("App.screen") == "mock-run" and js("/\\d+:\\d\\d left/.test(document.getElementById('mock-timer').textContent)"),
                  "it is on the runner and the clock reads time left, counting down the same end time")
        t1 = js("document.getElementById('mock-timer').textContent")
        time.sleep(2.2)
        t2 = js("document.getElementById('mock-timer').textContent")
        rep.check(t1 != t2 and js("App.mock.endsAt") == before["endsAt"], "the clock kept running from the original end time", f"({t1} then {t2})")
        rep.check(len(mocks()) == 0, "resuming scored nothing and logged nothing")

        # Abandoned: gone for good.
        click("[data-action=mock-end]")
        click("[data-action=mock-abandon]")
        rep.check(js(f"localStorage.getItem('{KEY}')") is None, "abandoning removes the saved mock")
        js(hide); time.sleep(0.6)
        rep.check(reload() and js("App.mock") is None, "and a reload does not bring it back")

        # Time ran out while the page was gone.
        click("[data-action=nav][data-section=mock]")
        click("[data-action=mock-select][data-format=short]")
        click("[data-action=mock-start]")
        time.sleep(1.2)
        raw = json.loads(js(f"localStorage.getItem('{KEY}')"))
        raw["endsAt"] = int(time.time() * 1000) - 5000
        raw["startedAt"] = raw["endsAt"] - raw["minutes"] * 60000
        tab.navigate("about:blank")
        ident = tab.call("Page.addScriptToEvaluateOnNewDocument",
                         source=f"try {{ localStorage.setItem('{KEY}', {json.dumps(json.dumps(raw))}); }} catch (e) {{}}")["identifier"]
        tab.navigate(f"{base}/")
        tab.call("Page.removeScriptToEvaluateOnNewDocument", identifier=ident)
        rep.check(tab.wait_for("App.mock && App.screen === 'mock-result'", 8), "a mock whose time ran out while away comes back as a result")
        js(hide); time.sleep(0.8)
        m = mocks()
        rep.check(len(m) == 1 and m[0]["seconds"] == raw["minutes"] * 60, "scored once, with the time used capped at the window", f"({m})")
        t = text()
        rep.check("Time ran out" in t and "away" in t, "and the result says the time ran out while the page was closed")
        rep.check(reload() and tab.wait_for("!!App.mock && App.screen === 'mock-result'", 8) and len(mocks()) == 1,
                  "reloading the result shows it again and does not score it twice")
        click("[data-action=mock-done]")
        rep.check(js(f"localStorage.getItem('{KEY}')") is None, "Back to mock exams removes it")
        rep.check(reload() and js("App.mock") is None, "and the next reload starts clean")
        rep.check(not tab.errors[n0:], "no console error", "; ".join(tab.errors[n0:])[:200])
