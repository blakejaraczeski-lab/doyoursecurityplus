"""Self test scenario: mock-exits. Run alone with python3 scripts/selftest.py mock-exits."""
import json, time
from selftest import APP_READY, throwaway, scenario


@scenario("mock-exits", order=140)
def scenario_mock_exits(rep, tmp, browser):
    """Choosing a block does not start it; a started mock can be ended two
    ways, and only a scored one reaches Readiness."""
    rep.head("Mock exam: choose, start, and end early")
    with throwaway(tmp, "mock-exits") as (base, data):
        tab = browser.tab
        n0 = len(tab.errors)
        tab.navigate(f"{base}/")
        rep.check(tab.wait_for(APP_READY), "the app boots")
        js = lambda code: tab.evaluate(code)
        click = lambda sel: js(f"document.querySelector({json.dumps(sel)}).click()")
        hide = ("Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' }); document.dispatchEvent(new Event('visibilitychange'));"
                "Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' })")
        mocks = lambda: [json.loads(l) for l in (data / "reviews.jsonl").read_text().splitlines()
                         if l.strip() and json.loads(l)["kind"] == "mock"] if (data / "reviews.jsonl").exists() else []

        click("[data-action=nav][data-section=mock]")
        rep.check(not js("!!document.querySelector('[data-action=mock-start]')"), "no Start button until a block is chosen")
        click("[data-action=mock-select][data-format=full]")
        click("[data-action=mock-select][data-format=short]")
        rep.check(js("App.screen") == "mock-home" and js("!App.mock")
                  and js("document.querySelector('[data-action=mock-select][data-format=short]').getAttribute('aria-checked')") == "true"
                  and js("document.querySelector('[data-action=mock-select][data-format=full]').getAttribute('aria-checked')") == "false",
                  "choosing one block and then another starts nothing, and the second is the one selected")
        rep.check("blanks counted wrong" in js("document.getElementById('main').innerText"), "the chosen block says what it runs and how ending early works")
        rep.check(js("(() => { const v = document.querySelector('[data-action=mock-select][aria-checked=true] .verdict'); return !!v && v.textContent.trim() !== '' && getComputedStyle(v).opacity === '1'; })()"),
                  "the chosen block is marked by a visible glyph, not colour alone")
        click("[data-action=mock-start]")
        rep.check(js("App.screen") == "mock-run" and js("App.mock.format") == "short", "Start starts the chosen block")

        # Answer two, end early, change your mind, then abandon.
        js("{ const ids = App.mock.items.filter((e) => e.kind === 'item').slice(0, 2); for (const e of ids) App.mock.answers[e.item.id] = e.item.options[0].id; }")
        click("[data-action=mock-end]")
        rep.check("Abandon without a score" in js("document.getElementById('main').innerText") and "2 of" in js("document.getElementById('main').innerText"),
                  "End early offers both exits and says how many are answered")
        click("[data-action=mock-end-cancel]")
        rep.check(js("App.screen") == "mock-run" and js("!App.mock.ending"), "Keep going returns to the exam with the clock still running")
        hits0 = js("Object.values(App.state.misconceptions).reduce((a, m) => a + (m.hits || 0), 0)")
        click("[data-action=mock-end]")
        click("[data-action=mock-abandon]")
        js(hide)
        time.sleep(0.8)
        m = mocks()
        rep.check(len(m) == 1 and m[0].get("abandoned") and m[0].get("answered") == 2 and "raw" not in m[0] and "scaled" not in m[0],
                  "abandoning records the attempt, 2 answered, with no score", f"({m})")
        rep.check(js("Object.values(App.state.misconceptions).reduce((a, m) => a + (m.hits || 0), 0)") == hits0 and js("App.screen") == "mock-home" and js("!App.mock"),
                  "nothing is banked, and you are back at the block choice")
        rep.check("abandoned, 2 of" in js("document.getElementById('main').innerText"), "the history shows it as abandoned, not as a score")
        click("[data-action=nav][data-section=readiness]")
        rep.check(js("App.screen") == "readiness" and "and no mocks" in js("document.getElementById('main').innerText"),
                  "Readiness does not count it as a mock")

        # Start again, end early, and submit: blanks count wrong, and it is a mock.
        click("[data-action=nav][data-section=mock]")
        click("[data-action=mock-select][data-format=short]")
        click("[data-action=mock-start]")
        click("[data-action=mock-end]")
        click("[data-action=mock-submit-now]")
        js(hide)
        time.sleep(0.8)
        m = mocks()
        rep.check(js("App.screen") == "mock-result" and len(m) == 2 and isinstance(m[1].get("raw"), (int, float)) and m[1].get("unanswered", 0) > 0,
                  f"submitting early scores it, with {m[1].get('unanswered') if len(m) > 1 else '?'} blanks counted wrong")
        item_rows = [r for r in (json.loads(l) for l in (data / "reviews.jsonl").read_text().splitlines() if l.strip()) if r["kind"] == "item"]
        rep.check(len(item_rows) == 0 and js("Object.keys(App.state.items).length") == 0,
                  "blanks counted wrong in the score are not logged as answers or reviewed by FSRS", f"({len(item_rows)} rows)")
        # A full mock submitted with 2 of 90 answered is a blank sheet, not a measurement: neither the booking rule nor the forecast takes it.
        sched = tab.call("Runtime.evaluate", awaitPromise=True, returnByValue=True, expression="""import('/app/scheduler.js').then((s) => {
          const now = Date.now();
          const row = (extra) => ({ at: now, kind: 'mock', format: 'full', raw: .8, scaled: 780, seconds: 5000, banked: 0, ...extra });
          const rule = (rows) => s.examForecast(App.state, App.content, now, rows);
          const blank = rule([row({ unanswered: 88, answered: 2, of: 90 })]);
          const real = rule([row({ unanswered: 2, answered: 88, of: 90 })]);
          const legacy = rule([row({})]);
          return { blank: blank.stop.rules[1].text, blankMocks: blank.mocks, real: real.stop.rules[1].text, realMocks: real.mocks, legacyMocks: legacy.mocks };
        })""")["result"].get("value") or {}
        rep.check("none taken" in sched.get("blank", "") and sched.get("blankMocks") == 0,
                  "a full mock submitted with 2 of 90 answered is not one of the mocks the booking rule or the forecast counts", f"({sched})")
        rep.check("780" in sched.get("real", "") and sched.get("realMocks") == 1 and sched.get("legacyMocks") == 1,
                  "a mock with 88 of 90 answered, and an older row with no answered count, still count")
        rep.check(not tab.errors[n0:], "no console error", "; ".join(tab.errors[n0:])[:200])
