#!/usr/bin/env python3
"""Run selftest.html without a window and exit non-zero if any check fails.

Node is not installed and is not wanted, so this drives the Chrome already on
the machine: headless, with its DevTools port open, against a throwaway copy of
the server on an empty data directory. A minimal DevTools client (stdlib only;
one WebSocket frame type is all it needs) polls the page until the self test
has written its result, then reads it out. The self test only reads content
and runs pure functions; it never writes study data.

If no Chrome is found the exit code is 2 and the test stays manual: open
http://localhost:8777/selftest.html.
"""
import base64, json, os, shutil, socket, subprocess, sys, tempfile, time, urllib.request, pathlib

ROOT = pathlib.Path(__file__).resolve().parent.parent
CANDIDATES = [
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
    shutil.which("google-chrome"), shutil.which("chromium"), shutil.which("chromium-browser"),
]
TIMEOUT_S = 60


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

    def evaluate(self, expression):
        msg_id = self.send("Runtime.evaluate", expression=expression, returnByValue=True)
        while True:
            msg = self.recv()
            if msg.get("id") == msg_id:
                return msg.get("result", {}).get("result", {}).get("value")

    def close(self):
        self.sock.close()


def main():
    chrome = next((c for c in CANDIDATES if c and pathlib.Path(c).exists()), None)
    if not chrome:
        print("no Chrome or Chromium found; the self test is manual: open http://localhost:8777/selftest.html")
        return 2

    port, dev = free_port(), free_port()
    t0 = time.time()
    tmp = tempfile.mkdtemp(prefix="dysp-selftest-")
    server = subprocess.Popen(
        [sys.executable, str(ROOT / "serve.py"), str(port)],
        env={**os.environ, "DYSP_DATA": os.path.join(tmp, "data")},
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
    )
    browser = None
    text = ""
    try:
        if not wait_http(f"http://127.0.0.1:{port}/api/content"):
            print("throwaway server did not start")
            return 1
        url = f"http://127.0.0.1:{port}/selftest.html"
        browser = subprocess.Popen(
            [chrome, "--headless=new", "--disable-gpu", "--no-first-run", "--no-default-browser-check",
             f"--user-data-dir={os.path.join(tmp, 'profile')}", f"--remote-debugging-port={dev}", url],
            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
        )
        targets = []
        for _ in range(100):
            raw = wait_http(f"http://127.0.0.1:{dev}/json", seconds=1)
            targets = [t for t in (json.loads(raw) if raw else []) if t.get("url", "").startswith(url)]
            if targets:
                break
            time.sleep(0.1)
        if not targets:
            print("Chrome did not open the self test page")
            return 1
        dt = DevTools(targets[0]["webSocketDebuggerUrl"])
        deadline = time.time() + TIMEOUT_S
        while time.time() < deadline:
            text = dt.evaluate("(document.getElementById('out') || {}).innerText || ''") or ""
            if text.strip() and not text.strip().startswith("Running"):
                break
            time.sleep(0.25)
        dt.close()
    finally:
        for proc in (browser, server):
            if proc:
                proc.terminate()
                try:
                    proc.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    proc.kill()
        shutil.rmtree(tmp, ignore_errors=True)

    text = text.strip()
    print(text)
    ok = bool(text) and "All checks passed." in text and "FAIL" not in text
    print(f"\nself test {'passed' if ok else 'FAILED'} in {time.time() - t0:.1f}s")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
