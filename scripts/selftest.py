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

This file is the harness and nothing else. Every scenario lives in its own
module under scripts/selftests/, found by a glob: a new scenario is a new file,
and there is no list to edit. A module registers a scenario with the decorator
defined below:

    from selftest import scenario, throwaway, APP_READY

    @scenario("my-name", order=75)                 # (rep, tmp, browser)
    def scenario_my_name(rep, tmp, browser): ...

    @scenario("my-server-test", order=76, browser=False)   # (rep, tmp)
    def scenario_my_server_test(rep, tmp): ...

`order` sorts the run (ties by name); `on_request=True` leaves a scenario out of
the default run, to be named: python3 scripts/selftest.py my-name
"""
import base64, contextlib, json, os, shutil, socket, subprocess, sys, tempfile, time, traceback
import urllib.error, urllib.request, pathlib, importlib.util

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
        self.call("Page.bringToFront")   # after idle, headless Chrome on Linux hides the tab, then paints one frame a second

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


def seed_heavy(data, rows):
    """A study record at scale: every graded item seen, every misconception
    banked (half retired), and `rows` review rows over the last 30 days."""
    import random
    rnd = random.Random(7)
    items = [i for f in sorted((ROOT / "content/items").glob("*.json")) for i in json.loads(f.read_text())]
    mcs = [m["id"] for f in sorted((ROOT / "content/mentor").glob("*.json")) for m in json.loads(f.read_text())]
    pbqs = [json.loads(f.read_text())["id"] for f in sorted((ROOT / "content/pbq").glob("*.json"))]
    now = int(time.time() * 1000)
    day = 86400000
    card = lambda: {"stability": rnd.uniform(1, 40), "difficulty": rnd.uniform(3, 8), "due": now + rnd.randint(-5, 30) * day,
                    "lastReview": now - rnd.randint(1, 20) * day, "reps": rnd.randint(1, 6), "lapses": rnd.randint(0, 2), "state": "review"}
    state = doc(now - 1000)
    state["profile"]["examDate"] = time.strftime("%Y-%m-%d", time.localtime((now + 45 * day) / 1000))
    for it in items:
        if it["type"] != "recall" or rnd.random() < 0.3:
            n = rnd.randint(1, 6)
            c = rnd.randint(0, n)
            state["items"][it["id"]] = {"seen": n, "correct": c, "wrong": n - c, "lastSeen": now - day, "fsrs": card()}
    for k, mc in enumerate(mcs):
        state["misconceptions"][mc] = {"fsrs": card(), "cleanPasses": [], "hits": rnd.randint(1, 4), "banked": now - 20 * day,
                                       "retired": k % 2 == 0, "lastItem": None, "firstItem": None, "step": 1, "due": now - rnd.randint(0, 5) * day}
    for p in pbqs:
        state["pbq"][p] = {"attempts": 2, "best": rnd.randint(40, 100), "lastAt": now - day}
    (data / "state.json").write_text(json.dumps(state))
    graded = [i["id"] for i in items]
    with (data / "reviews.jsonl").open("w") as f:
        for k in range(rows):
            at = now - 30 * day + int(k * (30 * day - 60000) / rows)
            kind = "item" if k % 3 else "misconception"
            r = ({"at": at, "kind": "item", "id": rnd.choice(graded), "grade": rnd.choice([1, 3, 3, 3]), "ms": rnd.randint(5000, 60000), "conf": "sure"}
                 if kind == "item" else {"at": at, "kind": "misconception", "id": rnd.choice(mcs), "item": rnd.choice(graded), "grade": rnd.choice([1, 3])})
            f.write(json.dumps(r) + "\n")
        for k in range(6):
            f.write(json.dumps({"at": now - (k + 1) * 3 * day, "kind": "mock", "format": "full", "raw": 0.7, "scaled": 707, "seconds": 5000}) + "\n")


def seed_local(tab, state):
    """Put a document in localStorage before the page's own script runs, so the page's
    unload save cannot overwrite it. Returns the stub id to remove afterwards."""
    return tab.call("Page.addScriptToEvaluateOnNewDocument",
                    source=f"try {{ localStorage.setItem('dysp.v1', {json.dumps(json.dumps(state))}); }} catch (e) {{}}")["identifier"]


# --- scenario registry -------------------------------------------------------
SCENARIOS = {}   # name -> (order, run(rep, tmp, browser), on_request)


def scenario(name, order, browser=True, on_request=False):
    """Register a scenario from a module under scripts/selftests/. See the docstring above."""
    def register(fn):
        if name in SCENARIOS:
            raise RuntimeError(f"two scenarios are named {name}")
        SCENARIOS[name] = (order, fn if browser else (lambda rep, tmp, _browser: fn(rep, tmp)), on_request)
        return fn
    return register


def discover():
    """Import every scripts/selftests/*.py so each registers itself."""
    sys.modules.setdefault("selftest", sys.modules[__name__])   # run as a script, this file is __main__
    for path in sorted((ROOT / "scripts" / "selftests").glob("*.py")):
        spec = importlib.util.spec_from_file_location(f"selftests.{path.stem}", path)
        spec.loader.exec_module(importlib.util.module_from_spec(spec))


def main():
    chrome = next((c for c in CANDIDATES if c and pathlib.Path(c).exists()), None)
    if not chrome:
        print("no Chrome or Chromium found; the self test is manual: open http://localhost:8777/selftest.html")
        return 2

    t0 = time.time()
    tmp = tempfile.mkdtemp(prefix="dysp-selftest-")
    rep = Report()
    browser = None
    discover()
    scenarios = {n: (lambda run=run: run(rep, tmp, browser)) for n, (_, run, _) in
                 sorted(SCENARIOS.items(), key=lambda kv: (kv[1][0], kv[0]))}
    only = [a for a in sys.argv[1:] if a in scenarios]   # python3 scripts/selftest.py screens
    try:
        browser = Browser(chrome, os.path.join(tmp, "profile"))
        on_request = {n for n, (_, _, req) in SCENARIOS.items() if req}   # a report, run by name: python3 scripts/selftest.py latency-10000
        for name, run in scenarios.items():
            if (not only and name not in on_request) or name in only:
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
