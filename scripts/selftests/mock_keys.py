"""Self test scenario: mock-keys. Run alone with python3 scripts/selftest.py mock-keys."""
import json, time
from selftest import APP_READY, throwaway, scenario


@scenario("mock-keys", order=157)
def scenario_mock_keys(rep, tmp, browser):
    """The mock runs from the keyboard the way the drill does, a held key does
    not skip questions, the action row stays on screen at 1280x720, and the
    clock is never blank after a render."""
    rep.head("Mock exam: keys, the pinned action row and the clock")
    with throwaway(tmp, "mock-keys") as (base, _):
        tab = browser.tab
        n0 = len(tab.errors)
        tab.call("Emulation.setDeviceMetricsOverride", width=1280, height=720, deviceScaleFactor=1, mobile=False)
        tab.navigate(f"{base}/")
        rep.check(tab.wait_for(APP_READY), "the app boots at 1280x720")
        js = lambda code: tab.evaluate(code)
        click = lambda sel: js(f"document.querySelector({json.dumps(sel)})?.click()")

        def press(k, code=None, vk=0, text=None, repeat=False):
            ev = dict(key=k, code=code or k, windowsVirtualKeyCode=vk, autoRepeat=repeat)
            if text:
                ev["text"] = text
            tab.call("Input.dispatchKeyEvent", type="keyDown", **ev)
            tab.call("Input.dispatchKeyEvent", type="keyUp", **ev)

        letter = lambda c, repeat=False: press(c, code="Key" + c.upper(), vk=ord(c.upper()), text=c, repeat=repeat)
        enter = lambda: press("Enter", vk=13, text="\r")
        idx = lambda: js("App.mock.idx")
        in_view = lambda sel: js(f"""(() => {{ const r = document.querySelector({json.dumps(sel)}).getBoundingClientRect();
          return r.top >= 0 && r.bottom <= innerHeight; }})()""")

        click("[data-action=nav][data-section=mock]")
        click("[data-action=mock-select][data-format=short]")
        click("[data-action=mock-start]")
        rep.check(js("App.mock.items[0].kind") == "pbq", "the block opens on its performance-based question")
        rep.check(in_view("[data-action=mock-next]"), "its Next button is on screen without scrolling", f"({js('document.querySelector(\"[data-action=mock-next]\").getBoundingClientRect().bottom')} of 720)")
        rep.check(js("/\\d+:\\d\\d left/.test(document.getElementById('mock-timer').textContent)"), "the clock reads time left straight after the render")

        js("""{ const m = App.mock;
          m.items[1] = { kind: 'item', item: App.content.itemsById['c-001'] };
          m.items[2] = { kind: 'item', item: App.content.itemsById['sec-1.1-015'] };
          m.items = m.items.filter((e, j) => j < 3 || !['c-001', 'sec-1.1-015'].includes(e.item?.id)); }""")
        letter("n")
        rep.check(idx() == 1, "N moves to the next question")
        rep.check(in_view("[data-action=mock-next]"), "and its Next button is on screen on a multiple choice question")
        optid = lambda i: js(f"document.querySelectorAll('.opts .opt')[{i}].dataset.opt")
        letter("b")
        rep.check(optid(1) is not None and js("App.mock.answers['c-001']") == optid(1), "B picks the second option as shown")
        letter("a")
        rep.check(optid(0) is not None and js("App.mock.answers['c-001']") == optid(0), "A changes the answer, which stays changeable")
        letter("a", repeat=True)
        press("ArrowRight", code="ArrowRight", vk=39, repeat=True)
        rep.check(idx() == 1, "a held key does nothing")
        enter()
        rep.check(idx() == 2, "Enter moves on from an answered question")
        enter()
        rep.check(idx() == 2, "and does not move on from an unanswered one")
        js("delete App.mock.answers['sec-1.1-015']")   # Enter on a focused option presses it, as any button; start the letters clean
        letter("a"); letter("b")
        picked = js("[].concat(App.mock.answers['sec-1.1-015'] || []).length")
        letter("c")
        rep.check(picked == 2 and js("[].concat(App.mock.answers['sec-1.1-015']).length") == 2, "letters toggle choose-two options and stop at two")
        letter("f")
        rep.check(js("App.mock.flagged.has('sec-1.1-015')"), "F flags the question")
        letter("p")
        rep.check(idx() == 1, "P goes back")
        letter("r")
        rep.check(js("App.screen") == "mock-review", "R opens the review grid")
        click("[data-action=mock-resume]")
        click("[data-action=mock-end]")
        rep.check(js("!!App.mock.ending"), "End early opens its dialog")
        press("Escape", vk=27)
        rep.check(js("!App.mock.ending"), "Escape closes it and the clock runs on")
        rep.check(not tab.errors[n0:], "no console error", "; ".join(tab.errors[n0:])[:200])
        tab.call("Emulation.clearDeviceMetricsOverride")
