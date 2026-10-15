"""Self test scenario: mock-multi. Run alone with python3 scripts/selftest.py mock-multi."""
import json, time
from selftest import APP_READY, throwaway, scenario

MULTI = "sec-1.1-015"   # choose two: a and b are right, c and d are not


@scenario("mock-multi", order=155)
def scenario_mock_multi(rep, tmp, browser):
    """A choose-two question in a mock takes two picks and scores all or
    nothing, as the exam and the drill do. The result then lists every miss
    and blank with its explanation, says how the sitting stands against the
    booking rule, and says so when the clock ended it."""
    rep.head("Mock exam: choose two, all or nothing, and the result review")
    with throwaway(tmp, "mock-multi") as (base, data):
        tab = browser.tab
        n0 = len(tab.errors)
        tab.navigate(f"{base}/")
        rep.check(tab.wait_for(APP_READY), "the app boots")
        js = lambda code: tab.evaluate(code)
        js("window.confirm = () => true")   # HEAD asks with a native dialog, which would stall the run
        click = lambda sel: js(f"document.querySelector({json.dumps(sel)})?.click()")
        text = lambda: js("document.getElementById('main').innerText") or ""
        hide = ("Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' }); document.dispatchEvent(new Event('visibilitychange'));"
                "Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' })")

        def rows(kind):
            f = data / "reviews.jsonl"
            all_ = [json.loads(l) for l in f.read_text().splitlines() if l.strip()] if f.exists() else []
            return [r for r in all_ if r["kind"] == kind]

        def start_with_multi():
            """A short block whose first multiple choice question is the choose-two item, on screen."""
            click("[data-action=nav][data-section=mock]")
            click("[data-action=mock-select][data-format=short]")
            click("[data-action=mock-start]")
            js(f"""{{ const m = App.mock; const i = m.items.findIndex((e) => e.kind === 'item');
              m.items[i] = {{ kind: 'item', item: App.content.itemsById['{MULTI}'] }}; m.idx = i;
              m.items = m.items.filter((e, j) => j === i || e.item?.id !== '{MULTI}'); }}""")   # answers are keyed by id: one entry per id, or it is scored twice
            click("[data-action=mock-review]")
            click("[data-action=mock-resume]")

        opt = lambda ok, n=0: js(f"App.content.itemsById['{MULTI}'].options.filter((o) => !!o.correct === {str(ok).lower()})[{n}].id")
        pick = lambda oid: click(f"[data-action=mock-answer][data-opt={oid}]")
        picked = lambda: js(f"[].concat(App.mock.answers['{MULTI}'] || [])")

        start_with_multi()
        rep.check("choose 2" in text().lower() and js("document.querySelectorAll('.opts [role=checkbox]').length") == 4,
                  "the question says choose 2 and its options are checkboxes")
        a, b, bad = opt(True, 0), opt(True, 1), opt(False, 0)
        pick(a)
        rep.check(picked() == [a] and "1 of 2 selected" in text(), "one pick is held, not replaced, and the count says 1 of 2")
        rep.check("1 of 2" in (js("document.querySelector('[data-action=mock-review]').click(), document.querySelector('.rv.here')?.getAttribute('aria-label')") or ""),
                  "the review grid calls it partly answered, 1 of 2")
        click("[data-action=mock-resume]")
        pick(b)
        rep.check(sorted(picked()) == sorted([a, b]) and "2 of 2 selected" in text(), "a second pick makes 2 of 2")
        pick(bad)
        rep.check(sorted(picked()) == sorted([a, b]), "a third pick is not added: deselect one first")
        pick(a)
        rep.check(picked() == [b], "pressing a pick again takes it back")
        pick(a)
        click("[data-action=mock-review]")
        rep.check(js("document.querySelectorAll('.rv.answered').length") >= 1 and js("!!document.querySelector('.rv.here.answered')"),
                  "with both picked the question is answered in the review grid")
        click("[data-action=mock-submit]")
        tab.wait_for("App.screen === 'mock-result'", 6)
        js(hide); time.sleep(0.8)
        item = rows("item")
        rep.check(len(item) == 1 and item[0]["id"] == MULTI and item[0]["grade"] == 3,
                  "submitting scores the right pair as correct (a good review, not a miss)", f"({item})")
        rep.check(js("Object.keys(App.state.misconceptions).length") == 0, "and banks nothing")
        rev = js(f"App.mock.result.review.find((r) => r.id === '{MULTI}')") or {}
        rep.check(rev.get("correct") is True, "the result's review has it as correct", f"({rev})")

        # The result: a review of every miss and blank with its explanation, and where the sitting stands.
        t = text()
        rep.check(js("document.querySelectorAll('.rev-item').length") >= 10 and "Review every question" in t,
                  "the result lists the questions, misses and blanks first")
        rep.check("Booking rule" in t and "full mock" in t.lower(),
                  "and says how the sitting stands against the booking rule")
        rep.check(js("document.querySelectorAll('.rev-item[data-state=blank]').length") >= 10
                  and js("[...document.querySelectorAll('.rev-item[data-state=blank]')].every((d) => d.querySelector('.rev-why'))"),
                  "every blank is listed with an explanation")
        click("[data-action=mock-done]")

        # One right and one wrong, and one right alone, are both wrong: all or nothing.
        for label, picks in (("one right and one wrong", lambda: (pick(a), pick(bad))), ("only one of the two", lambda: pick(a))):
            start_with_multi()
            picks()
            click("[data-action=mock-review]")
            click("[data-action=mock-submit]")
            tab.wait_for("App.screen === 'mock-result'", 6)
            js(hide); time.sleep(0.8)
            last = [r for r in rows("item") if r["id"] == MULTI][-1]
            rev = js(f"App.mock.result.review.find((r) => r.id === '{MULTI}')") or {}
            rep.check(last["grade"] == 1 and rev.get("correct") is False, f"{label} is wrong, all or nothing", f"({last}, {rev})")
            if label.startswith("one right and one"):
                body = text()
                rep.check(js("!!document.querySelector('.rev-item .rev-opt.picked-wrong .rev-glyph')"),
                          "the wrong pick is a fully red row carrying a cross", body[:0])
            click("[data-action=mock-done]")

        # The clock ending the sitting is said, in the page and to a screen reader.
        click("[data-action=nav][data-section=mock]")
        click("[data-action=mock-select][data-format=short]")
        click("[data-action=mock-start]")
        js("document.getElementById('mock-timer').dataset.ends = String(Date.now() - 1)")
        rep.check(tab.wait_for("App.screen === 'mock-result'", 6), "when the clock reaches zero the mock is scored")
        t = text()
        rep.check("Time ran out" in t and "scored wrong" in t, "and the result says time ran out and what that did")
        rep.check("Time ran out" in (js("document.getElementById('live').textContent") or "") or tab.wait_for("document.getElementById('live').textContent.includes('Time ran out')", 3),
                  "and it is announced")
        rep.check(not tab.errors[n0:], "no console error", "; ".join(tab.errors[n0:])[:200])
