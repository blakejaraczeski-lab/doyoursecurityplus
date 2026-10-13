#!/usr/bin/env python3
"""Replay the real review log through the real scheduler and report the waste.

  python3 scripts/replay.py [--data DIR] [--json]

Reads DIR (default ~/.doyoursecurityplus) read-only: state.json and
reviews.jsonl are copied into a throwaway DYSP_DATA directory, a throwaway
serve.py serves the copy, and scripts/replay.js runs in headless Chrome
against the app's own scheduler, FSRS and mentor modules. Nothing here is a
second implementation of the engine; this file only drives and prints.
"""
import json, os, pathlib, shutil, sys, tempfile, time
from datetime import datetime

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
import selftest as st   # noqa: E402  the headless Chrome, DevTools client and throwaway server

SOURCE = pathlib.Path(os.environ.get("DYSP_REPLAY_SOURCE", pathlib.Path.home() / ".doyoursecurityplus"))


def day(ms):
    return datetime.fromtimestamp(ms / 1000).strftime("%Y-%m-%d") if ms else "-"


def run_in_page(script_call, source=SOURCE):
    """Copy the data, start a throwaway server on the copy, evaluate one JS call, return its value."""
    chrome = next((c for c in st.CANDIDATES if c and pathlib.Path(c).exists()), None)
    if not chrome:
        sys.exit("no Chrome or Chromium found; the replay needs the browser to run the scheduler")
    tmp = tempfile.mkdtemp(prefix="dysp-replay-")
    browser = None
    try:
        browser = st.Browser(chrome, os.path.join(tmp, "profile"))
        with st.throwaway(tmp, "data") as (base, data):
            for name in ("state.json", "reviews.jsonl"):
                if (source / name).exists():
                    shutil.copyfile(source / name, data / name)   # the original is only ever read
            browser.tab.navigate(f"{base}/selftest.html")   # an origin to run modules on; its own checks are ignored
            expr = f"""(async () => {{
              const rows = (await (await fetch('/api/reviews?since=0')).json()).reviews;
              const st = await fetch('/api/state');
              const profile = st.ok ? (await st.json()).state.profile : {{}};
              const m = await import('/scripts/replay.js');
              const out = await m.{script_call};
              delete out.state;
              return out;
            }})()"""
            r = browser.tab.call("Runtime.evaluate", expression=expr, awaitPromise=True, returnByValue=True)
            if "exceptionDetails" in r:
                sys.exit("replay failed: " + json.dumps(r["exceptionDetails"])[:600])
            return r["result"]["value"]
    finally:
        if browser:
            browser.close()
        shutil.rmtree(tmp, ignore_errors=True)


def report(out):
    s = out["sessions"]
    print(f"log: {out['rows']} rows, {day(out['from'])} to {day(out['to'])}; "
          f"{out['answers']} answers in {len(s)} sessions, {out['minutes']:.0f} minutes")
    print(f"     {out['recallAnswers']} recall answers ({out['recallAnswers'] / max(1, out['answers']):.0%}); "
          f"{out['unknownItems']} answers on items no longer in the bank ({out['unknownMinutes']:.0f} min, not judged)")
    print("\nminutes that did not move the exam score")
    w = out["waste"]
    for key, label in (("overlearned", "served with retrievability already above 0.95"),
                       ("recallOverGraded", "a recall card while a graded item would have gained more"),
                       ("prereqSkipped", "a correction drilled on top of an open prerequisite"),
                       ("reservedEarly", "a fresh correction tested again within two answers")):
        print(f"  {w[key]['n']:>4} answers  {w[key]['minutes']:6.1f} min   {label}")
    done = [x for x in s if x["minutesForSame"] is not None]
    spent = sum(x["policyMinutes"] for x in done)
    needed = sum(x["minutesForSame"] for x in done)
    print("\nper session, against the gain policy from the same starting state (answers outside correction slots)")
    print(f"  {len(done)} of {len(s)} sessions comparable; those answers took {spent:.0f} min, "
          f"the gain policy buys the same expected points in {needed:.0f} min")
    if done:
        print(f"  waste {(spent - needed) / len(done):.1f} min per session ({1 - needed / max(spent, 1e-9):.0%})")
    pts = sum(x["points"] for x in s)
    gp = sum(x["gainPolicyPoints"] for x in s)
    print(f"  expected scaled points bought: served {pts:.1f}, gain policy over the same answer counts {gp:.1f}")
    ov_c = sum(x["overlapCurrent"] for x in s)
    ov_g = sum(x["overlapGain"] for x in s)
    print(f"  served items the current policy would also have queued: {ov_c}; the gain policy: {ov_g}")
    print(f"\nmisconceptions: {len(out['retiredEvents'])} retirements in the log, "
          f"{len(out['falseRetirements'])} missed again after retiring")
    for f in out["falseRetirements"]:
        print(f"  {f['id']}: retired {day(f['retiredAt'])}, missed {day(f['missedAt'])}")


def report_fsrs(f):
    print(f"\nFSRS: {f['predictions']} predictions on {f['items']} items with two or more reviews; "
          f"{f['recalledShare']:.0%} recalled")
    print(f"  log-loss with the default weights {f['defaultLoss']:.3f}; fitted in sample {f['inSample']:.3f}")
    print("  out of sample, five folds by item:")
    for c in f["curve"]:
        better = (c["defaults"] - c["fitted"]) / c["defaults"] if c["defaults"] else 0
        print(f"    {c['share']:.0%} of items, {c['n']} predictions: defaults {c['defaults']:.3f}, "
              f"fitted {c['fitted']:.3f} ({better:+.0%} better), always-the-average {c['baseRate']:.3f}")
    d, w = f["intervals"]["defaults"], f["intervals"]["fitted"]
    print(f"  first two GOOD intervals: defaults {d[0]} then {d[1]} days; fitted {w[0]} then {w[1]} days")


if __name__ == "__main__":
    src = pathlib.Path(sys.argv[sys.argv.index("--data") + 1]) if "--data" in sys.argv else SOURCE
    t0 = time.time()
    out = run_in_page("run({ rows, profile })", src)
    out["fsrs"] = run_in_page("fitFsrs({ rows })", src)
    if "--json" in sys.argv:
        print(json.dumps(out))
    else:
        report(out)
        report_fsrs(out["fsrs"])
        print(f"\nreplayed in {time.time() - t0:.1f}s")
