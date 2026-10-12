#!/usr/bin/env python3
"""Local study server for doyoursecurityplus.

Serves the app, and holds the study state durably on disk.

Why the server owns the state
-----------------------------
The browser's localStorage is keyed to an ORIGIN. Change the port and your
history is gone. Clear site data and it is gone. Use a different browser and it
never existed. For a bank of misconceptions built over weeks, that is not
storage, it is a cache.

So the browser keeps using localStorage for speed, and mirrors every change here
within a couple of seconds. On start-up the app takes whichever copy is newer.
Every write also lands in a timestamped snapshot, so a bad import or an
accidental reset is recoverable.
"""
import http.server, json, os, sys, functools, threading, time, shutil
from pathlib import Path

APP_DIR = Path(__file__).resolve().parent
DATA_DIR = Path(os.environ.get("DYSP_DATA", Path.home() / ".doyoursecurityplus"))
STATE_FILE = DATA_DIR / "state.json"
SNAP_DIR = DATA_DIR / "snapshots"
KEEP_SNAPSHOTS = 40
MAX_BODY = 24 * 1024 * 1024

_lock = threading.Lock()


def _read_state():
    if not STATE_FILE.exists():
        return None
    try:
        return json.loads(STATE_FILE.read_text())
    except (json.JSONDecodeError, OSError):
        # A corrupt primary is recoverable from the newest snapshot.
        snaps = sorted(SNAP_DIR.glob("state-*.json"))
        for s in reversed(snaps):
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

    stamp = time.strftime("%Y%m%d-%H%M%S")
    snap = SNAP_DIR / f"state-{stamp}.json"
    if not snap.exists():
        snap.write_text(payload)
    snaps = sorted(SNAP_DIR.glob("state-*.json"))
    for old in snaps[:-KEEP_SNAPSHOTS]:
        old.unlink(missing_ok=True)


def _summary(state):
    if not state:
        return {}
    mis = state.get("misconceptions", {}) or {}
    return {
        "reviews": len(state.get("reviews", []) or []),
        "misconceptionsOpen": sum(1 for m in mis.values() if not m.get("retired")),
        "misconceptionsRetired": sum(1 for m in mis.values() if m.get("retired")),
        "itemsSeen": len(state.get("items", {}) or {}),
        "updatedAt": state.get("updatedAt"),
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

    def end_headers(self):
        if not self.path.startswith("/api/"):
            self.send_header("Cache-Control", "no-store, must-revalidate")
        super().end_headers()

    def do_GET(self):
        if self.path == "/api/state":
            with _lock:
                state = _read_state()
            if state is None:
                return self._json(404, {"error": "no saved state yet"})
            return self._json(200, {"state": state, "updatedAt": state.get("updatedAt", 0)})

        if self.path == "/api/health":
            with _lock:
                state = _read_state()
                snaps = sorted(SNAP_DIR.glob("state-*.json")) if SNAP_DIR.exists() else []
            return self._json(200, {
                "ok": True,
                "dataDir": str(DATA_DIR),
                "stateFile": str(STATE_FILE),
                "hasState": state is not None,
                "snapshots": len(snaps),
                "newestSnapshot": snaps[-1].name if snaps else None,
                **_summary(state),
            })

        if self.path == "/api/content":
            # The browser cannot list a directory, so the server does. A new
            # content file is picked up on the next load with no build step.
            content = APP_DIR / "content"
            ls = lambda sub: sorted(p.name for p in (content / sub).glob("*.json"))
            return self._json(200, {k: ls(k) for k in ("items", "pbq", "mentor", "index")})

        return super().do_GET()

    def do_PUT(self):
        if self.path != "/api/state":
            return self._json(404, {"error": "not found"})
        try:
            length = int(self.headers.get("Content-Length", 0))
        except ValueError:
            return self._json(400, {"error": "bad length"})
        if length <= 0 or length > MAX_BODY:
            return self._json(413, {"error": "body too large or empty"})
        try:
            incoming = json.loads(self.rfile.read(length))
        except json.JSONDecodeError:
            return self._json(400, {"error": "invalid json"})
        if not isinstance(incoming, dict) or "misconceptions" not in incoming:
            return self._json(400, {"error": "not a study state document"})

        with _lock:
            existing = _read_state()
            # Refuse a write that would silently discard newer work, unless the
            # client explicitly says it is resolving the conflict.
            force = self.headers.get("X-Dysp-Force") == "1"
            if existing and not force:
                if (existing.get("updatedAt") or 0) > (incoming.get("updatedAt") or 0):
                    return self._json(409, {
                        "error": "server copy is newer",
                        "serverUpdatedAt": existing.get("updatedAt"),
                        "state": existing,
                    })
            _write_state(incoming)
            saved = _summary(incoming)
        return self._json(200, {"ok": True, **saved})

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
        print(f"restored            ->  {s['reviews']} reviews, "
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
