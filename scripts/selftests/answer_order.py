"""Self test scenario: answer-order. Run alone with python3 scripts/selftest.py answer-order."""
import time
from selftest import APP_READY, throwaway, scenario


@scenario("answer-order", order=190)
def scenario_answer_order(rep, tmp, browser):
    """Options are shuffled when shown, so the correct one is not parked at 'a'.
    The stored ids stay put: grading, the keyboard letter and the log all have
    to follow the option, not the position it happened to land in."""
    rep.head("Option order is random and maps back to stored ids")
    with throwaway(tmp, "answer-order") as (base, data):
        tab = browser.tab
        n0 = len(tab.errors)
        tab.navigate(f"{base}/")
        rep.check(tab.wait_for(APP_READY), "the app boots")
        probe = """(async () => {
          const out = { single: [0, 0, 0, 0], multi: {}, stable: true, keyOk: 0, keyN: 0, multiOk: 0, multiN: 0, ids: true, letters: true, idMiss: 0 };
          const sel = (t, n) => App.content.items.find((i) => i.type === t && i.options.length === n && i.options.filter((o) => o.correct).length === (t === 'mcq' ? 1 : 2));
          const one = sel('mcq', 4), two = sel('mcq-multi', 5) || sel('mcq-multi', 4);
          const storedIds = (it) => it.options.map((o) => o.id).sort().join();
          const ids0 = storedIds(one), ids1 = storedIds(two);
          const show = (item) => {
            App.queue = [{ kind: 'item', item, reason: '' }]; App.idx = 0; App.answer = null; App.multiPicked = new Set();
            document.querySelector('[data-action=nav][data-section=drill]').click();
            return [...document.querySelectorAll('.opts .opt')];
          };
          const press = (k) => document.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true }));
          for (let n = 0; n < 240; n++) {
            const btns = show(one);
            const order = btns.map((b) => b.dataset.opt);
            const ci = order.indexOf(one.options.find((o) => o.correct).id);
            out.single[ci]++;
            if (storedIds(one) !== ids0 || order.join() !== one.options.map((o) => o.id).join()) out.ids = false;
            if (btns.map((b) => b.querySelector('.key').textContent).join('') !== 'ABCD') out.letters = false;
            if (n < 40) { out.keyN++; press('abcd'[ci]); if (App.answer && App.answer.correct && App.answer.chosen === one.options.find((o) => o.correct).id) out.keyOk++; }
          }
          // the same entry rendered again keeps the order the learner saw
          const entry = { kind: 'item', item: one, reason: '' };
          App.queue = [entry]; App.idx = 0; App.answer = null;
          document.querySelector('[data-action=nav][data-section=drill]').click();
          const first = [...document.querySelectorAll('.opts .opt')].map((b) => b.dataset.opt).join();
          for (let k = 0; k < 5; k++) { App.answer = null; document.querySelector('[data-action=nav][data-section=drill]').click(); }
          if ([...document.querySelectorAll('.opts .opt')].map((b) => b.dataset.opt).join() !== first) out.stable = false;
          for (let n = 0; n < 240; n++) {
            const btns = show(two);
            const order = btns.map((b) => b.dataset.opt);
            const key = two.options.filter((o) => o.correct).map((o) => order.indexOf(o.id)).sort().join('');
            out.multi[key] = (out.multi[key] || 0) + 1;
            if (n < 40) {
              out.multiN++;
              for (const o of two.options.filter((o) => o.correct)) press('abcde'[order.indexOf(o.id)]);
              press('Enter');
              if (App.answer && App.answer.correct) out.multiOk++;
            }
          }
          out.ids = out.ids && storedIds(two) === ids1;
          return out;
        })()"""
        out = tab.call("Runtime.evaluate", awaitPromise=True, returnByValue=True, expression=probe)["result"].get("value") or {}
        single = out.get("single", [])
        rep.check(len(single) == 4 and min(single) >= 30, f"a single-answer item's correct option lands at A, B, C, D {single} times in 240 presentations (each at least 30)")
        multi = out.get("multi", {})
        rep.check(len(multi) >= 5, f"a choose-two item's correct pair lands in {len(multi)} different position pairs, not always A+B ({multi})")
        rep.check(out.get("ids") and out.get("letters"), "stored ids are unchanged and the letters shown are A, B, C, D in order")
        rep.check(out.get("stable"), "re-rendering the same presentation keeps the order the learner saw")
        rep.check(out.get("keyN") and out.get("keyOk") == out.get("keyN"), f"pressing the letter shown on the correct option grades it correct ({out.get('keyOk')} of {out.get('keyN')})")
        rep.check(out.get("multiN") and out.get("multiOk") == out.get("multiN"), f"choose-two by shown letters then Enter grades correct ({out.get('multiOk')} of {out.get('multiN')})")
        # A shown letter is not a stored id: pick by the displayed C, and the row and verdict follow the option that was there.
        tab.evaluate("""{ const it = App.content.items.find((i) => i.type === 'mcq');
          App.queue = [{ kind: 'item', item: it, reason: '' }]; App.idx = 0; App.answer = null;
          document.querySelector('[data-action=nav][data-section=drill]').click();
          window.__shown = [...document.querySelectorAll('.opts .opt')].map((b) => b.dataset.opt); window.__item = it;
          document.dispatchEvent(new KeyboardEvent('keydown', { key: 'c', bubbles: true })); }""")
        time.sleep(0.8)
        chosen_id = tab.evaluate("window.__shown[2]")
        rep.check(tab.evaluate("App.answer && App.answer.chosen") == chosen_id, "pressing C answers the option shown third, by its stored id", f"({chosen_id})")
        tab.evaluate("document.dispatchEvent(new Event('visibilitychange'))")
        rep.check(not tab.errors[n0:], "no console error", "; ".join(tab.errors[n0:])[:200])
