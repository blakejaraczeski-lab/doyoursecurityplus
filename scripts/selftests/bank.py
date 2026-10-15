"""Self test scenario: bank. Run alone with python3 scripts/selftest.py bank."""
from selftest import APP_READY, throwaway, scenario


@scenario("bank", order=165)
def scenario_bank(rep, tmp, browser):
    """The mentor bank in the real app: one open card with focus kept on its toggle, and a
    drill on just that correction that serves only questions testing it."""
    rep.head("Mentor bank")
    with throwaway(tmp, "bank") as (base, _):
        tab = browser.tab
        n0 = len(tab.errors)
        tab.navigate(f"{base}/")
        rep.check(tab.wait_for(APP_READY), "the app boots")
        tab.evaluate("""(() => {
          const now = Date.now();
          const rec = (hits, sure) => ({ fsrs: { due: 0 }, cleanPasses: [], hits, banked: now, retired: false, lastItem: null,
            firstItem: null, step: 0, due: now - 86400000, confidentMisses: sure });
          App.state.misconceptions['crl-vs-ocsp'] = rec(2, 1);
          App.state.misconceptions['hashing-vs-encryption'] = rec(1, 0);
          document.querySelector('[data-action=nav][data-section=bank]').click();
        })()""")
        sel = "[data-action=expand-mc][data-id=hashing-vs-encryption]"
        rep.check(tab.wait_for(f"document.querySelector('{sel}')"), "the bank lists the seeded corrections")
        tab.evaluate(f"document.querySelector('{sel}').focus(); document.querySelector('{sel}').click()")
        out = tab.evaluate(f"""(() => {{
          const b = document.querySelector('{sel}'); const a = document.activeElement;
          return {{ exp: b && b.getAttribute('aria-expanded'), focused: !!a && a.dataset && a.dataset.id === 'hashing-vs-encryption' && a.dataset.action === 'expand-mc',
                   headings: [...document.querySelectorAll('h3')].filter((h) => h.textContent.includes('{'hashing'}')).length }};
        }})()""") or {}
        rep.check(out.get("exp") == "true", "Read the correction opens the card and the toggle says expanded", f"({out})")
        rep.check(out.get("focused"), "focus is still on the toggle after the screen re-renders", f"({out})")
        tab.evaluate("document.querySelector('[data-action=start-mc][data-id=hashing-vs-encryption]').click()")
        q = tab.evaluate("""(() => ({ screen: App.screen, n: App.queue.length,
          only: App.queue.every((e) => e.targetMisconception === 'hashing-vs-encryption' &&
            (e.item ? e.item.options.some((o) => o.misconception === 'hashing-vs-encryption') : e.pbq.subtasks.some((s) => s.misconception === 'hashing-vs-encryption'))) }))()""") or {}
        rep.check(q.get("screen") == "drill-run" and 1 <= q.get("n", 0) <= 4 and q.get("only"),
                  "Drill this one starts a short session of only questions that test that correction", f"({q})")
        text = tab.evaluate("document.body.innerText") or ""
        rep.check("memoris" not in text.lower(), "no British spelling on screen")
        rep.check(not tab.errors[n0:], "no console error", "; ".join(tab.errors[n0:])[:200])
