"""Self test scenario: chrome. Run alone with python3 scripts/selftest.py chrome."""
import json, time
from selftest import APP_READY, poll, throwaway, scenario


@scenario("chrome", order=85)
def scenario_chrome(rep, tmp, browser):
    """The frame around every screen: the phone column never outgrows the
    screen, every section sits in the same column on a wide window, a new
    question starts at the top with focus on its first option, `?` opens the
    shortcut sheet, and the sidebar never scolds."""
    rep.head("Chrome: layout, scroll, focus, shortcut sheet, sidebar tone")
    with throwaway(tmp, "chrome") as (base, _):
        tab = browser.tab
        n0 = len(tab.errors)
        tab.navigate(f"{base}/?scratch=1")
        rep.check(tab.wait_for(APP_READY), "the app boots in scratch mode")

        def press(k, code=None, vk=0, text=None):
            ev = dict(key=k, code=code or k, windowsVirtualKeyCode=vk)
            if text:
                ev["text"] = text
            tab.call("Input.dispatchKeyEvent", type="keyDown", **ev)
            tab.call("Input.dispatchKeyEvent", type="keyUp", **ev)

        enter = lambda: press("Enter", vk=13, text="\r")
        esc = lambda: press("Escape", vk=27)
        space = lambda: press(" ", code="Space", vk=32, text=" ")
        question_mark = lambda: press("?", code="Slash", vk=191, text="?")
        active = lambda: tab.evaluate("(() => { const a = document.activeElement; return a ? a.tagName + (a.id ? '#' + a.id : '') + '.' + String(a.className).split(' ').join('.') : '' })()") or ""
        show = ("App.queue = %s.map((item) => ({ kind: 'item', item, reason: %s }));"
                "App.idx = 0; App.answer = null; App.multiPicked = new Set();"
                "document.querySelector('[data-action=nav][data-section=drill]').click();")

        # --- a phone: nothing is wider than the screen --------------------------
        tab.call("Emulation.setDeviceMetricsOverride", width=390, height=844, deviceScaleFactor=1, mobile=True)
        worst = tab.evaluate("""(() => {
          const mcq = App.content.items.filter((i) => i.type === 'mcq');
          const sample = mcq.filter((_, n) => n % Math.floor(mcq.length / 60) === 0);
          const reasons = ['', 'You missed this belief earlier, so it returns on a different question until two answers in a row are right'];
          let worst = 0, over = 0, widest = '';
          for (const reason of reasons) for (const item of sample) {
            App.queue = [{ kind: 'item', item, reason }]; App.idx = 0; App.answer = null;
            document.querySelector('[data-action=nav][data-section=drill]').click();
            const extra = document.documentElement.scrollWidth - document.documentElement.clientWidth;
            if (extra > 0) { over++; if (extra > worst) { worst = extra; widest = item.id; } }
          }
          return { worst, over, widest, n: sample.length * reasons.length, w: document.documentElement.clientWidth };
        })()""")
        rep.check(worst["over"] == 0,
                  f"phone ({worst['w']}px wide): {worst['n']} drill questions, none wider than the screen",
                  f"({worst['over']} overflow, worst {worst['worst']}px on {worst['widest']})")
        tab.call("Emulation.clearDeviceMetricsOverride")

        # --- one column for every section ---------------------------------------
        for w in (1440, 2560):
            tab.call("Emulation.setDeviceMetricsOverride", width=w, height=900, deviceScaleFactor=1, mobile=False)
            centers = {}
            for name, go in (("drill", show % ("[App.content.items.find((i) => i.type === 'mcq')]", "''")),
                             ("readiness", "document.querySelector('[data-action=nav][data-section=readiness]').click()"),
                             ("settings", "document.querySelector('[data-action=nav][data-section=settings]').click()")):
                tab.evaluate(go)
                centers[name] = tab.evaluate("(() => { const r = document.getElementById('main').getBoundingClientRect(); return r.left + r.width / 2 })()")
            spread = max(centers.values()) - min(centers.values())
            rep.check(spread <= 2, f"{w}px wide: drill, readiness and settings share one column centre", f"({centers})")
        tab.call("Emulation.clearDeviceMetricsOverride")

        # --- a new question starts at the top, focus on its first option --------
        tab.call("Emulation.setDeviceMetricsOverride", width=800, height=600, deviceScaleFactor=1, mobile=False)
        two = "App.content.items.filter((i) => i.type === 'mcq').slice(0, 2)"
        tab.evaluate(show % (two, "''"))
        # a re-render of the question you are on (a press on the guess toggle) leaves the scroll alone
        tab.evaluate("window.scrollTo(0, 120)")
        before = tab.evaluate("scrollY")
        tab.evaluate("document.querySelector('[data-action=toggle-guess]').click()")
        same = tab.evaluate("scrollY")
        rep.check(before > 0 and same == before, "re-rendering the question you are on keeps the scroll where it is", f"({before} -> {same})")
        # a right answer, so the queue keeps its second question (a miss spaces out a neighbour on the same belief)
        tab.evaluate("document.querySelector(`[data-action=answer][data-opt=${App.queue[0].item.options.find((o) => o.correct).id}]`).click()")
        tab.evaluate("window.scrollTo(0, 120)")
        tab.evaluate("document.querySelector('[data-action=next]').click()")
        top = tab.evaluate("scrollY")
        rep.check(top == 0, "Next puts the new question at the top of the page", f"(scrollY {top})")
        rep.check(active().startswith("BUTTON") and tab.evaluate("document.activeElement.dataset.action") == "answer"
                  and tab.evaluate("document.activeElement === document.querySelector('.opts .opt')"),
                  "after Next, focus is on the first option, not the page", f"({active()})")
        # moving on with Enter must not let the same Enter, held or mashed, answer the next question
        right = "document.querySelector(`[data-action=answer][data-opt=${App.queue[App.idx].item.options.find((o) => o.correct).id}]`).click()"
        three = "App.content.items.filter((i) => i.type === 'mcq').slice(2, 5)"
        tab.evaluate(show % (three, "''"))
        tab.evaluate(right)
        enter()
        enter()
        space()
        rep.check(tab.evaluate("App.idx === 1 && App.answer === null"), "an Enter that moves on, then Enter and Space straight after, answers nothing")
        time.sleep(0.4)
        enter()
        rep.check(tab.evaluate("App.answer !== null"), "after a pause, Enter on the focused option answers it")
        tab.evaluate("window.scrollTo(0, 120); document.querySelector('[data-action=nav][data-section=readiness]').click()")
        rep.check(tab.evaluate("scrollY") == 0, "changing screen starts at the top")
        tab.call("Emulation.clearDeviceMetricsOverride")

        # --- the shortcut sheet --------------------------------------------------
        tab.evaluate(show % (two, "''"))
        tab.evaluate("document.querySelector('.opts .opt').focus()")
        opener = active()
        question_mark()
        opened = tab.evaluate("(() => { const d = document.getElementById('keys'); return !!d && d.open && d.contains(document.activeElement) && d.tagName === 'DIALOG' })()")
        rep.check(opened, "? opens the shortcut sheet and focus moves inside it", f"({active()})")
        rep.check(tab.evaluate("!document.body.classList.contains('gloss-open')"), "? no longer expands acronyms")
        rep.check(tab.evaluate("(() => { const t = document.getElementById('keys').textContent; return ['A to J', 'G', 'S', 'X'].every((k) => t.includes(k)) })()"),
                  "the sheet lists the answer, guess, skip and acronym keys")
        press("a", vk=65, text="a")
        rep.check(tab.evaluate("App.answer === null"), "a letter pressed while the sheet is open answers nothing behind it")
        esc()
        closed = poll(lambda: tab.evaluate("!document.getElementById('keys').open"), 3)
        rep.check(closed and active() == opener, "Escape closes the sheet and returns focus to where it was", f"({active()} vs {opener})")
        question_mark()
        question_mark()
        rep.check(tab.evaluate("!document.getElementById('keys').open"), "? again closes it")
        tab.evaluate("document.querySelector('[data-action=keys-open]').click()")
        rep.check(tab.evaluate("document.getElementById('keys').open"), "the sidebar's Shortcuts button opens it for a mouse")
        esc()
        poll(lambda: tab.evaluate("!document.getElementById('keys').open"), 3)
        press("x", vk=88, text="x")
        on = tab.evaluate("document.body.classList.contains('gloss-open')")
        press("x", vk=88, text="x")
        off = tab.evaluate("!document.body.classList.contains('gloss-open')")
        rep.check(on and off, "X expands every acronym and X puts them back")

        # --- the sidebar never scolds -------------------------------------------
        tab.evaluate("document.querySelector('[data-action=nav][data-section=readiness]').click()")
        warn = tab.evaluate("[...document.querySelectorAll('.sidebar .side-stats dd.warn')].map((d) => d.parentElement.textContent.trim())")
        rep.check(warn == [], "a fresh record shows no warning in the sidebar (no streak, no exam date)", f"({warn})")
        tab.evaluate("App.state.streak = { current: 9, best: 9, lastStudied: '2000-01-01' }; document.querySelector('[data-action=nav][data-section=bank]').click()")
        warn = tab.evaluate("[...document.querySelectorAll('.sidebar .side-stats dd.warn')].map((d) => d.parentElement.textContent.trim())")
        rep.check(warn == [], "a lapsed streak is not shown in a warning colour", f"({warn})")

        rep.check(not tab.errors[n0:], "no console error", "; ".join(tab.errors[n0:])[:200])
