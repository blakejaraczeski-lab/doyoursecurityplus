#!/usr/bin/env python3
"""Back up and restore the study data: state.json, reviews.jsonl, snapshots/.

  python3 scripts/backup.py backup [--to DIR]
  python3 scripts/backup.py restore FILE [--yes]

A backup is a dated tarball of the three things the server owns, written
outside the data directory (DYSP_BACKUPS, default ~/.doyoursecurityplus-backups).
A restore replaces them, after taking a safety backup of what is there now,
and then writes the restored document back through the server's own writer
with a fresh updatedAt. That last step is what makes a restore stick: every
open tab holds a copy in localStorage, and on reload the newer timestamp wins
the reconcile, so without it a tab would push the data you just replaced
straight back. With it, the restored copy is the newest: a reloaded tab takes
it, and a tab that is not reloaded is refused with 412 on its next save.

Honours DYSP_DATA exactly as serve.py does. The server reads from disk on
every request, so it does not need to be stopped. Stdlib only.
"""
import json, os, shutil, sys, tarfile, time, pathlib

ROOT = pathlib.Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
import serve   # noqa: E402  the one place that knows where the data lives and how it is written

BACKUPS = serve.BACKUPS_DIR
MEMBERS = serve.BACKUP_MEMBERS


def summary(state, rows, snaps):
    mis = (state or {}).get("misconceptions", {}) or {}
    when = time.strftime("%Y-%m-%d %H:%M", time.localtime((state or {}).get("updatedAt", 0) / 1000)) if state else "no state"
    return (f"state saved {when}, {sum(1 for m in mis.values() if not m.get('retired'))} open and "
            f"{sum(1 for m in mis.values() if m.get('retired'))} retired misconceptions, "
            f"{rows} log rows, {snaps} snapshots")


def backup(to=BACKUPS, label=""):
    """One tarball, named by the second and never over an existing one: a
    safety copy taken while restoring must not land on the archive being read.
    The archive itself is written by the server's own writer."""
    out = serve._backup_tarball(to, label)
    if out is None:
        print(f"nothing to back up in {serve.DATA_DIR}")
        return None
    snaps = len(list(serve.SNAP_DIR.glob("state-*.json"))) if serve.SNAP_DIR.exists() else 0
    print(f"backed up {serve.DATA_DIR}: {summary(serve._read_state(), serve._count_reviews(), snaps)}")
    print(f"{out.stat().st_size:,} bytes -> {out}")
    return out


def archive_summary(tar):
    names = set(tar.getnames())
    state = json.load(tar.extractfile("state.json")) if "state.json" in names else None
    rows = sum(1 for line in tar.extractfile("reviews.jsonl").read().splitlines() if line.strip()) if "reviews.jsonl" in names else 0
    snaps = sum(1 for n in names if n.startswith("snapshots/") and n.endswith(".json"))
    return state, summary(state, rows, snaps)


def restore(path, yes=False):
    path = pathlib.Path(path)
    with tarfile.open(path) as tar:
        for m in tar.getmembers():   # only the three members, nothing that escapes the data directory
            if m.name.split("/")[0] not in MEMBERS or m.name.startswith("/") or ".." in m.name.split("/"):
                print(f"refusing: {path} holds {m.name}, which is not study data")
                return 1
        state, desc = archive_summary(tar)
        if state is None:
            print(f"refusing: {path} holds no state.json")
            return 1
        print(f"archive:  {desc}")
        snaps = len(list(serve.SNAP_DIR.glob("state-*.json"))) if serve.SNAP_DIR.exists() else 0
        print(f"on disk:  {summary(serve._read_state(), serve._count_reviews(), snaps)}")
        print(f"\nThis replaces everything in {serve.DATA_DIR}. A safety backup is taken first.")
        if not yes:
            print("Close every doyoursecurityplus tab first; a tab left open is refused on its next save and must be reloaded.")
            try:
                answer = input("Type yes to replace it: ")
            except EOFError:   # no terminal to ask: a restore is never implied
                answer = ""
            if answer.strip().lower() != "yes":
                print("nothing changed")
                return 1
        safety = backup(label="before-restore")
        for name in MEMBERS:
            p = serve.DATA_DIR / name
            if p.is_dir():
                shutil.rmtree(p)
            elif p.exists():
                p.unlink()
        serve.DATA_DIR.mkdir(parents=True, exist_ok=True)
        try:
            tar.extractall(serve.DATA_DIR, filter="data")
        except TypeError:   # before the filter argument existed
            tar.extractall(serve.DATA_DIR)

    # A restore is a new write: the restored document gets a fresh updatedAt so
    # it wins the reconcile against every copy a browser still holds.
    state = serve._read_state()
    state["updatedAt"] = int(time.time() * 1000)
    serve._write_state(state)
    print(f"\nrestored {path.name} into {serve.DATA_DIR}; the previous data is in {safety.name if safety else '(there was none)'}")
    print("Reload any open doyoursecurityplus tab. One that is not reloaded is refused on its next save.")
    return 0


def main(argv):
    if argv[:1] == ["backup"]:
        to = pathlib.Path(argv[argv.index("--to") + 1]) if "--to" in argv else BACKUPS
        backup(to)
        return 0
    if argv[:1] == ["restore"] and len(argv) >= 2:
        return restore(argv[1], yes="--yes" in argv)
    print(__doc__.strip().split("\n\n")[1])
    return 2


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
