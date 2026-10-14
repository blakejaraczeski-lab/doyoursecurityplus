"""Self test scenario: latency. Run alone with python3 scripts/selftest.py latency."""
import json, re, time
from selftest import APP_READY, throwaway, seed_heavy, scenario


# Every action the person repeats, timed from dispatch to the next frame.
CARDS_JS = "document.querySelectorAll('[data-action=expand-mc]').length"


TIME_ACTION_JS = """(async (sel, prep) => {
  if (prep) (new Function(prep))();
  const el = document.querySelector(sel);
  if (!el) return { error: 'nothing matches ' + sel };
  if (el.disabled) return { ms: 0, work: 0, disabled: true };
  const t0 = performance.now();
  el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));   // an svg host has no click()
  const work = performance.now() - t0;
  return await new Promise((done) => requestAnimationFrame(() => done({ ms: performance.now() - t0, work })));
})"""


@scenario("latency", order=120)
def scenario_latency(rep, tmp, browser, rows=3000, assert_limits=True):
    """Nielsen's first limit, enforced: under 100 ms from any repeated action to
    the next frame, and boot to first interactive under one second, on a record
    with `rows` review rows and the whole misconception bank in it."""
    rep.head(f"Latency at {rows:,} review rows, CPU slowed fourfold")
    with throwaway(tmp, f"latency-{rows}") as (base, data):
        seed_heavy(data, rows)
        tab = browser.tab
        n0 = len(tab.errors)
        # A slow machine, not this one: every number below is at a quarter of the CPU.
        tab.call("Emulation.setCPUThrottlingRate", rate=4)
        tab.navigate(f"{base}/")
        rep.check(tab.wait_for(APP_READY, 30), "the app boots on the heavy record")
        tab.wait_for("performance.getEntriesByName('dysp-interactive').length", 10)
        boot = tab.evaluate("performance.getEntriesByName('dysp-interactive')[0]?.startTime") or 1e9
        results = [("boot to first interactive", boot, 1000, boot)]

        def timed(label, sel, prep=None, limit=100):
            r = tab.call("Runtime.evaluate", awaitPromise=True, returnByValue=True,
                         expression=f"{TIME_ACTION_JS}({json.dumps(sel)}, {json.dumps(prep)})")["result"].get("value") or {}
            ms = r.get("ms", 1e9)
            results.append((label, ms, limit, r.get("work", 0)))
            if r.get("disabled"):
                rep.check(False, f"{label}: the control was disabled, so nothing was timed")
            if "error" in r:
                rep.check(False, f"{label}: {r['error']}")

        mcq = "App.queue = [ { kind: 'item', item: App.content.items.find((i) => i.type === 'mcq'), reason: '' }, { kind: 'item', item: App.content.items.filter((i) => i.type === 'mcq')[1], reason: '' } ]; App.idx = 0; App.answer = null; App.screen = 'drill-run';"
        timed("nav: drill", "[data-action=nav][data-section=drill]", mcq)

        def press_ack(label, sel):
            """A real mouse press, held: the time from the press event to the
            first frame that paints the control's outline, which is the
            acknowledgement before any result. Released afterwards."""
            box = tab.evaluate(f"(() => {{ const el = document.querySelector({json.dumps(sel)}); el.scrollIntoView({{ block: 'center' }});"
                               "const r = el.getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2]; })()")
            tab.evaluate(f"""window.__ack = new Promise((done) => {{
              const el = document.querySelector({json.dumps(sel)});
              el.addEventListener('mousedown', (e) => {{
                const t0 = e.timeStamp;
                const frame = () => getComputedStyle(el).outlineStyle === 'solid'
                  ? done(performance.now() - t0) : requestAnimationFrame(frame);
                requestAnimationFrame(frame);
              }}, {{ once: true, capture: true }});
            }})""")
            tab.call("Input.dispatchMouseEvent", type="mouseMoved", x=box[0], y=box[1])
            tab.call("Input.dispatchMouseEvent", type="mousePressed", x=box[0], y=box[1], button="left", clickCount=1)
            ms = tab.call("Runtime.evaluate", expression="window.__ack", awaitPromise=True, returnByValue=True)["result"].get("value", 1e9)
            tab.call("Input.dispatchMouseEvent", type="mouseReleased", x=box[0], y=box[1], button="left", clickCount=1)
            results.append((label, ms, 100, ms))

        press_ack("press an option: outline", "[data-action=answer][data-opt=b]")
        # The release answered it; put the question back so "answer" times a live control.
        tab.evaluate(mcq + "document.querySelector('[data-action=nav][data-section=drill]').click()")
        timed("answer", "[data-action=answer][data-opt]")
        timed("next question", "[data-action=next]")
        # The first visit to the readiness screen pays a one-time cost (about 25 ms at this slowdown) for code and
        # styles it has not run yet. A person pays it once and then lives on the warm path, so the limit is held on
        # that; the visit is made here, untimed, and the timed ones below are the screen as it is used.
        tab.evaluate("document.querySelector('[data-action=nav][data-section=readiness]').click()")
        time.sleep(0.5)
        for section in ("lab", "mock", "bank", "readiness", "settings", "drill"):
            timed(f"nav: {section}", f"[data-action=nav][data-section={section}]")
        timed("nav: readiness, again", "[data-action=nav][data-section=readiness]")
        tab.evaluate("App.lab = null; document.querySelector('[data-action=nav][data-section=lab]').click()")
        timed("open a PBQ", "[data-action=open-pbq][data-id=pbq-order-001]")
        press_ack("press a chip: outline", "[data-action=order-hold]")
        # The release held it; let go so "hold chip" holds and "place chip" places.
        tab.evaluate("{ const a = App.answers[App.lab.id]; if (a) a.held = null; document.querySelector('[data-action=nav][data-section=lab]').click();"
                     "document.querySelector('[data-action=open-pbq][data-id=pbq-order-001]').click() }")
        timed("hold chip", "[data-action=order-hold]")
        timed("place chip", "[data-action=order-place-at]")
        timed("submit PBQ", "[data-action=pbq-submit]")
        tab.evaluate("App.lab = null; document.querySelector('[data-action=nav][data-section=lab]').click();"
                     "document.querySelector('[data-action=open-pbq][data-id=pbq-diagram-001]').click()")
        timed("open host", "[data-node][tabindex]")
        tab.evaluate("App.lab = null; document.querySelector('[data-action=nav][data-section=lab]').click();"
                     "document.querySelector('[data-action=open-pbq][data-id=pbq-acl-001]').click()")
        timed("add ACL rule", "[data-action=acl-add]")
        # The fourth control: a select's change, timed to the frame that marks its rule in the readout.
        r = tab.call("Runtime.evaluate", awaitPromise=True, returnByValue=True, expression="""(async () => {
          const sel = document.querySelector('select[data-acl="0"][data-k="action"]');
          const t0 = performance.now();
          sel.value = 'deny'; sel.dispatchEvent(new Event('change', { bubbles: true }));
          const work = performance.now() - t0;
          return await new Promise((done) => requestAnimationFrame(() => done({ ms: performance.now() - t0, work,
            marked: !!document.querySelector('#acl-readout li.edited.deny') })));
        })()""")["result"].get("value") or {}
        results.append(("change an ACL select", r.get("ms", 1e9), 100, r.get("work", 0)))
        rep.check(r.get("marked"), "a changed ACL select marks its rule in the readout in the same frame")

        tab.call("Emulation.setCPUThrottlingRate", rate=1)
        tab.evaluate("App.lab = null; App.bankAll = false; document.querySelector('[data-action=nav][data-section=bank]').click()")
        rep.check(tab.evaluate(CARDS_JS) == 12
                  and re.search(r"Show all \d+ open", tab.evaluate("document.getElementById('main').innerText") or ""),
                  "90 open corrections show the most urgent 12 and offer the rest",
                  f"({tab.evaluate(CARDS_JS)} cards, screen {tab.evaluate('App.screen')})")
        tab.evaluate("document.querySelector('[data-action=nav][data-section=lab]').click()")
        firsts = tab.evaluate("""[...document.querySelectorAll('#main h2')].map((h) => {
          let n = h.nextElementSibling; const out = [];
          while (n && n.tagName !== 'H2') { const m = n.textContent.match(/best (\\d+)%/); if (m) out.push(+m[1]); n = n.nextElementSibling; }
          return out; })""")
        rep.check(all(g == sorted(g) for g in firsts if g), "each PBQ kind in the lab is listed weakest first", f"({firsts})")
        hide_js = ("Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' }); document.dispatchEvent(new Event('visibilitychange'));"
                   "Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' })")
        tab.evaluate(hide_js)   # flush whatever the timed actions logged, so the baseline is settled
        time.sleep(0.8)
        rows_before = (data / "reviews.jsonl").read_text().count("\n")
        tab.evaluate("App.queue = App.content.items.filter((i) => i.type === 'mcq').slice(0, 3).map((item) => ({ kind: 'item', item, reason: '' }));"
                     "App.idx = 0; App.answer = null; document.querySelector('[data-action=nav][data-section=drill]').click();"
                     "document.querySelector('[data-action=skip]').click()")
        tab.evaluate(hide_js)
        time.sleep(0.8)
        rep.check(tab.evaluate("App.queue.length === 2 && App.idx === 0") and (data / "reviews.jsonl").read_text().count("\n") == rows_before,
                  "a skip leaves the session and records nothing",
                  f"(queue {tab.evaluate('App.queue.length')}, idx {tab.evaluate('App.idx')}, rows {rows_before} to {(data / 'reviews.jsonl').read_text().count(chr(10))})")
        results.sort(key=lambda r: -r[1])
        print("  slowest ten, to the next frame (and the handler's own work):")
        for label, ms, limit, work in results[:10]:
            print(f"    {ms:8.1f} ms  ({work:6.1f} ms work)  {label}")
        if assert_limits:
            for label, ms, limit, _ in results:
                rep.check(ms < limit, f"{label:<28} {ms:7.1f} ms, under {limit} ms")
            rep.check(not tab.errors[n0:], "no console error", "; ".join(tab.errors[n0:])[:200])
        return results


@scenario("latency-10000", order=200, on_request=True)
def scenario_latency_10000(rep, tmp, browser):
    """The same measurement at 10,000 rows, reported and not asserted. Run by name."""
    return scenario_latency(rep, tmp, browser, 10000, assert_limits=False)
