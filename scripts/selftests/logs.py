"""Self test scenario: logs. Run alone with python3 scripts/selftest.py logs."""
import os, subprocess, sys, time, pathlib, urllib.error, urllib.request
from selftest import ROOT, free_port, wait_http, poll, scenario


@scenario("logs", order=100, browser=False)
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
