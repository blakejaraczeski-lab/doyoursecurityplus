"""Self test scenario: systemd. Run alone with python3 scripts/selftest.py systemd."""
import json, os, subprocess, sys, pathlib
from selftest import ROOT, free_port, wait_http, poll, scenario


def parse_unit(path):
    """A systemd unit as {section: [(key, value), ...]}; keys repeat (Environment)."""
    out, section = {}, None
    for line in path.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith(("#", ";")):
            continue
        if line.startswith("[") and line.endswith("]"):
            section = out.setdefault(line[1:-1], [])
        else:
            k, _, v = line.partition("=")
            section.append((k.strip(), v.strip()))
    return out


@scenario("systemd", order=110, browser=False)
def scenario_systemd(rep, tmp):
    """The Linux path of service.sh, everywhere short of systemd itself: the
    units it writes, the calls it makes, and the command line it declares,
    run for real as a server."""
    import shlex
    rep.head("Linux: the systemd user unit")
    root = pathlib.Path(tmp) / "linux"
    units, data, stubs = root / "units", root / "study data", root / "bin"   # a space, to test the quoting
    stubs.mkdir(parents=True)
    calls = root / "systemctl.calls"
    (stubs / "systemctl").write_text(f'#!/bin/sh\necho "$@" >> "{calls}"\n[ "$2" = is-active ] && echo active\nexit 0\n')
    (stubs / "notify-send").write_text(f'#!/bin/sh\nprintf "%s|" "$@" > "{root}/notified"\n')
    for f in stubs.iterdir():
        f.chmod(0o755)
    port = free_port()
    env = {**os.environ, "DYSP_PLATFORM": "linux", "SYSTEMD_USER_DIR": str(units), "DYSP_SYSTEMCTL": str(stubs / "systemctl"),
           "DYSP_DATA": str(data), "DYSP_PORT": str(port)}
    r = subprocess.run(["bash", str(ROOT / "scripts/service.sh"), "install", "--remind", "7:05"], env=env,
                       capture_output=True, text=True, timeout=30)
    rep.check(r.returncode == 0, "install on Linux succeeds", f"({r.stderr.strip()[-200:]})")
    made = sorted(f.name for f in units.glob("*")) if units.exists() else []
    rep.check(made == ["doyoursecurityplus-remind.service", "doyoursecurityplus-remind.timer", "doyoursecurityplus.service"],
              "it writes the service, the reminder service and its timer", f"({made})")
    log = calls.read_text().splitlines() if calls.exists() else []
    rep.check(log[:3] == ["--user daemon-reload", "--user enable --now doyoursecurityplus.service",
                          "--user enable --now doyoursecurityplus-remind.timer"],
              "and reloads, enables and starts them as user units", f"({log})")

    unit = parse_unit(units / "doyoursecurityplus.service")
    svc = dict(unit.get("Service", []))
    envs = dict(shlex.split(v)[0].split("=", 1) for k, v in unit.get("Service", []) if k == "Environment")
    rep.check(svc.get("Restart") == "on-failure" and dict(unit.get("Install", [])).get("WantedBy") == "default.target"
              and envs.get("DYSP_DATA") == str(data) and envs.get("DYSP_LOG") == str(data / "logs" / "server.log"),
              "the unit restarts on failure, starts with the session, and sets DYSP_DATA and DYSP_LOG", f"({svc}, {envs})")
    timer = dict(parse_unit(units / "doyoursecurityplus-remind.timer").get("Timer", []))
    rep.check(timer.get("OnCalendar") == "*-*-* 07:05:00" and timer.get("Persistent") == "true",
              "the reminder fires daily at 07:05, and catches up if the machine was off", f"({timer})")

    # The declared command, run exactly as systemd would: its argv, its environment, its directory.
    argv = shlex.split(svc["ExecStart"])
    proc = subprocess.Popen(argv, cwd=svc["WorkingDirectory"], env={**os.environ, **envs},
                            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    try:
        raw = wait_http(f"http://127.0.0.1:{port}/api/health")
        h = json.loads(raw) if raw else {}
        rep.check(h.get("stateFile") == str(data / "state.json"),
                  "the declared ExecStart serves the declared data directory, space and all", f"({h.get('stateFile')})")
        rep.check(poll(lambda: "doyoursecurityplus" in (data / "logs" / "server.log").read_text(), 5),
                  "and writes its own rotating log where the unit says")
    finally:
        proc.terminate()
        proc.wait(timeout=5)

    # The reminder's Linux notifier, through a stub notify-send.
    code = ("import sys; sys.platform = 'linux'; sys.path.insert(0, %r); import remind; remind.notify('Title', 'Body', 'http://x')"
            % str(ROOT / "scripts"))
    subprocess.run([sys.executable, "-c", code], env={**os.environ, "PATH": f"{stubs}:{os.environ['PATH']}"}, timeout=10)
    sent = (root / "notified").read_text() if (root / "notified").exists() else ""
    rep.check(sent.startswith("--app-name=doyoursecurityplus|Title|Body"), "the reminder notifies through notify-send on Linux", f"({sent!r})")

    r = subprocess.run(["bash", str(ROOT / "scripts/service.sh"), "uninstall"], env=env, capture_output=True, text=True, timeout=30)
    rep.check(r.returncode == 0 and not any(units.glob("*")) and "--user disable --now doyoursecurityplus.service" in calls.read_text(),
              "uninstall disables the units and removes the files, leaving the data")
    rep.check((data / "logs").exists(), "the study data directory is untouched by uninstall")
