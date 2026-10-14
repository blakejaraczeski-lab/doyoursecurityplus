"""Self test scenario: stress. Run alone with python3 scripts/selftest.py stress."""
import json, os, subprocess, sys, time, pathlib
from selftest import ROOT, APP_READY, free_port, wait_http, poll, on_disk, scenario


class Server:
    """A throwaway serve.py that can be killed and restarted on the same port and data."""

    def __init__(self, data):
        self.data, self.port, self.proc = data, free_port(), None
        if "DYSP_DATA" not in {**os.environ, "DYSP_DATA": str(data)}:
            raise RuntimeError("refusing to start a server without DYSP_DATA")

    def start(self):
        self.proc = subprocess.Popen([sys.executable, str(ROOT / "serve.py"), str(self.port)],
                                     env={**os.environ, "DYSP_DATA": str(self.data)},
                                     stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        raw = wait_http(f"http://127.0.0.1:{self.port}/api/health")
        if not raw or json.loads(raw)["stateFile"] != str(pathlib.Path(self.data) / "state.json"):
            raise RuntimeError("refusing to proceed: the server is not on the throwaway directory")
        return f"http://127.0.0.1:{self.port}"

    def stop(self):
        if self.proc and self.proc.poll() is None:
            self.proc.kill()
            self.proc.wait(timeout=5)


@scenario("stress", order=130)
def scenario_stress(rep, tmp, browser):
    """Freiberg's test: every control under input nobody designs for."""
    rep.head("Stress: input nobody designs for")
    data = pathlib.Path(tmp) / "stress"
    data.mkdir()
    server = Server(data)
    base = server.start()
    tab = browser.tab
    t_start = time.time()
    try:
        def press(k, code=None, vk=0, text=None):
            ev = dict(key=k, code=code or k, windowsVirtualKeyCode=vk)
            if text:
                ev["text"] = text
            tab.call("Input.dispatchKeyEvent", type="keyDown", **ev)
            tab.call("Input.dispatchKeyEvent", type="keyUp", **ev)
        enter = lambda: press("Enter", vk=13, text="\r")
        hide = lambda: tab.evaluate("Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });"
                                    "document.dispatchEvent(new Event('visibilitychange'));"
                                    "Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' });")
        def settle():
            hide()
            time.sleep(0.8)
        rows = lambda kind=None: [json.loads(l) for l in (data / "reviews.jsonl").read_text().splitlines()
                                  if l.strip() and (kind is None or json.loads(l)["kind"] == kind)] if (data / "reviews.jsonl").exists() else []
        size = lambda: (data / "state.json").stat().st_size if (data / "state.json").exists() else 0
        focus_ok = lambda: tab.evaluate("document.activeElement !== document.body && document.contains(document.activeElement)")
        disk = lambda: json.loads((data / "state.json").read_text()) if (data / "state.json").exists() else {}
        # Every case asserts the saved document holds exactly what doing the
        # action once would leave: unchanged where nothing was submitted, one
        # record's worth where something was.
        n0 = len(tab.errors)
        tab.navigate(f"{base}/")
        rep.check(tab.wait_for(APP_READY), "the app boots")

        # 1. Enter mashed twenty times on a submitted question, multiple choice then PBQ.
        tab.evaluate("{ const mc = App.content.items.filter((i) => i.type === 'mcq');"
                     "App.queue = mc.slice(0, 3).map((item) => ({ kind: 'item', item, reason: '' })); App.idx = 0; App.answer = null;"
                     "document.querySelector('[data-action=nav][data-section=drill]').click() }")
        press("a", vk=65, text="a")
        settle()
        before_rows, before_size = len(rows("item")), size()
        for _ in range(20):
            enter()
        settle()
        rep.check(tab.evaluate("App.idx") == 1 and tab.evaluate("App.answer") is None and len(rows("item")) == before_rows == 1,
                  "Enter x20 on an answered question moves on once and answers nothing", f"(idx {tab.evaluate('App.idx')}, {len(rows('item'))} rows)")
        rep.check(abs(size() - before_size) <= 16, f"the state document did not grow ({before_size} to {size()} bytes)")
        rep.check(focus_ok(), "focus is on a control afterwards", f"({tab.evaluate('document.activeElement.tagName')})")

        tab.evaluate("App.queue = ['pbq-order-001', 'pbq-order-002'].map((id) => ({ kind: 'pbq', pbq: App.content.pbqsById[id], reason: '' }));"
                     "App.idx = 0; App.answer = null; App.graded = null; App.answers = {}; App.answers['pbq-order-001'] = { order: [], held: null };"
                     "document.querySelector('[data-action=nav][data-section=drill]').click()")
        press("a", vk=65, text="a"); press("1", code="Digit1", vk=49, text="1")
        before_pbq = len(rows("pbq"))
        attempts0 = (disk().get("pbq", {}).get("pbq-order-001") or {}).get("attempts", 0)
        for _ in range(20):
            enter()
        settle()
        rep.check(len(rows("pbq")) == before_pbq + 1 and tab.evaluate("App.idx") == 1 and tab.evaluate("!App.graded"),
                  "Enter x20 on a PBQ submits it once and never submits the next one blank",
                  f"({len(rows('pbq')) - before_pbq} PBQ rows, idx {tab.evaluate('App.idx')})")
        pbq_state = disk().get("pbq", {})
        rep.check((pbq_state.get("pbq-order-001") or {}).get("attempts") == attempts0 + 1 and "pbq-order-002" not in pbq_state,
                  "the saved document records one attempt on that PBQ and none on the next", f"({pbq_state})")
        rep.check(focus_ok(), "focus is on a control afterwards")

        # 1b. A deliberate miss: the next question on the same belief moves out of the way.
        tab.evaluate("""{ const mc = 'salting-purpose';
          const t = App.content.items.filter((i) => i.type === 'mcq' && i.options.some((o) => o.misconception === mc));
          const o = App.content.items.filter((i) => i.type === 'mcq' && !i.options.some((x) => x.misconception === mc)).slice(0, 4);
          App.queue = [t[0], t[1], ...o].map((item) => ({ kind: 'item', item, reason: '' })); App.idx = 0; App.answer = null;
          document.querySelector('[data-action=nav][data-section=drill]').click();
          const wrong = t[0].options.find((x) => x.misconception === mc);
          document.querySelector(`[data-action=answer][data-opt=${wrong.id}]`).click(); }""")
        spaced = tab.evaluate("App.queue.slice(1, 4).every((e) => !e.item.options.some((o) => o.misconception === 'salting-purpose'))"
                              " && App.queue.some((e, i) => i > 3 && e.item.options.some((o) => o.misconception === 'salting-purpose'))")
        rep.check(spaced, "a miss moves the next question on the same belief past the next three answers, without dropping it")
        settle()   # its rows land before the next step takes a baseline

        # 2. A mock submitted twice in one frame.
        tab.evaluate("window.confirm = () => true; document.querySelector('[data-action=nav][data-section=mock]').click();"
                     "document.querySelector('[data-action=mock-select][data-format=short]').click(); document.querySelector('[data-action=mock-start]').click()")
        items_before, mocks_before = len(rows("item")), len(rows("mock"))
        hits = lambda: sum(m.get("hits", 0) for m in disk().get("misconceptions", {}).values())
        hits0, banked0 = hits(), len([r for r in rows("misconception") if r.get("grade", 3) <= 1])
        # Three answered (each a wrong option, so each banks a correction); every other item is left blank.
        tab.evaluate("{ for (const e of App.mock.items.filter((e) => e.kind === 'item').slice(0, 3)) App.mock.answers[e.item.id] = e.item.options.find((o) => !o.correct).id; }")
        answered = tab.evaluate("Object.keys(App.mock.answers).length")
        tab.evaluate("{ document.querySelector('[data-action=mock-review]').click();"
                     "const b = document.querySelector('[data-action=mock-submit]');"
                     "b.dispatchEvent(new MouseEvent('click', { bubbles: true })); b.dispatchEvent(new MouseEvent('click', { bubbles: true })); }")
        settle()
        n_items = tab.evaluate("App.mock.items.filter((e) => e.kind === 'item').length")
        rep.check(len(rows("mock")) == mocks_before + 1 and len(rows("item")) == items_before + answered and tab.evaluate("App.screen") == "mock-result",
                  f"a mock submitted twice in one frame is scored once: 1 mock row, {answered} answer rows (the {n_items - answered} blanks are scored wrong but not logged)",
                  f"({len(rows('mock')) - mocks_before} mock rows, {len(rows('item')) - items_before} answer rows)")
        banked = len([r for r in rows("misconception") if r.get("grade", 3) <= 1]) - banked0
        rep.check(hits() - hits0 == banked,
                  f"the saved document counts each miss once: {hits() - hits0} misses added, {banked} corrections logged")
        rep.check(focus_ok(), "focus is on a control afterwards")
        tab.evaluate("document.querySelector('[data-action=mock-done]').click()")

        # 3. A chip held, the viewport narrowed to 375 px, then placed.
        settle()
        size3 = size()
        tab.evaluate("App.lab = null; document.querySelector('[data-action=nav][data-section=lab]').click();"
                     "document.querySelector('[data-action=open-pbq][data-id=pbq-order-003]').click()")
        cfg_mode = tab.evaluate("App.lab.config.mode")
        press("a", vk=65, text="a")
        tab.call("Emulation.setDeviceMetricsOverride", width=375, height=740, deviceScaleFactor=1, mobile=True)
        time.sleep(0.3)
        held = tab.evaluate("App.answers['pbq-order-003'].held")
        press("1", code="Digit1", vk=49, text="1")
        placed = tab.evaluate("JSON.stringify(App.answers['pbq-order-003'])")
        wide = tab.evaluate("document.documentElement.scrollWidth > document.documentElement.clientWidth + 1")
        tab.call("Emulation.clearDeviceMetricsOverride")
        rep.check(held and held in placed and not tab.evaluate("App.answers['pbq-order-003'].held"),
                  f"a chip held across a resize to 375 px is still held and places ({cfg_mode})", f"({placed[:120]})")
        rep.check(not wide, "and the page does not scroll sideways at 375 px")
        settle()
        rep.check(size() == size3, f"nothing was submitted, so the saved document is unchanged ({size3} to {size()} bytes)")
        rep.check(focus_ok(), "focus is on a control afterwards")

        # 4. Eight ACL rules, every select cycled at full speed, then Tab looped from the last cell.
        size4 = size()
        tab.evaluate("App.lab = null; document.querySelector('[data-action=nav][data-section=lab]').click();"
                     "document.querySelector('[data-action=open-pbq][data-id=pbq-acl-001]').click();"
                     "for (let i = 0; i < 8; i++) document.querySelector('[data-action=acl-add]').click();")
        changes = tab.evaluate("""(() => { let n = 0;
          for (const sel of document.querySelectorAll('select[data-acl]')) {
            for (const o of [...sel.options, sel.options[0]]) { sel.value = o.value; sel.dispatchEvent(new Event('change', { bubbles: true })); n++; }
          } return n; })()""")
        tab.evaluate("[...document.querySelectorAll('select[data-acl]')].at(-1).focus()")
        lost = 0
        # Tabbing past the last control leaves the document (headless Linux Chrome parks on body for
        # one press before wrapping); that stop is the exit, not lost focus, and a page must not trap it.
        for _ in range(40):
            leaving = tab.evaluate("(() => { const t = [...document.querySelectorAll('a[href],button,input,select,textarea,[tabindex]:not([tabindex=\"-1\"])')]"
                                   ".filter((e) => !e.disabled && e.offsetParent); return document.activeElement === t.at(-1); })()")
            press("Tab", vk=9)
            if not leaving and not focus_ok():
                lost += 1
        rules = tab.evaluate("App.answers['pbq-acl-001'].rules.length")
        lines = tab.evaluate("document.querySelectorAll('#acl-readout li').length")
        rep.check(rules == 8 and lines == 9, f"{changes} select changes across 8 rules: 8 rules kept, the readout shows 8 and the implicit deny",
                  f"({rules} rules, {lines} lines)")
        rep.check(lost == 0, "40 Tabs from the last cell never drop focus to the page", f"({lost} lost)")
        settle()
        rep.check(size() == size4, f"nothing was submitted, so the saved document is unchanged ({size4} to {size()} bytes)")

        # 5. The exam date set, cleared and set again inside one session.
        tab.evaluate("document.querySelector('[data-action=nav][data-section=settings]').click()")
        set_date = lambda v: tab.evaluate(f"{{ const d = document.getElementById('f-date'); d.value = {json.dumps(v)}; d.dispatchEvent(new Event('change', {{ bubbles: true }})) }}")
        set_date("2026-12-01")
        settle()
        once = {k: v for k, v in disk().items() if k != "updatedAt"}
        set_date("")
        set_date("2026-12-01")
        settle()
        rep.check({k: v for k, v in disk().items() if k != "updatedAt"} == once,
                  "set, cleared and set again leaves the same document as setting it once")
        on_disk = json.loads((data / "state.json").read_text())["profile"]["examDate"]
        tab.evaluate("document.querySelector('[data-action=nav][data-section=drill]').click()")
        rep.check(on_disk == "2026-12-01" and tab.evaluate("App.state.profile.examDate") == "2026-12-01"
                  and not tab.evaluate("!!document.querySelector('.exam-bar input')"),
                  "an exam date set, cleared and set again ends set, on disk, and the drill stops asking")
        rep.check(focus_ok(), "focus is on a control afterwards")
        rep.check(not tab.errors[n0:], "no console error so far", "; ".join(tab.errors[n0:])[:200])

        # 6. The server killed mid-session, twelve answers, the server back, the tab hidden.
        n1 = len(tab.errors)
        # Twelve questions that share no misconception: a miss moves a later question on the same belief out of a
        # short session, so the count answered would depend on the bank, and on which wrong option the shuffle shows.
        tab.evaluate("{ const used = new Set(); const mc = [];"
                     "for (const i of App.content.items.filter((i) => i.type === 'mcq')) {"
                     "  const ids = i.options.map((o) => o.misconception).filter(Boolean);"
                     "  if (mc.length < 12 && !ids.some((m) => used.has(m))) { mc.push(i); ids.forEach((m) => used.add(m)); } }"
                     "App.queue = mc.map((item) => ({ kind: 'item', item, reason: '' })); App.idx = 0; App.answer = null;"
                     "document.querySelector('[data-action=nav][data-section=drill]').click() }")
        before = len(rows("item"))
        given0 = tab.evaluate("App.sessionStats.answered")
        seen0 = tab.evaluate("Object.fromEntries(App.queue.map((e) => [e.item.id, App.state.items[e.item.id]?.seen || 0]))")
        server.stop()
        for _ in range(12):
            # Options shuffle on render, so a fixed letter is sometimes right; press the letter shown on a wrong one.
            k = tab.evaluate("(() => { const e = App.queue[App.idx]; const i = [...document.querySelectorAll('.opts .opt')]"
                             ".findIndex((b) => !e.item.options.find((o) => o.id === b.dataset.opt).correct); return 'abcdefghij'[i < 0 ? 0 : i]; })()")
            press(k, vk=ord(k.upper()), text=k)
            enter()
        # A miss can move a later question on the same belief out of a short
        # session, so the count is what was actually answered, not the queue length.
        given = tab.evaluate("App.sessionStats.answered") - given0
        offline = tab.evaluate("JSON.parse(localStorage.getItem('dysp.v1.outbox') || '[]').filter((r) => r.kind === 'item').length")
        server.start()
        settle()
        poll(lambda: len(rows("item")) >= before + given, 6)
        logged = rows("item")[before:]
        ids = [r["id"] for r in logged]
        rep.check(given >= 10 and offline == given, f"while the server was down, all {given} answers waited in the outbox ({offline})")
        rep.check(len(logged) == given and len(set((r["id"], r["at"]) for r in logged)) == given,
                  f"after it came back and the tab was hidden: {given} rows, none duplicated, none lost", f"({len(logged)} rows)")
        state = json.loads((data / "state.json").read_text())
        rep.check(ids and all(state["items"].get(i, {}).get("seen") == seen0.get(i, 0) + 1 for i in ids),
                  f"and the saved document holds each of the {given} answers exactly once, none applied twice on replay")
        rep.check(focus_ok(), "focus is on a control afterwards")
        rep.check(not tab.errors[n1:], "no console error", "; ".join(tab.errors[n1:])[:200])
        print(f"  stress wall time {time.time() - t_start:.1f}s")
    finally:
        server.stop()
