# Conventions

Ten rules. Each one says what, why in plain language, and how it is enforced.
"Manual" means a machine cannot check it yet and a reviewer must; that is a
weakness, listed as one. `bin/check` runs every automatic check and is the one
command to run before committing; `./scripts/service.sh hooks` makes it the
pre-commit hook.

1. **No build step and no package manifest, ever.** The app is plain ES
   modules and JSON served as files, so it runs with one Python file and
   nothing installed, and it will still run in ten years. Enforced:
   `scripts/check_shape.py` fails on `package.json`, lockfiles, `node_modules`
   or a bundler config.

2. **Content is JSON and the app never hardcodes an item.** Every question,
   correction, PBQ and glossary entry lives under `content/`, so adding
   material never means touching code. Enforced: `scripts/check_shape.py`
   fails on an `app/` import from outside `app/`; `scripts/format_content.py
   --check` fails on an item or mentor file not in canonical shape. Manual: a
   stem written as a string literal in `app/` would not be caught.

3. **One implementation per idea across Python and JavaScript.** Grading and
   coverage exist once, in JavaScript, and `selftest.html` asserts them; a
   second copy in Python is a place for the two to disagree, which they did.
   Enforced: `scripts/check_shape.py` fails when a Python function and a
   JavaScript export share a name.

4. **Every API path is a noun with standard verbs.** `GET` reads, `PUT`
   replaces, `POST` appends; conflict detection is `If-Match`, never a custom
   header or a verb in the path, so the server is a set of resources a second
   client could use. Enforced: `scripts/check_shape.py` fails on a verb in any
   `/api/` path segment.

5. **Every PBQ ships a reference answer that scores full marks.** A PBQ whose
   own solution cannot satisfy its own requirements is broken, and this is
   easy to write and hard to see. Enforced: `selftest.html` runs every
   reference answer through the real grader and fails under 100%.

6. **Every distractor names an existing misconception.** The wrong answer is
   the teaching surface; an option without a misconception teaches nothing,
   and a dangling id makes the mentor silently drop the correction. Enforced:
   `scripts/validate_content.py` errors on either, and on a misconception
   fewer than two distinct items can retire.

7. **State is never colour alone, and nothing decorative survives.** The
   interface is read for a hundred hours by someone who may not see colour;
   every state carries a glyph or a border change, and a 1px border on a solid
   panel replaces every shadow, gradient and blur. Enforced:
   `scripts/check_materials.py` fails on box-shadow, gradients,
   backdrop-filter and any colour literal outside the token blocks;
   `selftest.html` fails on inline styling in a template; `scripts/selftest.py`
   reads Chrome's accessibility tree and fails on any control under main
   without a name, on focus lost across a render, and on a state change that
   is not announced. Manual: the glyph rule itself, checked against
   `.claude/skills/study-ui/SKILL.md` before a screen ships.

8. **Every number in the README comes from a script.** A count written by
   hand is wrong within a week. Enforced: `scripts/check_docs.py` regenerates
   the counts from the content and fails if the committed README differs.

9. **No network request on page load that this origin does not serve.** The
   tool must work offline and must not tell a third party when you study.
   Enforced: `scripts/check_shape.py` fails on an off-origin `<link>` or
   `<script>` in `index.html`.

10. **The state document never grows per answer.** It holds what you know,
    keyed by item and misconception, so it grows with the bank; anything per
    answer is a row in the review log, its own resource, or the document
    outgrows every transport that has to carry it, which it did once.
    Enforced: `scripts/check_state_shape.py` fails on a `reviews` key in
    `DEFAULT_STATE` and on any push into the state not marked bounded.
