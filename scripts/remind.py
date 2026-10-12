#!/usr/bin/env python3
"""Check the durable study state and, if corrections are due, post a macOS
notification. Run on a schedule by the LaunchAgent (see service.sh).

Reads the state file directly rather than the app, so it works whether or not a
browser is open. It never writes.
"""
import json, os, subprocess, sys, time
from pathlib import Path

DATA_DIR = Path(os.environ.get("DYSP_DATA", Path.home() / ".doyoursecurityplus"))
STATE = DATA_DIR / "state.json"
REVIEWS = DATA_DIR / "reviews.jsonl"
PORT = os.environ.get("DYSP_PORT", "8777")


def notify(title, body, url):
    script = (
        f'display notification {json.dumps(body)} '
        f'with title {json.dumps(title)} sound name "Ping"'
    )
    subprocess.run(["osascript", "-e", script], check=False)


def main():
    if not STATE.exists():
        return 0
    try:
        state = json.loads(STATE.read_text())
    except (json.JSONDecodeError, OSError):
        return 0

    now = time.time() * 1000
    mis = state.get("misconceptions", {}) or {}
    due = sum(
        1 for m in mis.values()
        if not m.get("retired") and (m.get("due") or (m.get("fsrs") or {}).get("due") or 0) <= now
    )

    # Answers already logged today, so a finished day stays quiet. The log is
    # append only, so today's rows are at the end.
    midnight = time.mktime(time.localtime()[:3] + (0, 0, 0, 0, 0, -1)) * 1000
    done = 0
    if REVIEWS.exists():
        for line in reversed(REVIEWS.read_text().splitlines()):
            try:
                r = json.loads(line)
            except json.JSONDecodeError:
                continue
            if r.get("at", 0) < midnight:
                break
            if r.get("kind") == "item":
                done += 1
    goal = (state.get("profile") or {}).get("dailyReviewGoal", 40)

    exam = (state.get("profile") or {}).get("examDate")
    tail = ""
    if exam:
        try:
            days = int((time.mktime(time.strptime(exam, "%Y-%m-%d")) - time.time()) // 86400)
            if days >= 0:
                tail = f" {days} days to the exam."
        except ValueError:
            pass

    if done >= goal:
        return 0
    if due == 0 and done > 0:
        return 0

    if due:
        body = f"{due} correction{'s' if due != 1 else ''} due, {done}/{goal} reviews done today.{tail}"
    else:
        body = f"{done}/{goal} reviews done today.{tail}"

    notify("doyoursecurityplus", body, f"http://localhost:{PORT}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
