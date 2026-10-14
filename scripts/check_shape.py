#!/usr/bin/env python3
"""Fail on anything that would change the shape of this repository.

The shape: no build step, an app that imports only itself, nothing exported
for nobody, no stylesheet rule for markup that is gone, no request off this
origin on load, an API of nouns, and one implementation per idea across Python
and JavaScript. Each rule is one function below; the reason is in
CONVENTIONS.md. Stdlib only, because Node is not installed and is not wanted.
"""
import re, sys, json, pathlib

ROOT = pathlib.Path(__file__).resolve().parent.parent
fails = []
fail = fails.append

JS = sorted(ROOT.glob("app/**/*.js"))
HTML = [ROOT / "index.html", ROOT / "selftest.html"]
# Analysis scripts that import the app (scripts/replay.js) are consumers of
# its exports, never part of it (and selftest/*.js, the in-browser tests): they
# count as a reference, nothing more.
TOOLS = sorted(ROOT.glob("scripts/*.js")) + sorted(ROOT.glob("selftest/*.js"))
SRC = {p: p.read_text() for p in JS + HTML + TOOLS}
ALL_SRC = "\n".join(SRC.values())
rel = lambda p: str(p.relative_to(ROOT))


def exports_of(src):
    names = re.findall(r"^export (?:async )?(?:function|const|let|class) (\w+)", src, re.M)
    for grp in re.findall(r"^export \{([^}]+)\}", src, re.M):
        names += [n.strip().split(" as ")[-1] for n in grp.split(",") if n.strip()]
    return names


def no_build_step():
    for name in ("package.json", "package-lock.json", "yarn.lock", "pnpm-lock.yaml", "node_modules",
                 "tsconfig.json", "webpack.config.js", "vite.config.js", "rollup.config.js", ".babelrc"):
        if (ROOT / name).exists():
            fail(f"{name} exists: no build step and no package manifest, ever")


def app_imports_only_app():
    app = (ROOT / "app").resolve()
    for p in JS:
        for spec in re.findall(r'^import .*?from\s+"([^"]+)"', SRC[p], re.M):
            target = (p.parent / spec).resolve()
            if not spec.startswith(".") or app not in target.parents:
                fail(f"{rel(p)} imports {spec}: app/ imports only from app/")


def every_export_used():
    for p in JS:
        for n in exports_of(SRC[p]):
            pat = r"\b%s\b" % re.escape(n)
            if not any(re.search(pat, s) for q, s in SRC.items() if q != p):
                fail(f"{rel(p)} exports {n} and nothing else references it")


def every_css_class_used():
    css = re.sub(r"/\*.*?\*/", "", "\n".join(f.read_text() for f in sorted((ROOT / "css").glob("*.css"))), flags=re.S)
    for c in sorted(set(re.findall(r"\.([a-zA-Z_][\w-]*)", css))):
        if re.search(r"\b%s\b" % re.escape(c), ALL_SRC):
            continue
        # Built by a template: s-${status}, t-${tier}, c-${tone}.
        if "-" in c and (c.split("-")[0] + "-${") in ALL_SRC:
            continue
        fail(f"css/*.css .{c} has no reference in app/ or *.html")


def app_hardcodes_no_stem():
    # An exam item's stem or a PBQ's scenario written into app/ is content in
    # code. The opening 30 characters of each is enough to find a copy.
    heads = {}
    def walk(x, f):
        if isinstance(x, dict):
            for k, v in x.items():
                if k in ("stem", "scenario") and isinstance(v, str) and len(v) >= 30:
                    heads.setdefault(" ".join(v.split())[:30], f)
                walk(v, f)
        elif isinstance(x, list):
            for v in x:
                walk(v, f)
    for f in sorted((ROOT / "content").rglob("*.json")):
        walk(json.loads(f.read_text()), f)
    for p in JS:
        flat = " ".join(SRC[p].split())
        for head, f in heads.items():
            if head in flat:
                fail(f"{rel(p)} hardcodes the stem that opens \"{head}\" (from {rel(f)}): content lives under content/, never in app/")


def nothing_off_origin_on_load():
    for i, line in enumerate((ROOT / "index.html").read_text().splitlines(), 1):
        if re.search(r'<(link|script)\b[^>]*\b(href|src)="(https?:)?//', line):
            fail(f"index.html:{i} loads from another origin; the page makes no network request it does not serve itself")


VERBS = {"get", "set", "save", "load", "fetch", "update", "delete", "remove", "create", "add", "restore",
         "force", "push", "pull", "sync", "run", "do", "check", "reset", "clear", "export", "import",
         "submit", "send", "list", "read", "write", "apply", "execute"}


def api_paths_are_nouns():
    for path in sorted(set(re.findall(r'"/api/([\w/\-]+)"', (ROOT / "serve.py").read_text()))):
        for seg in path.split("/"):
            if seg.lower() in VERBS:
                fail(f"serve.py route /api/{path}: '{seg}' is a verb; resources are nouns and the method is the verb")


def one_implementation_per_idea():
    camel = lambda n: re.sub(r"_([a-z0-9])", lambda m: m.group(1).upper(), n.lstrip("_"))
    py = {}
    for p in list((ROOT / "scripts").glob("*.py")) + [ROOT / "serve.py"]:
        for name in re.findall(r"^def (\w+)", p.read_text(), re.M):
            py.setdefault(camel(name), []).append(f"{p.name}:{name}")
    js = {}
    for p in JS:
        for n in exports_of(SRC[p]):
            js.setdefault(n, []).append(rel(p))
    for n in sorted(set(py) & set(js) - {"main"}):
        fail(f"'{n}' exists in Python ({', '.join(py[n])}) and JavaScript ({', '.join(js[n])}): one implementation per idea")


if __name__ == "__main__":
    for check in (no_build_step, app_imports_only_app, app_hardcodes_no_stem, every_export_used, every_css_class_used,
                  nothing_off_origin_on_load, api_paths_are_nouns, one_implementation_per_idea):
        check()
    if fails:
        print("\n".join("  x " + f for f in fails))
        sys.exit(1)
    print(f"shape holds: {len(JS)} modules, every export and class referenced, API of nouns, nothing off origin, no duplicate logic")
