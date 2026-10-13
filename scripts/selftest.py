#!/usr/bin/env python3
"""Run the self test without a window and exit non-zero if anything fails.

Two kinds of check live here. The page, selftest.html, runs the pure functions
in the Chrome already on this machine (Node is not installed and is not
wanted). The scenarios below drive the real serve.py and the real app and
prove what the persistence story claims: a stale save is refused, a corrupt
primary is read from its snapshot, an outbox left behind while the server was
down is replayed, and a document from before the review log became a resource
is absorbed on first load.

Nothing here touches ~/.doyoursecurityplus. Every server is started with
DYSP_DATA pointing inside a temporary directory, and a scenario refuses to run
if the server reports any other data directory. A minimal DevTools client
(stdlib only; one WebSocket frame type is all it needs) drives the page and
collects anything the page throws or logs as an error.

If no Chrome is found the exit code is 2 and the test stays manual: open
http://localhost:8777/selftest.html.
"""
import base64, contextlib, json, os, re, shutil, socket, subprocess, sys, tempfile, time, traceback
import urllib.error, urllib.request, pathlib

ROOT = pathlib.Path(__file__).resolve().parent.parent
CANDIDATES = [
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
    shutil.which("google-chrome"), shutil.which("chromium"), shutil.which("chromium-browser"),
]
TIMEOUT_S = 60
APP_READY = "window.App && App.content && document.querySelector('#main h1')"


def free_port():
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def wait_http(url, seconds=10):
    for _ in range(int(seconds * 10)):
        try:
            return urllib.request.urlopen(url, timeout=1).read()
        except Exception:
            time.sleep(0.1)
    return None


def http(method, url, body=None, headers=None):
    """One JSON request. Returns (status, parsed body); an error status is a value, not an exception."""
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, method=method,
                                 headers={"Content-Type": "application/json", **(headers or {})})
    try:
        with urllib.request.urlopen(req, timeout=5) as r:
            return r.status, json.loads(r.read() or b"null")
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read() or b"null")


def poll(cond, seconds):
    deadline = time.time() + seconds
    while time.time() < deadline:
        try:
            if cond():
                return True
        except Exception:
            pass
        time.sleep(0.1)
    return False


class DevTools:
    """The smallest WebSocket client that can carry a DevTools session."""

    def __init__(self, ws_url):
        _, rest = ws_url.split("://", 1)
        host, path = rest.split("/", 1)
        hostname, port = host.split(":")
        self.sock = socket.create_connection((hostname, int(port)), timeout=TIMEOUT_S)
        key = base64.b64encode(os.urandom(16)).decode()
        self.sock.sendall((f"GET /{path} HTTP/1.1\r\nHost: {host}\r\nUpgrade: websocket\r\n"
                           f"Connection: Upgrade\r\nSec-WebSocket-Key: {key}\r\n"
                           f"Sec-WebSocket-Version: 13\r\n\r\n").encode())
        head = b""
        while b"\r\n\r\n" not in head:
            head += self.sock.recv(4096)
        if b" 101 " not in head.split(b"\r\n", 1)[0]:
            raise RuntimeError("DevTools refused the WebSocket upgrade")
        self.buf = head.split(b"\r\n\r\n", 1)[1]
        self.next_id = 0
        self.errors = []     # everything the page threw or logged as an error
        self.requests = []   # every URL the page asked for
        self.transfers = []  # (url, bytes on the wire) for every response that finished
        self._inflight = {}

    def _read(self, n):
        while len(self.buf) < n:
            chunk = self.sock.recv(65536)
            if not chunk:
                raise RuntimeError("DevTools closed the connection")
            self.buf += chunk
        out, self.buf = self.buf[:n], self.buf[n:]
        return out

    def send(self, method, **params):
        self.next_id += 1
        payload = json.dumps({"id": self.next_id, "method": method, "params": params}).encode()
        mask = os.urandom(4)
        head = bytearray([0x81])
        n = len(payload)
        if n < 126:
            head.append(0x80 | n)
        elif n < 65536:
            head += bytes([0x80 | 126]) + n.to_bytes(2, "big")
        else:
            head += bytes([0x80 | 127]) + n.to_bytes(8, "big")
        self.sock.sendall(bytes(head) + mask + bytes(b ^ mask[i % 4] for i, b in enumerate(payload)))
        return self.next_id

    def recv(self):
        """One complete text message from the server (server frames are unmasked)."""
        data = b""
        while True:
            b0, b1 = self._read(2)
            n = b1 & 0x7F
            if n == 126:
                n = int.from_bytes(self._read(2), "big")
            elif n == 127:
                n = int.from_bytes(self._read(8), "big")
            if b1 & 0x80:
                self._read(4)
            data += self._read(n)
            if b0 & 0x80:               # final fragment
                return json.loads(data.decode())

    def call(self, method, **params):
        msg_id = self.send(method, **params)
        while True:
            msg = self.recv()
            if msg.get("id") == msg_id:
                return msg.get("result", {})
            self._event(msg)

    def _event(self, msg):
        p = msg.get("params", {})
        if msg.get("method") == "Network.requestWillBeSent":
            url = p.get("request", {}).get("url", "")
            self.requests.append(url)
            self._inflight[p.get("requestId")] = url
        elif msg.get("method") == "Network.loadingFinished":
            self.transfers.append((self._inflight.pop(p.get("requestId"), ""), int(p.get("encodedDataLength", 0))))
        elif msg.get("method") == "Runtime.exceptionThrown":
            d = p.get("exceptionDetails", {})
            self.errors.append(d.get("exception", {}).get("description") or d.get("text") or "exception")
        elif msg.get("method") == "Runtime.consoleAPICalled" and p.get("type") == "error":
            self.errors.append(" ".join(str(a.get("value", a.get("description", ""))) for a in p.get("args", [])))

    def evaluate(self, expression):
        r = self.call("Runtime.evaluate", expression=expression, returnByValue=True)
        return r.get("result", {}).get("value")

    def wait_for(self, expression, seconds=20):
        """Poll a page expression until it is truthy. An exception while polling counts as false."""
        return poll(lambda: self.evaluate(f"(() => {{ try {{ return !!({expression}); }} catch {{ return false; }} }})()"),
                    seconds)

    def navigate(self, url, seconds=20):
        """Load a URL and wait for the new document, even when it is the same URL:
        the old document is marked first, and a reload is only a reload once the
        mark is gone."""
        self.evaluate("window.__dyspOld = true")
        self.call("Page.navigate", url=url)
        if not self.wait_for(f"!window.__dyspOld && location.href.startsWith({json.dumps(url)}) && document.readyState === 'complete'", seconds):
            raise RuntimeError(f"page did not load: {url}")

    def close(self):
        self.sock.close()


class Browser:
    """One headless Chrome with one tab, reused across scenarios. Each throwaway
    server is a new origin, so each scenario starts with empty storage."""

    def __init__(self, chrome, profile_dir):
        self.dev = free_port()
        self.proc = subprocess.Popen(
            [chrome, "--headless=new", "--disable-gpu", "--no-first-run", "--no-default-browser-check",
             f"--user-data-dir={profile_dir}", f"--remote-debugging-port={self.dev}", "about:blank"],
            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
        )
        target = None
        for _ in range(100):
            raw = wait_http(f"http://127.0.0.1:{self.dev}/json", seconds=1)
            pages = [t for t in (json.loads(raw) if raw else []) if t.get("type") == "page"]
            if pages:
                target = pages[0]
                break
            time.sleep(0.1)
        if not target:
            raise RuntimeError("Chrome did not open a page")
        self.tab = DevTools(target["webSocketDebuggerUrl"])
        self.tab.call("Runtime.enable")   # exceptions and console errors arrive as events
        self.tab.call("Page.enable")      # without it, a script added for new documents never runs
        self.tab.call("Network.enable")   # every request the page makes, to prove none leaves this origin

    def close(self):
        try:
            self.tab.close()
        except Exception:
            pass
        self.proc.terminate()
        try:
            self.proc.wait(timeout=5)
        except subprocess.TimeoutExpired:
            self.proc.kill()


class Report:
    def __init__(self):
        self.failures = 0

    def head(self, title):
        print(f"\n{title}")

    def check(self, cond, label, detail=""):
        if cond:
            print(f"  ok   {label}")
        else:
            self.failures += 1
            print(f"  FAIL {label} {detail}".rstrip())
        return cond


@contextlib.contextmanager
def throwaway(tmp, name):
    """The real serve.py on a free port and its own empty data directory, torn down after.

    The server must prove it is on that directory before anything is written:
    the one thing this file must never do is touch real study data.
    """
    data_dir = os.path.join(tmp, name)
    env = {**os.environ, "DYSP_DATA": data_dir}
    if not env.get("DYSP_DATA"):
        raise RuntimeError("refusing to start a server without DYSP_DATA")
    port = free_port()
    proc = subprocess.Popen([sys.executable, str(ROOT / "serve.py"), str(port)], env=env,
                            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    try:
        raw = wait_http(f"http://127.0.0.1:{port}/api/health")
        if not raw:
            raise RuntimeError("throwaway server did not start")
        reported = json.loads(raw)["stateFile"]
        if reported != os.path.join(data_dir, "state.json"):
            raise RuntimeError(f"refusing to proceed: the server reports {reported}, not the throwaway directory")
        yield f"http://127.0.0.1:{port}", pathlib.Path(data_dir)
    finally:
        proc.terminate()
        try:
            proc.wait(timeout=5)
        except subprocess.TimeoutExpired:
            proc.kill()


# --- fixtures ----------------------------------------------------------------
def doc(updated_at, **extra):
    """A minimal study state document, the shape DEFAULT_STATE has."""
    return {
        "version": 2, "updatedAt": updated_at,
        "profile": {"examDate": None, "pace": "bootcamp", "desiredRetention": 0.92, "dailyReviewGoal": 40},
        "items": {}, "misconceptions": {}, "pbq": {},
        "streak": {"days": [], "current": 0, "best": 0, "lastStudied": None},
        **extra,
    }


def log_rows(data):
    f = data / "reviews.jsonl"
    return sum(1 for line in f.read_text().splitlines() if line.strip()) if f.exists() else 0


def on_disk(data):
    return json.loads((data / "state.json").read_text())


# --- page stubs, installed before any script on the page runs --------------
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


ACTIVE_JS = """(() => { const a = document.activeElement; if (!a || a === document.body) return 'BODY';
  const ds = Object.entries(a.dataset || {}).map(([k, v]) => k + '=' + v).join(',');
  return a.tagName + (a.id ? '#' + a.id : '') + '.' + String(a.className.baseVal ?? a.className).split(' ').filter(Boolean).join('.')
    + (ds ? '[' + ds + ']' : ''); })()"""


# --- scenarios ---------------------------------------------------------------
def scenario_page(rep, tmp, browser):
    """selftest.html: every pure-function check, read out of the page."""
    rep.head("selftest.html")
    with throwaway(tmp, "page") as (base, _):
        tab = browser.tab
        r0 = len(tab.requests)
        tab.navigate(f"{base}/selftest.html")
        text = ""
        deadline = time.time() + TIMEOUT_S
        while time.time() < deadline:
            text = tab.evaluate("(document.getElementById('out') || {}).innerText || ''") or ""
            if text.strip() and not text.strip().startswith("Running"):
                break
            time.sleep(0.25)
        text = text.strip()
        print("\n".join("  " + line for line in text.splitlines()))
        if not text or "All checks passed." not in text:
            rep.failures += max(1, sum(1 for line in text.splitlines() if "FAIL" in line))

        # The page makes no request it does not serve itself, fonts included.
        tab.evaluate("document.fonts.ready.then(() => { window.__fontsReady = true; })")
        tab.wait_for("window.__fontsReady", 10)
        loaded = tab.evaluate("[...document.fonts].filter((f) => f.status === 'loaded').map((f) => f.family + ' ' + f.weight)") or []
        away = sorted({u for u in tab.requests[r0:] if not u.startswith(base) and not u.startswith("data:")})
        rep.check(not away, "every request on this load stayed on this origin", f"({away[:3]})")
        rep.check(any("Mono" in f for f in loaded) and any("Sans" in f for f in loaded),
                  f"IBM Plex loaded from this origin: {', '.join(sorted(set(loaded)))}", f"({loaded})")


def scenario_conflict(rep, tmp, browser):
    """Two sessions, one document: the stale save is refused, over HTTP and through the real client."""
    rep.head("Two sessions, one document")
    with throwaway(tmp, "conflict") as (base, data):
        state_url = f"{base}/api/state"
        st, _ = http("PUT", state_url, doc(1000))
        rep.check(st == 200, "the first save lands without a precondition", f"({st})")
        st, got = http("GET", state_url)
        b_version = got["updatedAt"]
        st, _ = http("PUT", state_url, doc(2000, items={"c-001": {"seen": 1}}), {"If-Match": "1000"})
        rep.check(st == 200, "session A saves on the version it read (If-Match: 1000)", f"({st})")
        st, body = http("PUT", state_url, doc(1500, items={"c-002": {"seen": 1}}), {"If-Match": str(b_version)})
        rep.check(st == 412 and body.get("serverUpdatedAt") == 2000 and body.get("state", {}).get("updatedAt") == 2000,
                  "session B, on that same version, gets 412 and A's copy back",
                  f"({st}, serverUpdatedAt {body.get('serverUpdatedAt')})")
        saved = on_disk(data)
        rep.check(saved["updatedAt"] == 2000 and "c-001" in saved["items"] and "c-002" not in saved["items"],
                  "the document on disk is still A's")
        merged = body["state"]
        merged["items"]["c-002"] = {"seen": 1}
        merged["updatedAt"] = 3000
        st, _ = http("PUT", state_url, merged)
        rep.check(st == 200, "B resolves it by replacing unconditionally", f"({st})")
        raw = (data / "state.json").read_bytes()
        rep.check(len(raw) == len(json.dumps(merged, indent=2)) and json.loads(raw)["updatedAt"] == 3000,
                  f"the state document is B's merged copy, {len(raw)} bytes")
        rep.check(log_rows(data) == 0, "the review log holds 0 rows: a state save never writes one", f"({log_rows(data)})")

        # The same conflict through the app. It pulls version 3000, another
        # session saves 4000, and then it tries to save a settings change.
        tab = browser.tab
        n0 = len(tab.errors)
        tab.navigate(f"{base}/")
        rep.check(tab.wait_for(APP_READY), "the app boots on the throwaway server")
        http("PUT", state_url, doc(4000, items={"c-003": {"seen": 1}}))
        tab.evaluate("document.querySelector('[data-action=nav][data-section=settings]').click()")
        tab.evaluate("const s = document.getElementById('f-goal'); s.value = '60';"
                     "s.dispatchEvent(new Event('change', { bubbles: true }))")
        rep.check(tab.wait_for("document.getElementById('sync-foot').textContent.includes('Another session')", 8),
                  "its save on version 3000 is refused and the sidebar says another session saved newer work")
        rep.check(on_disk(data)["updatedAt"] == 4000, "the newer copy is untouched", f"({on_disk(data)['updatedAt']})")
        tab.navigate("about:blank")   # pagehide: the last-resort beacon carries the same precondition
        time.sleep(0.6)
        rep.check(on_disk(data)["updatedAt"] == 4000, "leaving the page does not overwrite it either",
                  f"(updatedAt {on_disk(data)['updatedAt']})")
        rep.check(not tab.errors[n0:], "no console error", "; ".join(tab.errors[n0:])[:200])


def scenario_snapshot(rep, tmp):
    """A corrupt primary is read from its snapshot and healed by the next save."""
    rep.head("A corrupt state.json")
    with throwaway(tmp, "snapshot") as (base, data):
        state_url = f"{base}/api/state"
        d1 = doc(1000, misconceptions={"acl-implicit-deny": {"hits": 1, "retired": False}})
        http("PUT", state_url, d1)
        rep.check(len(list((data / "snapshots").glob("state-*.json"))) == 1, "the first save wrote one snapshot")
        (data / "state.json").write_text("{ half a document")
        st, got = http("GET", state_url)
        rep.check(st == 200 and got.get("state") == d1, "GET /api/state answers from the snapshot", f"({st})")
        st, h = http("GET", f"{base}/api/health")
        rep.check(h.get("misconceptionsOpen") == 1, "health reads the same copy", f"({h})")
        d2 = {**d1, "updatedAt": 2000}
        st, _ = http("PUT", state_url, d2, {"If-Match": "1000"})
        rep.check(st == 200, "the next save, on the restored version, is accepted", f"({st})")
        raw = (data / "state.json").read_bytes()
        rep.check(json.loads(raw) == d2 and len(raw) == len(json.dumps(d2, indent=2)),
                  f"the state document is whole again, {len(raw)} bytes")
        rep.check(log_rows(data) == 0, "the review log holds 0 rows", f"({log_rows(data)})")


def scenario_outbox(rep, tmp, browser):
    """Rows written while the server was down wait in localStorage and are replayed on the next load."""
    rep.head("An outbox left behind while the server was down")
    with throwaway(tmp, "outbox") as (base, data):
        tab = browser.tab
        n0 = len(tab.errors)
        now = int(time.time() * 1000)
        rows = [{"at": now - 100 * (i + 1), "kind": "item", "id": f"c-00{i + 1}", "grade": 3, "conf": "sure"} for i in range(5)]
        rows += [{"at": now - 50, "kind": "misconception", "id": "control-category-vs-type", "item": "c-001", "grade": 1},
                 {"at": now - 40, "kind": "pbq", "id": "pbq-diagram-001", "percent": 80, "earned": 4, "max": 5}]
        tab.navigate(f"{base}/api/health")   # same origin, before the app runs
        tab.evaluate(f"localStorage.setItem('dysp.v1.outbox', {json.dumps(json.dumps(rows))})")
        tab.navigate(f"{base}/")
        rep.check(tab.wait_for(APP_READY), "the app boots with 7 rows waiting")
        rep.check(poll(lambda: log_rows(data) == 7, 10), "all 7 reach the log within the debounce", f"(got {log_rows(data)})")
        rep.check(tab.evaluate("localStorage.getItem('dysp.v1.outbox')") == "[]", "the outbox is empty once the server has them")
        ring = tab.evaluate("document.querySelector('.goal-ring b').textContent") or ""
        rep.check(ring.startswith("5/"), f"the goal ring counts the five replayed answers ({ring})")
        rep.check(not (data / "state.json").exists(), "no state document was written: a replay is not a save")
        rep.check(not tab.errors[n0:], "no console error", "; ".join(tab.errors[n0:])[:200])


def scenario_absorb(rep, tmp, browser):
    """A state.json from before the review log was a resource still carries
    reviews, mockHistory and per-PBQ attempt lists. The app folds all three
    into the log on first load, and the server does the same for a client that
    never updated."""
    rep.head("A document from before the review log was a resource")
    with throwaway(tmp, "absorb") as (base, data):
        tab = browser.tab
        n0 = len(tab.errors)
        now = int(time.time() * 1000)
        old = doc(
            5000,
            items={"c-001": {"seen": 2, "correct": 1, "wrong": 1, "lastSeen": now, "fsrs": None}},
            pbq={"pbq-diagram-001": {"attempts": [
                {"at": now - 3000, "percent": 60, "earned": 3, "max": 5},
                {"at": now - 2000, "percent": 100, "earned": 5, "max": 5}]}},
            reviews=[{"at": now - 5000, "kind": "item", "id": "c-001", "grade": 3},
                     {"at": now - 4000, "kind": "item", "id": "c-001", "grade": 1},
                     {"at": now - 4000, "kind": "misconception", "id": "control-category-vs-type", "item": "c-001", "grade": 1}],
            mockHistory=[{"at": now - 1000, "format": "short", "raw": 0.8, "scaled": 790, "seconds": 600, "unanswered": 0, "banked": 1}],
        )
        (data / "state.json").write_text(json.dumps(old, indent=2))
        before = (data / "state.json").stat().st_size
        tab.navigate(f"{base}/")
        rep.check(tab.wait_for(APP_READY), "the app boots on the old document")
        rep.check(poll(lambda: log_rows(data) == 6 and "reviews" not in on_disk(data), 15),
                  "6 rows reach the log: 3 reviews, 1 mock, 2 PBQ attempts", f"(got {log_rows(data)})")
        saved = on_disk(data)
        rep.check("reviews" not in saved and "mockHistory" not in saved, "the saved document carries neither array")
        rep.check(saved.get("pbq", {}).get("pbq-diagram-001") == {"attempts": 2, "best": 100, "lastAt": now - 2000},
                  "the PBQ record is a bounded summary", f"({saved.get('pbq')})")
        after = (data / "state.json").stat().st_size
        rep.check(after < before, f"the state document shrank from {before} to {after} bytes")
        tab.evaluate("document.querySelector('[data-action=nav][data-section=mock]').click()")
        rep.check(tab.evaluate("document.body.textContent.includes('Previous attempts') && document.body.textContent.includes('790')"),
                  "the absorbed mock shows under previous attempts")
        rep.check(not tab.errors[n0:], "no console error", "; ".join(tab.errors[n0:])[:200])

        st, body = http("PUT", f"{base}/api/state", {**old, "updatedAt": 9000})
        rep.check(st == 200 and body.get("reviews") == 10,
                  "a client that never updated is absorbed server side: 10 rows", f"({st}, {body.get('reviews')})")
        saved = on_disk(data)
        rep.check("reviews" not in saved and "mockHistory" not in saved, "and its document is stored without the arrays")


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
        time.sleep(0.3)
        content = [u for u in tab.requests[r0:] if "/api/content" in u or "/content/" in u]
        rep.check(len(content) == 1 and content[0].endswith("/api/content"),
                  f"empty log   content arrives in one request, {len(tab.requests[r0:])} requests for the whole boot", f"({content[:3]})")
        wire = sum(n for u, n in tab.transfers[t0:] if u.endswith("/api/content"))
        rep.check(0 < wire < 400_000, f"empty log   the bundle is gzipped on the wire: {wire:,} bytes")
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
        rep.check("0 reviews" in main_text(), "empty log   readiness says it has 0 reviews to go on")
        click("[data-action=nav][data-section=settings]")
        shot("empty log", "settings")
        rep.check("Rows in the review log\t0" in main_text() or "Rows in the review log 0" in main_text().replace("\t", " "),
                  "empty log   settings reports 0 rows in the log")
        click("[data-action=nav][data-section=drill]")
        # Finish a one-question session from the keyboard: A answers, Enter continues.
        tab.evaluate("App.queue = [{ kind: 'item', item: App.content.items.find((i) => i.type === 'mcq'), reason: '' }]; App.idx = 0;")
        key("a")
        key("Enter")
        shot("empty log", "drill-done")
        click("[data-action=nav][data-section=lab]")
        shot("empty log", "lab-list")
        click("[data-action=open-pbq]")
        shot("empty log", "lab-run")
        click("[data-action=nav][data-section=mock]")
        shot("empty log", "mock-home")
        rep.check("Previous attempts" not in main_text(), "empty log   mock home shows no history table")
        click("[data-action=mock-start][data-format=short]")
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
        click("[data-action=mock-start][data-format=full]")
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
        click("[data-action=mock-start][data-format=full]")
        shot("short mock", "mock-run")
        rep.check(tab.evaluate("App.mock.items.length === 11 && App.mock.minutes === 11"
                               " && document.querySelector('.session-bar').textContent.includes('of 11')"),
                  "short mock  the run is 11 questions on an 11 minute clock")
        tab.evaluate("App.content.items = []; App.content.itemsById = {}; App.content.pbqs = []; App.content.pbqsById = {};"
                     "App.mock = null; App.queue = [];")
        click("[data-action=nav][data-section=mock]")
        shot("empty bank", "mock-home")
        rep.check("Nothing to run a mock on" in main_text() and not tab.evaluate("!!document.querySelector('[data-action=mock-start]')"),
                  "empty bank  mock home: one sentence, no block buttons, Reload")
        click("[data-action=nav][data-section=drill]")
        shot("empty bank", "drill-home")
        rep.check("No items are loaded" in main_text(), "empty bank  drill home: one sentence, Reload")
        quiet("short mock", n0)


def scenario_keyboard(rep, tmp, browser):
    """Keyboard and the accessibility tree, read from Chrome itself: focus
    survives every render, every control under main has a name, a control's
    state is in its name or its ARIA state, and a change is announced."""
    rep.head("Keyboard and the accessibility tree")
    with throwaway(tmp, "keyboard") as (base, _):
        tab = browser.tab
        n0 = len(tab.errors)
        tab.call("Accessibility.enable")
        tab.navigate(f"{base}/?scratch=1")
        rep.check(tab.wait_for(APP_READY), "the app boots in scratch mode")

        def press(k, code=None, vk=0, text=None):
            ev = dict(key=k, code=code or k, windowsVirtualKeyCode=vk)
            if text:
                ev["text"] = text
            tab.call("Input.dispatchKeyEvent", type="keyDown", **ev)
            tab.call("Input.dispatchKeyEvent", type="keyUp", **ev)

        enter = lambda: press("Enter", vk=13, text="\r")
        space = lambda: press(" ", code="Space", vk=32, text=" ")
        tab_key = lambda: press("Tab", vk=9)
        active = lambda: tab.evaluate(ACTIVE_JS) or ""
        focus = lambda sel: tab.evaluate(f"document.querySelector({json.dumps(sel)}).focus()")

        def said():
            """What the live region says, once it says anything (it is cleared then filled)."""
            out = [""]
            poll(lambda: out.__setitem__(0, tab.evaluate("document.getElementById('live').textContent") or "") or out[0], 3)
            return out[0]

        def clear_said():
            tab.evaluate("document.getElementById('live').textContent = ''")

        def nameless(label):
            """Controls under main that Chrome exposes with no accessible name."""
            nodes = tab.call("Accessibility.getFullAXTree")["nodes"]
            by_id = {n["nodeId"]: n for n in nodes}
            main = next((n for n in nodes if n.get("role", {}).get("value") == "main"), None)
            bad, total = [], 0
            def walk(n):
                nonlocal total
                role = n.get("role", {}).get("value", "")
                if not n.get("ignored") and role in ("button", "combobox", "textbox", "checkbox", "link", "switch", "slider"):
                    total += 1
                    if not n.get("name", {}).get("value", "").strip():
                        bad.append(role)
                for c in n.get("childIds", []):
                    if c in by_id:
                        walk(by_id[c])
            if main:
                walk(main)
            rep.check(main is not None and not bad, f"{label}: {total} controls under main, every one named", f"({len(bad)} nameless: {bad[:6]})")

        # One single-select and one multi-select item, taken from the bank
        # rather than from the random queue, which need not hold a choose-two.
        tab.evaluate("App.queue = ['mcq', 'mcq-multi'].map((t) => ({ kind: 'item', item: App.content.items.find((i) => i.type === t), reason: '' }));"
                     "App.idx = 0; document.querySelector('[data-action=nav][data-section=drill]').click()")
        nameless("drill, single select")
        focus("[data-action=answer][data-opt=b]")
        clear_said()
        enter()
        rep.check(active().startswith("DIV.verdict-banner"), "Enter on option B answers it and focus lands on the verdict", f"({active()})")
        rep.check("orrect" in said(), "the verdict is announced", f"({said()!r})")
        # Between the verdict and Next sits the correction, when there is one.
        path = []
        for _ in range(4):
            tab_key()
            path.append(active())
            if path[-1] == "BUTTON.btn[action=next]":
                break
        rep.check(path[-1] == "BUTTON.btn[action=next]" and tab.evaluate("document.getElementById('main').contains(document.activeElement)"),
                  f"Tab from the verdict reads down to Next in {len(path)} step{'s' if len(path) != 1 else ''}", f"({path})")
        nameless("drill, answered")
        enter()
        focus("[data-action=multi-toggle][data-opt=a]")
        clear_said()
        space()
        rep.check(active().startswith("BUTTON.opt.chosen[action=multi-toggle,opt=a]")
                  and tab.evaluate("document.activeElement.getAttribute('aria-checked') === 'true'"),
                  "Space on a choose-two option checks it and keeps focus on it", f"({active()})")
        rep.check("1 of" in said(), "the count is announced", f"({said()!r})")

        # The ACL grid.
        tab.evaluate("document.querySelector('[data-action=nav][data-section=lab]').click();"
                     "document.querySelector('[data-action=open-pbq][data-id=pbq-acl-001]').click()")
        focus("[data-action=acl-add]")
        enter()
        rep.check(active() == "BUTTON.btn.ghost.small[action=acl-add]", "Enter on Add rule adds one and keeps focus on Add rule", f"({active()})")
        order = []
        for _ in range(7):
            tab_key()
            order.append(tab.evaluate("document.activeElement.getAttribute('aria-label')"))
        rep.check(order == ["Rule 1 action", "Rule 1 protocol", "Rule 1 source", "Rule 1 source port",
                            "Rule 1 destination", "Rule 1 destination port", "Delete rule 1"],
                  "Tab walks the rule left to right and every control says which rule and column it is", f"({order})")
        nameless("ACL grid")

        # The network diagram.
        tab.evaluate("App.lab = null; document.querySelector('[data-action=nav][data-section=lab]').click();"
                     "document.querySelector('[data-action=open-pbq][data-id=pbq-diagram-001]').click()")
        rep.check(tab.evaluate("!document.querySelector('[data-node]:not([tabindex])[role]')"
                               " && document.querySelector('svg.diagram').getAttribute('role') === 'group'"),
                  "a host with nothing to open is not a control, and the diagram is a group, not an image")
        focus("[data-node][tabindex]")
        host = active().split("[")[-1]   # the node id; the class changes once it is inspected
        clear_said()
        enter()
        rep.check(active().endswith(host) and ".inspected" in active() and "evidence" in said(),
                  "Enter on a host opens its evidence, keeps focus on the host, and says so", f"({active()} said {said()!r})")
        rep.check(tab.evaluate("document.activeElement.getAttribute('aria-label').includes(', reviewed')"),
                  "the host's name now carries its reviewed state")
        nameless("network diagram")

        # Order and classify.
        tab.evaluate("App.lab = null; document.querySelector('[data-action=nav][data-section=lab]').click();"
                     "document.querySelector('[data-action=open-pbq][data-id=pbq-order-001]').click()")
        focus("[data-action=order-hold]")
        chip = active()
        clear_said()
        enter()
        rep.check(active() == chip.replace("BUTTON.chip[", "BUTTON.chip.held[") and
                  tab.evaluate("document.activeElement.getAttribute('aria-pressed') === 'true'") and "Holding" in said(),
                  "Enter on a chip holds it, keeps focus, states pressed, and says what to do next", f"({active()} said {said()!r})")
        rep.check(tab.evaluate("document.querySelector('[data-action=order-place-at]').getAttribute('aria-label')").startswith("Position 1: place "),
                  "each position says what pressing it will do")
        nameless("order")

        # The mock: a chosen option is pressed, the review grid speaks its states.
        tab.evaluate("App.lab = null; document.querySelector('[data-action=nav][data-section=mock]').click();"
                     "document.querySelector('[data-action=mock-start][data-format=short]').click();"
                     "App.mock.idx = App.mock.items.findIndex((e) => e.kind === 'item');"
                     "document.querySelector('[data-action=nav][data-section=mock]').click()")
        focus("[data-action=mock-answer][data-opt=a]")
        enter()
        rep.check(active().startswith("BUTTON.opt.chosen[action=mock-answer,opt=a]")
                  and tab.evaluate("document.activeElement.getAttribute('aria-pressed') === 'true'"),
                  "a chosen mock option keeps focus and is pressed", f"({active()})")
        tab.evaluate("document.querySelector('[data-action=mock-review]').click()")
        labels = tab.evaluate("[...document.querySelectorAll('.rv')].map((b) => b.getAttribute('aria-label'))")
        rep.check(labels and all(l.startswith("Question ") and (", answered" in l or ", blank" in l) for l in labels)
                  and sum(", answered" in l for l in labels) == 1,
                  "every review cell says its number and whether it is answered", f"({labels[:3]})")
        nameless("mock review")

        ring = tab.evaluate("document.querySelector('.goal-ring').getAttribute('aria-label')") or ""
        rep.check(re.fullmatch(r"\d+ of \d+ reviews today", ring), f"the goal ring is one image with a name: {ring!r}")
        rep.check(not tab.errors[n0:], "no console error", "; ".join(tab.errors[n0:])[:200])


def scenario_backup(rep, tmp, browser):
    """A dated tarball out, a confirmed restore back, and the restore sticks
    against a tab that still holds the newer copy it was meant to replace."""
    rep.head("Backup and restore")
    with throwaway(tmp, "backup") as (base, data):
        tab = browser.tab
        n0 = len(tab.errors)
        backups = pathlib.Path(tmp) / "backups"
        env = {**os.environ, "DYSP_DATA": str(data), "DYSP_BACKUPS": str(backups)}
        run = lambda *args: subprocess.run([sys.executable, str(ROOT / "scripts/backup.py"), *args],
                                           env=env, capture_output=True, text=True, stdin=subprocess.DEVNULL, timeout=30)
        state_url = f"{base}/api/state"
        http("PUT", state_url, doc(1000, misconceptions={"acl-implicit-deny": {"hits": 1, "retired": False}}))
        http("POST", f"{base}/api/reviews", [{"at": 1, "kind": "item", "id": "c-001", "grade": 3}])

        r = run("backup")
        tarballs = sorted(backups.glob("dysp-*.tar.gz"))
        rep.check(r.returncode == 0 and len(tarballs) == 1, "backup writes one dated tarball outside the data directory",
                  f"(exit {r.returncode}: {r.stdout or r.stderr})")
        import tarfile
        with tarfile.open(tarballs[0]) as tar:
            names = set(tar.getnames())
        rep.check({"state.json", "reviews.jsonl", "snapshots"} <= names and any(n.startswith("snapshots/state-") for n in names),
                  "it holds state.json, reviews.jsonl and the snapshots", f"({sorted(names)})")

        # Life goes on: the misconception is cleared, another row lands, and a
        # tab loads the newer copy into its localStorage.
        http("PUT", state_url, doc(2000), {"If-Match": "1000"})
        http("POST", f"{base}/api/reviews", [{"at": 2, "kind": "item", "id": "c-002", "grade": 1}])
        tab.navigate(f"{base}/")
        rep.check(tab.wait_for(APP_READY) and tab.evaluate("App.state.updatedAt === 2000"), "a tab holds the newer copy")

        r = run("restore", str(tarballs[0]), "--yes")
        saved = on_disk(data)
        rep.check(r.returncode == 0 and "acl-implicit-deny" in saved["misconceptions"],
                  "restore brings the backed-up document back", f"(exit {r.returncode}: {r.stdout or r.stderr})")
        rep.check(saved["updatedAt"] > 2000, f"with a fresh updatedAt, so it is the newest copy anywhere ({saved['updatedAt']})")
        rep.check(log_rows(data) == 1, "the log is back to the backed-up rows", f"({log_rows(data)})")
        rep.check(len(sorted(backups.glob("dysp-*.tar.gz"))) == 2, "a safety backup of what was there was taken first")

        # The tab that was never closed reloads and takes the restored copy,
        # rather than winning the reconcile and pushing the replaced data back.
        tab.navigate(f"{base}/")
        ready = tab.wait_for(APP_READY)
        held = tab.evaluate("[App.state.updatedAt, Object.keys(App.state.misconceptions), App.screen]")
        rep.check(ready and tab.evaluate("'acl-implicit-deny' in App.state.misconceptions"),
                  "a reloaded tab takes the restored copy instead of pushing its own back",
                  f"(tab holds {held}; server {http('GET', state_url)[1].get('updatedAt')}; errors {tab.errors[n0:]})")
        # The backed-up record above has no scheduling card, as a hand-edited
        # or older document might. It is filled in on load, not fatal.
        rep.check(tab.evaluate("!!App.state.misconceptions['acl-implicit-deny']?.fsrs && Array.isArray(App.state.misconceptions['acl-implicit-deny'].cleanPasses)"),
                  "a restored record missing its card is filled in rather than taking the app down")
        time.sleep(2.2)   # past the save debounce, so any push it did make has landed
        rep.check("acl-implicit-deny" in on_disk(data)["misconceptions"] and on_disk(data)["updatedAt"] >= saved["updatedAt"],
                  "and the restored document is still on disk after the debounce")
        rep.check(not tab.errors[n0:], "no console error", "; ".join(tab.errors[n0:])[:200])

        before = on_disk(data)["updatedAt"]
        r = run("restore", str(tarballs[0]))   # no --yes and no terminal to ask: refuses
        rep.check(r.returncode != 0 and "nothing changed" in r.stdout and on_disk(data)["updatedAt"] == before,
                  "without a yes, restore changes nothing", f"(exit {r.returncode}: {(r.stdout + r.stderr)[-120:]!r})")


def scenario_logs(rep, tmp):
    """The log can never fill the disk: the server rotates its own by size, a
    held port is a wait rather than a crash loop, and launchd's file is capped
    on every launch."""
    rep.head("Logs stay bounded")
    logs = pathlib.Path(tmp) / "logs"
    env = {**os.environ, "DYSP_DATA": os.path.join(tmp, "logs-data"),
           "DYSP_LOG": str(logs / "server.log"), "DYSP_LOG_BYTES": "4000"}
    port = free_port()
    first = subprocess.Popen([sys.executable, str(ROOT / "serve.py"), str(port)], env=env,
                             stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)
    second = None
    try:
        base = f"http://127.0.0.1:{port}"
        rep.check(wait_http(f"{base}/api/health") is not None, "a server with DYSP_LOG set starts")
        for i in range(300):
            try:
                urllib.request.urlopen(f"{base}/missing-{i}", timeout=2)
            except urllib.error.HTTPError:
                pass
        files = sorted(logs.glob("server.log*"))
        sizes = {f.name: f.stat().st_size for f in files}
        rep.check([f.name for f in files] == ["server.log", "server.log.1", "server.log.2", "server.log.3"]
                  and all(n <= 4200 for n in sizes.values()),
                  f"300 logged 404s rotate into four files, none past the cap ({sum(sizes.values()):,} bytes in all)", f"({sizes})")
        rep.check("missing-299" in (logs / "server.log").read_text(), "the newest line is in server.log")

        # A second server on the same port: one line, no exit, no traceback.
        second = subprocess.Popen([sys.executable, str(ROOT / "serve.py"), str(port)], env=env,
                                  stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        time.sleep(1.5)
        text = "".join(f.read_text() for f in logs.glob("server.log*"))
        rep.check(second.poll() is None and text.count(f"port {port} is in use") == 1,
                  "a second server on a held port waits with one log line instead of exiting")
        first.terminate(); first.wait(timeout=5)
        rep.check(poll(lambda: wait_http(f"{base}/api/health", seconds=1) is not None, 12),
                  "and takes the port over once it frees up")
        errs = first.stderr.read().decode()
        rep.check("Traceback" not in errs, "nothing reached stderr", f"({errs[-160:]!r})")
    finally:
        for proc in (first, second):
            if proc and proc.poll() is None:
                proc.terminate()
                try:
                    proc.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    proc.kill()

    # The launch-time cap, run exactly as the plist runs it.
    crash = logs / "crash.log"
    crash.write_bytes(b"x" * 300_000 + b"\nlast line\n")
    with crash.open("ab") as held:   # launchd's descriptor, opened for append before the program runs
        r = subprocess.run(["/bin/sh", str(ROOT / "scripts/capped-log.sh"), str(crash), "/bin/echo", "started"],
                           stdout=held, stderr=held, timeout=10)
    body = crash.read_bytes()
    rep.check(r.returncode == 0 and len(body) <= 65_536 + 64 and body.endswith(b"last line\nstarted\n"),
              f"a 300 KB crash.log is cut to its last 64 KB in place and the program still writes to it ({len(body):,} bytes)")


def main():
    chrome = next((c for c in CANDIDATES if c and pathlib.Path(c).exists()), None)
    if not chrome:
        print("no Chrome or Chromium found; the self test is manual: open http://localhost:8777/selftest.html")
        return 2

    t0 = time.time()
    tmp = tempfile.mkdtemp(prefix="dysp-selftest-")
    rep = Report()
    browser = None
    scenarios = {
        "page": lambda: scenario_page(rep, tmp, browser),
        "conflict": lambda: scenario_conflict(rep, tmp, browser),
        "snapshot": lambda: scenario_snapshot(rep, tmp),
        "outbox": lambda: scenario_outbox(rep, tmp, browser),
        "absorb": lambda: scenario_absorb(rep, tmp, browser),
        "screens": lambda: scenario_screens(rep, tmp, browser),
        "keyboard": lambda: scenario_keyboard(rep, tmp, browser),
        "backup": lambda: scenario_backup(rep, tmp, browser),
        "logs": lambda: scenario_logs(rep, tmp),
    }
    only = [a for a in sys.argv[1:] if a in scenarios]   # python3 scripts/selftest.py screens
    try:
        browser = Browser(chrome, os.path.join(tmp, "profile"))
        for name, run in scenarios.items():
            if not only or name in only:
                run()
    except Exception:
        rep.failures += 1
        print("  FAIL harness\n" + traceback.format_exc())
    finally:
        if browser:
            browser.close()
        shutil.rmtree(tmp, ignore_errors=True)

    print(f"\nself test {'passed' if not rep.failures else 'FAILED'} in {time.time() - t0:.1f}s")
    return 0 if not rep.failures else 1


if __name__ == "__main__":
    sys.exit(main())
