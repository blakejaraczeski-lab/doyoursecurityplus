"""Self test scenario: mock-blanks. Run alone with python3 scripts/selftest.py mock-blanks."""
import json, time
from selftest import APP_READY, throwaway, scenario


@scenario("mock-blanks", order=150)
def scenario_mock_blanks(rep, tmp, browser):
    """A mock scores blanks wrong but never logs them, however it ends: the
    timer running out goes through the same grading as Submit, once. An
    untouched PBQ is scored zero and recorded as nothing; a touched one is
    recorded. The 80 percent rule for what counts as a mock sits at 72 of 90."""
    rep.head("Mock exam: blanks, PBQs, the timer and the 80 percent rule")
    with throwaway(tmp, "mock-blanks") as (base, data):
        tab = browser.tab
        n0 = len(tab.errors)
        tab.navigate(f"{base}/")
        rep.check(tab.wait_for(APP_READY), "the app boots")
        js = lambda code: tab.evaluate(code)
        js("window.confirm = () => true")
        click = lambda sel: js(f"document.querySelector({json.dumps(sel)}).click()")
        hide = ("Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' }); document.dispatchEvent(new Event('visibilitychange'));"
                "Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' })")
        def log(kind):
            f = data / "reviews.jsonl"
            rows = [json.loads(l) for l in f.read_text().splitlines() if l.strip()] if f.exists() else []
            return [r for r in rows if r["kind"] == kind]

        def start_short(pbq_id, touched):
            """A short block whose one PBQ is the named ordering PBQ, touched or not, with 3 right answers and the rest blank."""
            click("[data-action=nav][data-section=mock]")
            click("[data-action=mock-select][data-format=short]")
            click("[data-action=mock-start]")
            js(f"""{{ const m = App.mock; const i = m.items.findIndex((e) => e.kind === 'pbq');
              m.items[i] = {{ kind: 'pbq', pbq: App.content.pbqsById['{pbq_id}'], reason: '' }};
              App.answers['{pbq_id}'] = {{ order: {"['recovery']" if touched else "[]"}, held: null }};
              for (const e of m.items.filter((e) => e.kind === 'item').slice(0, 3)) m.answers[e.item.id] = e.item.options.find((o) => o.correct).id; }}""")

        def expire():
            """Let the clock run out: the next one second tick finds nothing left."""
            click("[data-action=mock-review]") if js("!!document.querySelector('[data-action=mock-review]')") else None
            js("document.getElementById('mock-timer').dataset.ends = String(Date.now() - 1)")
            return tab.wait_for("App.screen === 'mock-result'", 6)

        # 1. The timer runs out with an untouched PBQ.
        start_short("pbq-order-001", touched=False)
        rep.check(expire(), "when the timer reaches zero the mock is scored without anyone pressing Submit")
        time.sleep(2.5)    # more ticks and a visibility save: nothing may be scored again
        js(hide)
        time.sleep(0.8)
        mocks = log("mock")
        rep.check(len(mocks) == 1, "and it is scored once, however many ticks follow", f"({len(mocks)} mock rows)")
        m = mocks[0] if mocks else {}
        rep.check(m.get("of") == 20 and m.get("answered") == 3 and m.get("unanswered") == 16,
                  "the row says 3 answered of 20 (the untouched PBQ is not an answer) and 16 blank", f"({m})")
        rep.check(len(log("item")) == 3, "only the 3 answered questions are logged as answers", f"({len(log('item'))} rows)")
        rep.check(len(log("pbq")) == 0 and js("App.state.pbq['pbq-order-001'] === undefined"),
                  "the untouched PBQ has no attempt, no best score and no row")
        rep.check(js("Object.keys(App.state.misconceptions).length") == 0,
                  "and banks no misconception, though its blank sheet is scored wrong")
        rep.check(js("App.mock.result.unanswered") == 16 and js("App.mock.result.raw") < 0.5, "the score still counts every blank and the PBQ as wrong")
        click("[data-action=mock-done]")
        js("App.mock = null")

        # 2. The same block with the PBQ touched: it is an answer, and it records.
        start_short("pbq-order-001", touched=True)
        click("[data-action=mock-review]")
        click("[data-action=mock-submit]")
        tab.wait_for("App.screen === 'mock-result'", 6)
        js(hide)
        time.sleep(0.8)
        mocks = log("mock")
        rep.check(len(mocks) == 2 and mocks[-1].get("answered") == 4 and mocks[-1].get("of") == 20,
                  "a touched PBQ counts as answered: 4 of 20 with it in the mix", f"({mocks[-1] if mocks else None})")
        rep.check(len(log("pbq")) == 1 and js("App.state.pbq['pbq-order-001'].attempts") == 1,
                  "and it records one attempt", f"({len(log('pbq'))} pbq rows)")
        rep.check(js("App.state.pbq['pbq-order-001'].best") < 100 and js("Object.keys(App.state.misconceptions).length") > 0,
                  "a partly wrong touched sheet banks its misconceptions, as in a drill")
        click("[data-action=mock-done]")

        # 3. What counts as a mock: 72 of 90 does, 71 of 90 does not.
        edge = tab.call("Runtime.evaluate", awaitPromise=True, returnByValue=True, expression="""import('/app/scheduler.js').then((s) => {
          const now = Date.now();
          const n = (answered) => s.examForecast(App.state, App.content, now, [{ at: now, kind: 'mock', format: 'full', raw: .8, scaled: 780, seconds: 5000, unanswered: 90 - answered, answered, of: 90, banked: 0 }]).mocks;
          return { at72: n(72), at71: n(71), at90: n(90) };
        })""")["result"].get("value") or {}
        rep.check(edge.get("at72") == 1 and edge.get("at71") == 0 and edge.get("at90") == 1,
                  "a mock counts toward the forecast at 72 of 90 answered and not at 71", f"({edge})")

        # 4. A mock's option order survives leaving a question and coming back.
        click("[data-action=nav][data-section=mock]")
        click("[data-action=mock-select][data-format=short]")
        click("[data-action=mock-start]")
        orders = js("""(() => {
          const click = (a) => document.querySelector(`[data-action=${a}]`).click();
          const grab = () => [...document.querySelectorAll('.opts .opt')].map((b) => b.dataset.opt).join();
          while (App.mock.items[App.mock.idx].kind !== 'item') click('mock-next');
          const seen = [grab()];
          for (let k = 0; k < 3; k++) { click('mock-next'); click('mock-prev'); seen.push(grab()); }
          return seen;
        })()""")
        rep.check(len(orders) == 4 and len(set(orders)) == 1 and orders[0].count(",") >= 3, "a mock question shows its options in the same order on every revisit", f"({orders})")
        rep.check(not tab.errors[n0:], "no console error", "; ".join(tab.errors[n0:])[:200])
