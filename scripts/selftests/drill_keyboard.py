"""Self test scenario: keyboard. Run alone with python3 scripts/selftest.py keyboard."""
import json, re, time
from selftest import APP_READY, poll, throwaway, scenario


ACTIVE_JS = """(() => { const a = document.activeElement; if (!a || a === document.body) return 'BODY';
  const ds = Object.entries(a.dataset || {}).map(([k, v]) => k + '=' + v).join(',');
  return a.tagName + (a.id ? '#' + a.id : '') + '.' + String(a.className.baseVal ?? a.className).split(' ').filter(Boolean).join('.')
    + (ds ? '[' + ds + ']' : ''); })()"""


@scenario("keyboard", order=80)
def scenario_keyboard(rep, tmp, browser):
    """Keyboard and the accessibility tree, read from Chrome itself: focus
    survives every render, every control under main has a name, a control's
    state is in its name or its ARIA state, and a change is announced."""
    rep.head("Keyboard and the accessibility tree")
    with throwaway(tmp, "keyboard") as (base, _):
        tab = browser.tab
        n0 = len(tab.errors)
        tab.call("Accessibility.enable")
        tab.navigate(f"{base}/?scratch=1")
        rep.check(tab.wait_for(APP_READY), "the app boots in scratch mode")

        def press(k, code=None, vk=0, text=None):
            ev = dict(key=k, code=code or k, windowsVirtualKeyCode=vk)
            if text:
                ev["text"] = text
            tab.call("Input.dispatchKeyEvent", type="keyDown", **ev)
            tab.call("Input.dispatchKeyEvent", type="keyUp", **ev)

        enter = lambda: press("Enter", vk=13, text="\r")
        space = lambda: press(" ", code="Space", vk=32, text=" ")
        tab_key = lambda: press("Tab", vk=9)
        active = lambda: tab.evaluate(ACTIVE_JS) or ""
        focus = lambda sel: tab.evaluate(f"document.querySelector({json.dumps(sel)}).focus()")

        def said():
            """What the live region says, once it says anything (it is cleared then filled)."""
            out = [""]
            poll(lambda: out.__setitem__(0, tab.evaluate("document.getElementById('live').textContent") or "") or out[0], 3)
            return out[0]

        def clear_said():
            tab.evaluate("document.getElementById('live').textContent = ''")

        def nameless(label):
            """Controls under main that Chrome exposes with no accessible name."""
            nodes = tab.call("Accessibility.getFullAXTree")["nodes"]
            by_id = {n["nodeId"]: n for n in nodes}
            main = next((n for n in nodes if n.get("role", {}).get("value") == "main"), None)
            bad, total = [], 0
            def walk(n):
                nonlocal total
                role = n.get("role", {}).get("value", "")
                if not n.get("ignored") and role in ("button", "combobox", "textbox", "checkbox", "link", "switch", "slider"):
                    total += 1
                    if not n.get("name", {}).get("value", "").strip():
                        bad.append(role)
                for c in n.get("childIds", []):
                    if c in by_id:
                        walk(by_id[c])
            if main:
                walk(main)
            rep.check(main is not None and not bad, f"{label}: {total} controls under main, every one named", f"({len(bad)} nameless: {bad[:6]})")

        # One single-select and one multi-select item, taken from the bank
        # rather than from the random queue, which need not hold a choose-two.
        # Two questions on unrelated beliefs, so a miss on the first never spaces the second out.
        tab.evaluate("{ const one = App.content.items.find((i) => i.type === 'mcq');"
                     "const mcs = new Set(one.options.map((o) => o.misconception).filter(Boolean));"
                     "const two = App.content.items.find((i) => i.type === 'mcq-multi' && !i.options.some((o) => mcs.has(o.misconception) || mcs.has(o.missedMisconception)));"
                     "App.queue = [one, two].map((item) => ({ kind: 'item', item, reason: '' }));"
                     "App.idx = 0; document.querySelector('[data-action=nav][data-section=drill]').click() }")
        nameless("drill, single select")
        focus("[data-action=answer][data-opt=b]")
        clear_said()
        enter()
        rep.check(active().startswith("DIV.verdict-banner"), "Enter on option B answers it and focus lands on the verdict", f"({active()})")
        rep.check("orrect" in said(), "the verdict is announced", f"({said()!r})")
        # Between the verdict and Next sits the correction, when there is one.
        path = []
        for _ in range(4):
            tab_key()
            path.append(active())
            if path[-1] == "BUTTON.btn[action=next]":
                break
        rep.check(path[-1] == "BUTTON.btn[action=next]" and tab.evaluate("document.getElementById('main').contains(document.activeElement)"),
                  f"Tab from the verdict reads down to Next in {len(path)} step{'s' if len(path) != 1 else ''}", f"({path})")
        nameless("drill, answered")
        # A click on a short window: the verdict is brought into view, not left below the fold.
        tab.call("Emulation.setDeviceMetricsOverride", width=800, height=600, deviceScaleFactor=1, mobile=False)
        tab.evaluate("App.idx = 0; App.answer = null; window.scrollTo(0, 0); document.querySelector('[data-action=nav][data-section=drill]').click()")
        tab.evaluate("document.querySelector('[data-action=answer][data-opt=a]').click()")
        seen = tab.evaluate("(() => { const r = document.querySelector('.verdict-banner').getBoundingClientRect(); return r.top >= 0 && r.bottom <= innerHeight + 1; })()")
        tab.call("Emulation.clearDeviceMetricsOverride")
        rep.check(seen and active().startswith("DIV.verdict-banner"), "on an 800 x 600 window a clicked answer's verdict is in view and has focus", f"({active()})")
        tab.evaluate("App.idx = 0; App.answer = null; document.querySelector('[data-action=nav][data-section=drill]').click()")
        focus("[data-action=answer][data-opt=b]")
        enter()
        enter()
        focus("[data-action=multi-toggle][data-opt=a]")
        time.sleep(0.25)   # each answer above announces on its own 30 ms timer; let every one land before clearing for good
        clear_said()
        space()
        rep.check(active().startswith("BUTTON.opt.chosen[action=multi-toggle,opt=a]")
                  and tab.evaluate("document.activeElement.getAttribute('aria-checked') === 'true'"),
                  "Space on a choose-two option checks it and keeps focus on it", f"({active()})")
        rep.check("1 of" in said(), "the count is announced", f"({said()!r})")

        # The ACL grid.
        tab.evaluate("document.querySelector('[data-action=nav][data-section=lab]').click();"
                     "document.querySelector('[data-action=open-pbq][data-id=pbq-acl-001]').click()")
        focus("[data-action=acl-add]")
        enter()
        rep.check(active() == "BUTTON.btn.ghost.small[action=acl-add]", "Enter on Add rule adds one and keeps focus on Add rule", f"({active()})")
        order = []
        for _ in range(7):
            tab_key()
            order.append(tab.evaluate("document.activeElement.getAttribute('aria-label')"))
        rep.check(order == ["Rule 1 action", "Rule 1 protocol", "Rule 1 source", "Rule 1 source port",
                            "Rule 1 destination", "Rule 1 destination port", "Delete rule 1"],
                  "Tab walks the rule left to right and every control says which rule and column it is", f"({order})")
        nameless("ACL grid")

        # The network diagram.
        tab.evaluate("App.lab = null; document.querySelector('[data-action=nav][data-section=lab]').click();"
                     "document.querySelector('[data-action=open-pbq][data-id=pbq-diagram-001]').click()")
        rep.check(tab.evaluate("!document.querySelector('[data-node]:not([tabindex])[role]')"
                               " && document.querySelector('svg.diagram').getAttribute('role') === 'group'"),
                  "a host with nothing to open is not a control, and the diagram is a group, not an image")
        focus("[data-node][tabindex]")
        host = active().split("[")[-1]   # the node id; the class changes once it is inspected
        clear_said()
        enter()
        rep.check(active().endswith(host) and ".inspected" in active() and "evidence" in said(),
                  "Enter on a host opens its evidence, keeps focus on the host, and says so", f"({active()} said {said()!r})")
        rep.check(tab.evaluate("document.activeElement.getAttribute('aria-label').includes(', reviewed')"),
                  "the host's name now carries its reviewed state")
        nameless("network diagram")

        # Order and classify.
        tab.evaluate("App.lab = null; document.querySelector('[data-action=nav][data-section=lab]').click();"
                     "document.querySelector('[data-action=open-pbq][data-id=pbq-order-001]').click()")
        focus("[data-action=order-hold]")
        chip = active()
        clear_said()
        enter()
        rep.check(active() == chip.replace("BUTTON.chip[", "BUTTON.chip.held[") and
                  tab.evaluate("document.activeElement.getAttribute('aria-pressed') === 'true'") and "Holding" in said(),
                  "Enter on a chip holds it, keeps focus, states pressed, and says what to do next", f"({active()} said {said()!r})")
        rep.check(tab.evaluate("document.querySelector('[data-action=order-place-at]').getAttribute('aria-label')").startswith("Position 1: place "),
                  "each position says what pressing it will do")
        nameless("order")

        # The mock: a chosen option is pressed, the review grid speaks its states.
        tab.evaluate("App.lab = null; document.querySelector('[data-action=nav][data-section=mock]').click();"
                     "document.querySelector('[data-action=mock-select][data-format=short]').click(); document.querySelector('[data-action=mock-start]').click();"
                     "App.mock.idx = App.mock.items.findIndex((e) => e.kind === 'item' && e.item.type === 'mcq');"
                     "document.querySelector('[data-action=nav][data-section=mock]').click()")
        focus("[data-action=mock-answer][data-opt=a]")
        enter()
        rep.check(active().startswith("BUTTON.opt.chosen[action=mock-answer,opt=a]")
                  and tab.evaluate("document.activeElement.getAttribute('aria-pressed') === 'true'"),
                  "a chosen mock option keeps focus and is pressed", f"({active()})")
        tab.evaluate("document.querySelector('[data-action=mock-review]').click()")
        labels = tab.evaluate("[...document.querySelectorAll('.rv')].map((b) => b.getAttribute('aria-label'))")
        rep.check(labels and all(l.startswith("Question ") and (", answered" in l or ", blank" in l) for l in labels)
                  and sum(", answered" in l for l in labels) == 1,
                  "every review cell says its number and whether it is answered", f"({labels[:3]})")
        nameless("mock review")

        ring = tab.evaluate("document.querySelector('.goal-ring').getAttribute('aria-label')") or ""
        rep.check(re.fullmatch(r"\d+ of \d+ reviews today", ring), f"the goal ring is one image with a name: {ring!r}")
        rep.check(not tab.errors[n0:], "no console error", "; ".join(tab.errors[n0:])[:200])
