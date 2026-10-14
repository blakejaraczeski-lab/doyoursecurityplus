"""Self test scenario: options-edge. Run alone with python3 scripts/selftest.py options-edge."""
from selftest import APP_READY, throwaway, scenario


@scenario("options-edge", order=160)
def scenario_options_edge(rep, tmp, browser):
    """The shuffle past the usual four: an item with eight options shows eight
    distinct letters, and a letter, a click and a choose-N all land on the
    option that is there, by stored id."""
    rep.head("Option letters with more than six options")
    with throwaway(tmp, "options-edge") as (base, _):
        tab = browser.tab
        n0 = len(tab.errors)
        tab.navigate(f"{base}/")
        rep.check(tab.wait_for(APP_READY), "the app boots")
        probe = """(() => {
          const ids = 'abcdefgh'.split('');
          const mk = (id, type, correct) => ({ id, type, objective: '4.9', topics: [], difficulty: 3, stem: 'Probe ' + id,
            options: ids.map((o) => ({ id: o, text: 'Option text ' + o, ...(correct.includes(o) ? { correct: true } : { misconception: 'compromised-vs-affected' }), why: 'probe' })),
            ...(type === 'mcq-multi' ? { selectCount: correct.length } : {}) });
          const show = (item) => { App.queue = [{ kind: 'item', item, reason: '' }]; App.idx = 0; App.answer = null; App.multiPicked = new Set();
            document.querySelector('[data-action=nav][data-section=drill]').click();
            return [...document.querySelectorAll('.opts .opt')]; };
          const press = (k) => document.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true }));
          const out = { keys: [], keyed: 0, keyedN: 0, clicked: 0, clickedN: 0, multi: 0, multiN: 0 };
          for (let n = 0; n < 60; n++) {
            const one = mk('probe-1', 'mcq', ['g']);
            let btns = show(one);
            if (n === 0) out.keys = btns.map((b) => b.querySelector('.key').textContent.trim());
            const order = btns.map((b) => b.dataset.opt);
            if (n < 30) {   // the letter on screen, pressed: the option at that position
              const pos = n % 6;
              press('abcdef'[pos]); out.keyedN++;
              if (App.answer && App.answer.chosen === order[pos]) out.keyed++;
            } else {        // a click on the seventh or eighth: by stored id
              const b = btns[6 + (n % 2)]; b.click(); out.clickedN++;
              if (App.answer && App.answer.chosen === b.dataset.opt) out.clicked++;
            }
          }
          for (let n = 0; n < 30; n++) {
            const two = mk('probe-2', 'mcq-multi', ['b', 'g', 'h']);
            const btns = show(two); const order = btns.map((b) => b.dataset.opt);
            for (const id of ['b', 'g', 'h']) {
              const now = [...document.querySelectorAll('.opts .opt')].map((b) => b.dataset.opt);   // the page re-renders after each toggle
              const pos = now.indexOf(id);
              pos < 6 ? press('abcdef'[pos]) : document.querySelectorAll('.opts .opt')[pos].click();
            }
            out.multiN++; if (App.multiPicked.size === 3) { press('Enter'); if (App.answer && App.answer.correct) out.multi++; }
          }
          return out;
        })()"""
        out = tab.evaluate(probe) or {}
        keys = out.get("keys", [])
        rep.check(keys == list("ABCDEFGH"), "eight options show the letters A to H, none blank or undefined", f"({keys})")
        rep.check(out.get("keyedN") and out.get("keyed") == out.get("keyedN"),
                  f"a letter pressed on an eight option item answers the option shown there ({out.get('keyed')} of {out.get('keyedN')})")
        rep.check(out.get("clickedN") and out.get("clicked") == out.get("clickedN"),
                  f"a click on the seventh or eighth option answers that option's id ({out.get('clicked')} of {out.get('clickedN')})")
        rep.check(out.get("multiN") and out.get("multi") == out.get("multiN"),
                  f"choose-three on seven options, by letter or click wherever each landed, grades correct ({out.get('multi')} of {out.get('multiN')})")
        rep.check(not tab.errors[n0:], "no console error", "; ".join(tab.errors[n0:])[:200])
