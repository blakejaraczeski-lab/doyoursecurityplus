"""Self test scenario: screens. Run alone with python3 scripts/selftest.py screens."""
import json, time
from selftest import APP_READY, throwaway, scenario


# The server is down: the page itself loaded, but every API call fails.
DOWN_STUB = """(() => {
  const real = window.fetch;
  window.fetch = (url, opts) => {
    const u = String(url instanceof Request ? url.url : url);
    if (u.includes('/api/')) return Promise.reject(new TypeError('Failed to fetch'));
    return real(url, opts);
  };
})();"""


# One PBQ file whose kind has no engine, as if dropped into content/pbq by hand.
ORPHAN_STUB = """(() => {
  const real = window.fetch;
  const orphan = { id: "pbq-zz-no-engine", kind: "packet-capture", objective: "4.8", title: "Read a capture",
                   scenario: "A kind this build cannot run.", difficulty: 3, targetSeconds: 480,
                   requirements: [], config: {}, solution: {}, subtasks: [] };
  const json = (o) => new Response(JSON.stringify(o), { status: 200, headers: { 'Content-Type': 'application/json' } });
  window.fetch = async (url, opts) => {
    const u = String(url instanceof Request ? url.url : url);
    if (u.endsWith('/api/content')) {
      const body = await (await real(url, opts)).json();
      body.pbq = [...body.pbq, orphan];
      return json(body);
    }
    return real(url, opts);
  };
})();"""


LEAD_JS = """(() => {
  const el = document.querySelector('#main .sub, #main .empty p, #main .stem, #main .note, #main p');
  return el ? el.textContent.trim().replace(/\\s+/g, ' ') : '';
})()"""


@scenario("screens", order=70)
def scenario_screens(rep, tmp, browser):
    """Every screen in the SCREENS table, under the four conditions a person can
    actually hit: the server down on first boot, an empty review log, a PBQ
    whose kind has no engine, and a bank too small for a mock block. Each one
    must show a heading and a sentence, and nothing may throw."""
    rep.head("Every screen, under four conditions")
    with throwaway(tmp, "screens") as (base, _):
        tab = browser.tab
        main_text = lambda: tab.evaluate("document.getElementById('main').innerText") or ""

        def click(selector):
            if not tab.evaluate(f"(() => {{ const el = document.querySelector({json.dumps(selector)});"
                                f" if (!el) return false; el.click(); return true; }})()"):
                raise RuntimeError(f"nothing to click for {selector}")

        def key(k):
            tab.evaluate(f"document.dispatchEvent(new KeyboardEvent('keydown', {{ key: {json.dumps(k)}, bubbles: true }}))")

        def shot(cond, screen):
            got = tab.evaluate("App.screen")
            h1 = (tab.evaluate("(document.querySelector('#main h1') || {}).textContent") or "").strip()
            lead = tab.evaluate(LEAD_JS) or ""
            words = len(main_text().split())
            rep.check(got == screen and bool(h1) and words >= 8,
                      f"{cond:<11} {screen:<12} {h1[:44]:<44}  {lead[:70]}", f"(screen {got}, {words} words)")

        def quiet(cond, since):
            rep.check(not tab.errors[since:], f"{cond:<11} no console error", "; ".join(tab.errors[since:])[:200])

        # 1. The server is down. Nothing can load, so every screen is this one.
        n0 = len(tab.errors)
        stub = tab.call("Page.addScriptToEvaluateOnNewDocument", source=DOWN_STUB)["identifier"]
        tab.navigate(f"{base}/")
        shown = tab.wait_for("document.body.textContent.includes('Could not start')", 10)
        text = tab.evaluate("document.getElementById('app').innerText") or ""
        rep.check(shown and "is not answering" in text and tab.evaluate("!!document.querySelector('[data-action=reload]')"),
                  "server down  every screen  Could not start: the sentence names the server, the one action is Reload",
                  f"({text[:90]!r})")
        quiet("server down", n0)
        tab.call("Page.removeScriptToEvaluateOnNewDocument", identifier=stub)

        # 2. An empty review log on a first boot: all twelve screens. The boot
        #    itself is the cost that matters: content in one request, gzipped,
        #    and on a warm reload nothing but a 304.
        n0 = len(tab.errors)
        r0, t0 = len(tab.requests), len(tab.transfers)
        tab.navigate(f"{base}/")
        rep.check(tab.wait_for(APP_READY), "empty log   the app boots straight into a session")
        rep.check("comes back on a <b>different</b>" in (tab.evaluate("document.getElementById('main').innerHTML") or ""),
                  "empty log   the first night says what a miss becomes")
        time.sleep(0.3)
        content = [u for u in tab.requests[r0:] if "/api/content" in u or "/content/" in u]
        rep.check(len(content) == 1 and content[0].endswith("/api/content"),
                  f"empty log   content arrives in one request, {len(tab.requests[r0:])} requests for the whole boot", f"({content[:3]})")
        wire = sum(n for u, n in tab.transfers[t0:] if u.endswith("/api/content"))
        rep.check(0 < wire < 500_000, f"empty log   the bundle is gzipped on the wire: {wire:,} bytes")
        r0, t0 = len(tab.requests), len(tab.transfers)
        tab.navigate(f"{base}/")
        rep.check(tab.wait_for(APP_READY), "empty log   a warm reload boots")
        time.sleep(0.3)
        wire = sum(n for u, n in tab.transfers[t0:] if u.endswith("/api/content"))
        rep.check(0 < wire < 1_000, f"empty log   and asks for content with its ETag, a 304 of {wire} bytes")
        shot("empty log", "drill-run")
        click("[data-action=nav][data-section=bank]")
        shot("empty log", "bank")
        click("[data-action=nav][data-section=readiness]")
        shot("empty log", "readiness")
        rep.check("0 answers" in main_text(), "empty log   readiness says it has 0 answers to go on")
        rep.check("appear once three objectives have answers" in main_text() and not tab.evaluate("!!document.querySelector('.heat')"),
                  "empty log   readiness shows no heatmap of empty cells before three objectives have answers")
        click("[data-action=nav][data-section=settings]")
        shot("empty log", "settings")
        rep.check("Answers and corrections saved 0" in main_text().replace("\t", " "),
                  "empty log   settings reports 0 rows in the log")
        click("[data-action=nav][data-section=drill]")
        # Finish a one-question session from the keyboard: A answers, Enter continues.
        tab.evaluate("App.queue = [{ kind: 'item', item: App.content.items.find((i) => i.type === 'mcq'), reason: '' }]; App.idx = 0;")
        key("a")
        key("Enter")
        shot("empty log", "drill-done")
        row = tab.call("Runtime.evaluate", awaitPromise=True, returnByValue=True,
                       expression="import('/app/reviews.js').then((m) => m.rows('item').at(-1))")["result"].get("value") or {}
        rep.check(isinstance(row.get("s"), (int, float)) and isinstance(row.get("ms"), (int, float)),
                  "empty log   the answer's log row carries its session and its timing", f"({row})")
        click("[data-action=nav][data-section=lab]")
        shot("empty log", "lab-list")
        rep.check(tab.evaluate("document.querySelectorAll('[data-action=open-pbq]').length > 0"), "empty log   the lab lists PBQs")
        click("[data-action=open-pbq]")
        shot("empty log", "lab-run")
        click("[data-action=nav][data-section=mock]")
        shot("empty log", "mock-home")
        rep.check("Previous attempts" not in main_text(), "empty log   mock home shows no history table")
        click("[data-action=mock-select][data-format=short]")
        click("[data-action=mock-start]")
        shot("empty log", "mock-run")
        click("[data-action=mock-review]")
        shot("empty log", "mock-review")
        tab.evaluate("window.confirm = () => true")
        click("[data-action=mock-submit]")
        shot("empty log", "mock-result")
        tab.evaluate("App.queue = []")
        click("[data-action=nav][data-section=drill]")
        shot("empty log", "drill-home")
        rep.check("Nothing to serve right now" in main_text(), "empty log   drill home says why there is no session and offers a mock")
        # An exam date the pace cannot carry: the drill screen says so, once, at the start.
        tab.evaluate("App.state.profile.examDate = new Date(Date.now() + 14 * 86400000).toISOString().slice(0, 10);"
                     "document.querySelector('[data-action=start-drill], [data-action=nav][data-section=drill]').click();"
                     "App.screen = 'drill-run'; App.queue = App.queue.length ? App.queue : [{ kind: 'item', item: App.content.items.find((i) => i.type === 'mcq'), reason: '' }];"
                     "App.idx = 0; App.answer = null; document.querySelector('[data-action=nav][data-section=drill]').click()")
        rep.check("The plan does not fit your pace" in main_text() and "answers a day" in main_text(),
                  "empty log   an exam date the pace cannot carry is stated on the drill screen")
        tab.evaluate("App.state.profile.examDate = null; App.queue = []; document.querySelector('[data-action=nav][data-section=drill]').click()")
        quiet("empty log", n0)

        # 3. A PBQ whose kind has no engine: listed, never served.
        n0 = len(tab.errors)
        stub = tab.call("Page.addScriptToEvaluateOnNewDocument", source=ORPHAN_STUB)["identifier"]
        tab.navigate(f"{base}/")
        rep.check(tab.wait_for(APP_READY), "no engine   the app boots with the orphan file in the listing")
        rep.check(tab.evaluate("App.content.pbqsWithoutEngine.length === 1 && !App.content.pbqsById['pbq-zz-no-engine']"
                               " && !App.content.pbqs.some((p) => p.id === 'pbq-zz-no-engine')"),
                  "no engine   it is loaded, set apart, and absent from the bank")
        click("[data-action=nav][data-section=lab]")
        shot("no engine", "lab-list")
        rep.check("has no engine in this build" in main_text()
                  and not tab.evaluate("!!document.querySelector('[data-action=open-pbq][data-id=\"pbq-zz-no-engine\"]')"),
                  "no engine   the lab lists it under Without an engine, with the reason and no Start button")
        click("[data-action=nav][data-section=readiness]")
        shot("no engine", "readiness")
        click("[data-action=nav][data-section=mock]")
        click("[data-action=mock-select][data-format=full]")
        click("[data-action=mock-start]")
        rep.check(tab.evaluate("App.mock.items.filter((e) => e.kind === 'pbq').length === 5"
                               " && App.mock.items.every((e) => e.pbq?.id !== 'pbq-zz-no-engine')"),
                  "no engine   a full mock draws five PBQs and never that one")
        rep.check(tab.evaluate("App.queue.every((e) => e.pbq?.id !== 'pbq-zz-no-engine')"), "no engine   the drill queue never holds it")
        quiet("no engine", n0)
        tab.call("Page.removeScriptToEvaluateOnNewDocument", identifier=stub)

        # 4. A bank too small for a block, then a bank with nothing in it.
        n0 = len(tab.errors)
        tab.navigate(f"{base}/")
        rep.check(tab.wait_for(APP_READY), "short mock  the app boots")
        tab.evaluate("App.content.items = App.content.items.filter((i) => i.type === 'mcq').slice(0, 10);"
                     "App.content.itemsById = Object.fromEntries(App.content.items.map((i) => [i.id, i]));"
                     "App.content.pbqs = App.content.pbqs.slice(0, 1);"
                     "App.content.pbqsById = Object.fromEntries(App.content.pbqs.map((p) => [p.id, p]));")
        click("[data-action=nav][data-section=mock]")
        shot("short mock", "mock-home")
        rep.check("10 graded items and 1 PBQ" in main_text() and "11q / 11m" in main_text(),
                  "short mock  the block says what it will run, 11q / 11m, and why")
        click("[data-action=mock-select][data-format=full]")
        click("[data-action=mock-start]")
        shot("short mock", "mock-run")
        rep.check(tab.evaluate("App.mock.items.length === 11 && App.mock.minutes === 11"
                               " && document.querySelector('.session-bar').textContent.includes('of 11')"),
                  "short mock  the run is 11 questions on an 11 minute clock")
        tab.evaluate("App.content.items = []; App.content.itemsById = {}; App.content.pbqs = []; App.content.pbqsById = {};"
                     "App.mock = null; App.queue = [];")
        click("[data-action=nav][data-section=mock]")
        shot("empty bank", "mock-home")
        rep.check("Nothing to run a mock on" in main_text() and not tab.evaluate("!!document.querySelector('[data-action=mock-select], [data-action=mock-start]')"),
                  "empty bank  mock home: one sentence, no block buttons, Reload")
        click("[data-action=nav][data-section=drill]")
        shot("empty bank", "drill-home")
        rep.check("No items are loaded" in main_text(), "empty bank  drill home: one sentence, Reload")
        quiet("short mock", n0)
