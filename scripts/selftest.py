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
import base64, contextlib, json, os, shutil, socket, subprocess, sys, tempfile, time, traceback
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
        self.errors = []   # everything the page threw or logged as an error

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
        if msg.get("method") == "Runtime.exceptionThrown":
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
        self.call("Page.navigate", url=url)
        if not self.wait_for(f"location.href.startsWith({json.dumps(url)}) && document.readyState === 'complete'", seconds):
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
      body.pbq = [...body.pbq, 'zz-no-engine.json'];
      return json(body);
    }
    if (u.endsWith('/pbq/zz-no-engine.json')) return json(orphan);
    return real(url, opts);
  };
})();"""

LEAD_JS = """(() => {
  const el = document.querySelector('#main .sub, #main .empty p, #main .stem, #main .note, #main p');
  return el ? el.textContent.trim().replace(/\\s+/g, ' ') : '';
})()"""


# --- scenarios ---------------------------------------------------------------
def scenario_page(rep, tmp, browser):
    """selftest.html: every pure-function check, read out of the page."""
    rep.head("selftest.html")
    with throwaway(tmp, "page") as (base, _):
        tab = browser.tab
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

        # 2. An empty review log on a first boot: all twelve screens.
        n0 = len(tab.errors)
        tab.navigate(f"{base}/")
        rep.check(tab.wait_for(APP_READY), "empty log   the app boots straight into a session")
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
        tab.evaluate("App.queue = [App.queue.find((e) => e.item?.type === 'mcq')]; App.idx = 0;")
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
