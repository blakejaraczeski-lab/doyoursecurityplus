#!/usr/bin/env python3
"""Local study server for doyoursecurityplus.

Serves the app, and holds the study data durably on disk as two resources:

  /api/state     the study state document: what you know, what you got wrong,
                 when you studied. GET reads it, PUT replaces it. A PUT may
                 carry If-Match with the updatedAt it was built on; the server
                 answers 412 with its newer copy if that no longer matches.
  /api/reviews   the review log, one row per answer, append only. GET reads it
                 (?since= in ms), POST appends rows.
  /api/content   the content directory listing, so a new file needs no manifest.
  /api/health    what the Settings screen shows about the durable copy.

Why the server owns the data
----------------------------
The browser's localStorage is keyed to an ORIGIN. Change the port and your
history is gone. Clear site data and it is gone. Use a different browser and it
never existed. For a bank of misconceptions built over weeks, that is not
storage, it is a cache. So the browser keeps using localStorage for speed and
mirrors every change here a moment later. Every state write also lands in a
timestamped snapshot, so a bad import or an accidental reset is recoverable.
"""
import http.server, json, os, sys, functools, threading, time
from pathlib import Path
from urllib.parse import urlsplit, parse_qs

APP_DIR = Path(__file__).resolve().parent
DATA_DIR = Path(os.environ.get("DYSP_DATA", Path.home() / ".doyoursecurityplus"))
STATE_FILE = DATA_DIR / "state.json"
REVIEWS_FILE = DATA_DIR / "reviews.jsonl"
SNAP_DIR = DATA_DIR / "snapshots"
KEEP_SNAPSHOTS = 40
MAX_BODY = 24 * 1024 * 1024

_lock = threading.Lock()


# --- state document ----------------------------------------------------------
def _read_state():
    if not STATE_FILE.exists():
        return None
    try:
        return json.loads(STATE_FILE.read_text())
    except (json.JSONDecodeError, OSError):
        # A corrupt primary is recoverable from the newest snapshot.
        for s in reversed(sorted(SNAP_DIR.glob("state-*.json"))):
            try:
                return json.loads(s.read_text())
            except Exception:
                continue
        return None


def _write_state(state):
    """Atomic write, then snapshot. Never leaves a half written primary."""
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    SNAP_DIR.mkdir(parents=True, exist_ok=True)
    tmp = STATE_FILE.with_suffix(".json.tmp")
    payload = json.dumps(state, indent=2)
    tmp.write_text(payload)
    os.replace(tmp, STATE_FILE)

    snap = SNAP_DIR / f"state-{time.strftime('%Y%m%d-%H%M%S')}.json"
    if not snap.exists():
        snap.write_text(payload)
    for old in sorted(SNAP_DIR.glob("state-*.json"))[:-KEEP_SNAPSHOTS]:
        old.unlink(missing_ok=True)


# --- review log --------------------------------------------------------------
def _append_reviews(rows):
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    with REVIEWS_FILE.open("a") as f:
        for r in rows:
            f.write(json.dumps(r, separators=(",", ":")) + "\n")


def _read_reviews(since=0):
    if not REVIEWS_FILE.exists():
        return []
    out = []
    for line in REVIEWS_FILE.read_text().splitlines():
        try:
            r = json.loads(line)
        except json.JSONDecodeError:
            continue
        if isinstance(r, dict) and r.get("at", 0) >= since:
            out.append(r)
    return out


def _count_reviews():
    return sum(1 for line in REVIEWS_FILE.read_text().splitlines() if line.strip()) if REVIEWS_FILE.exists() else 0


def _valid_row(r):
    return isinstance(r, dict) and isinstance(r.get("at"), (int, float)) and isinstance(r.get("kind"), str)


def _summary(state):
    mis = (state or {}).get("misconceptions", {}) or {}
    return {
        "reviews": _count_reviews(),
        "misconceptionsOpen": sum(1 for m in mis.values() if not m.get("retired")),
        "misconceptionsRetired": sum(1 for m in mis.values() if m.get("retired")),
    }


class Handler(http.server.SimpleHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def _json(self, code, obj):
        body = json.dumps(obj).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def _body(self):
        try:
            length = int(self.headers.get("Content-Length", 0))
        except ValueError:
            return None, (400, {"error": "bad length"})
        if length <= 0 or length > MAX_BODY:
            return None, (413, {"error": "body too large or empty"})
        try:
            return json.loads(self.rfile.read(length)), None
        except json.JSONDecodeError:
            return None, (400, {"error": "invalid json"})

    def end_headers(self):
        if not self.path.startswith("/api/"):
            self.send_header("Cache-Control", "no-store, must-revalidate")
        super().end_headers()

    def do_GET(self):
        url = urlsplit(self.path)

        if url.path == "/api/state":
            with _lock:
                state = _read_state()
            if state is None:
                return self._json(404, {"error": "no saved state yet"})
            return self._json(200, {"state": state, "updatedAt": state.get("updatedAt", 0)})

        if url.path == "/api/reviews":
            since = int((parse_qs(url.query).get("since") or ["0"])[0] or 0)
            with _lock:
                rows = _read_reviews(since)
            return self._json(200, {"reviews": rows})

        if url.path == "/api/health":
            with _lock:
                state = _read_state()
                snaps = sorted(SNAP_DIR.glob("state-*.json")) if SNAP_DIR.exists() else []
                summary = _summary(state)
            return self._json(200, {
                "ok": True,
                "stateFile": str(STATE_FILE),
                "snapshots": len(snaps),
                "newestSnapshot": snaps[-1].name if snaps else None,
                **summary,
            })

        if url.path == "/api/content":
            # The browser cannot list a directory, so the server does. A new
            # content file is picked up on the next load with no build step.
            content = APP_DIR / "content"
            ls = lambda sub: sorted(p.name for p in (content / sub).glob("*.json"))
            return self._json(200, {k: ls(k) for k in ("items", "pbq", "mentor", "index")})

        return super().do_GET()

    def do_PUT(self):
        if urlsplit(self.path).path != "/api/state":
            return self._json(404, {"error": "not found"})
        incoming, err = self._body()
        if err:
            return self._json(*err)
        if not isinstance(incoming, dict) or "misconceptions" not in incoming:
            return self._json(400, {"error": "not a study state document"})

        with _lock:
            existing = _read_state()
            # A conditional replace: the client names the version it built on.
            # If the stored copy has moved past it, another session saved newer
            # work, and the client gets that copy back instead of overwriting it.
            expected = self.headers.get("If-Match")
            if expected is not None and existing is not None:
                if str(existing.get("updatedAt") or 0) != expected.strip('"'):
                    return self._json(412, {
                        "error": "state has changed since the version you built on",
                        "serverUpdatedAt": existing.get("updatedAt"),
                        "state": existing,
                    })
            # The document never grows per answer. A client still carrying a
            # review array or a mock history in it is pre-resource; those rows
            # go to the log here, and the client folds its PBQ attempt lists.
            rows = incoming.pop("reviews", None) or []
            rows += [{"kind": "mock", **m} for m in (incoming.pop("mockHistory", None) or []) if isinstance(m, dict)]
            if rows:
                _append_reviews([r for r in rows if _valid_row(r)])
            _write_state(incoming)
            summary = _summary(incoming)
        return self._json(200, {"ok": True, "updatedAt": incoming.get("updatedAt"), **summary})

    def do_POST(self):
        if urlsplit(self.path).path != "/api/reviews":
            return self._json(404, {"error": "not found"})
        incoming, err = self._body()
        if err:
            return self._json(*err)
        rows = incoming if isinstance(incoming, list) else [incoming]
        if not rows or not all(_valid_row(r) for r in rows):
            return self._json(400, {"error": "each row needs a numeric at and a kind"})
        with _lock:
            _append_reviews(rows)
            total = _count_reviews()
        return self._json(200, {"ok": True, "appended": len(rows), "total": total})

    def log_message(self, fmt, *args):
        msg = fmt % args
        if " 404 " in msg or " 500 " in msg:
            sys.stderr.write(f"{self.log_date_time_string()} {msg}\n")


def main():
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8777
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    state = _read_state()
    print(f"doyoursecurityplus  ->  http://localhost:{port}")
    print(f"study data          ->  {DATA_DIR}")
    if state:
        s = _summary(state)
        print(f"restored            ->  {s['reviews']} reviews logged, "
              f"{s['misconceptionsOpen']} open misconceptions, "
              f"{s['misconceptionsRetired']} retired")
    else:
        print("restored            ->  no saved state yet, starting fresh")
    sys.stdout.flush()
    http.server.ThreadingHTTPServer(
        ("127.0.0.1", port), functools.partial(Handler, directory=str(APP_DIR))
    ).serve_forever()


if __name__ == "__main__":
    main()
