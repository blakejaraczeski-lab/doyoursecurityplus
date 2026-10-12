# doyoursecurityplus

A CompTIA Security+ SY0-701 drill portal that retargets itself at your specific
errors. Not a flashcard deck with a Security+ skin.

```bash
python3 serve.py                # run it now, on http://localhost:8777
./scripts/service.sh install    # or run it always, from login onward
```

No build step, no npm, no dependencies. Plain ES modules and JSON, served by
one Python file.

## The idea

Anki schedules a card. Fail it and the same card returns, so you eventually
memorise the card rather than the concept. This schedules the **misconception**.

Every wrong answer option in the bank is labelled with the specific wrong belief
that leads to it. Pick it, and the app records "confused WPA3-SAE with
WPA3-Enterprise", not "missed question 412". That belief is banked with a
targeted correction, and when it comes due the queue serves **a different
question** that tests the same distinction. Two clean passes on two different
questions retires it. You cannot retire a misconception by memorising the
question that exposed it.

```
wrong answer -> distractor names the misconception
             -> mentor correction shown immediately, and banked
             -> comes back in ~8 minutes, on a DIFFERENT question
             -> 2 clean passes on distinct questions = retired
```

When you keep missing it, the response escalates rather than repeating:

| Miss | What happens |
|---|---|
| 1st | The full correction: diagnosis, contrast table, rule of thumb |
| 2nd | Same card, flagged as a repeat, leading with the rule |
| 3rd+ | It stops explaining. A **contrast drill**: two questions on the same distinction whose correct answers differ |

Three more things the mentor watches. Mark a question as a guess (`G`) and a
right answer is scored but never counts toward clearing anything, while a
confident miss escalates faster than an admitted one. A wrong answer in under
six seconds on a hard question is flagged as rushed. And 43 authored
prerequisite edges let the queue route **backward**: when a correction sits on
top of one that is still open, you get the one underneath first, and the card
says why.

The mentor is a lookup table keyed to the wrong belief, plus a scheduler. It
writes nothing on the fly. Every correction was written in advance and
reviewed, because an exam tool that invents security explanations would be
confidently wrong some of the time, with no way to tell which time.

## What is in here

| | |
|---|---|
| Objectives | 5 domains, 28 objectives, 684 sub-topics from CompTIA's official objectives document, every one covered by at least one graded item |
| Misconceptions | 176, each with diagnosis, contrast table, rule of thumb, what to look for in the stem, and why the wrong answer looked right |
| Multiple choice | 449 original items, every distractor mapped to a misconception |
| Multiple select | 37 "choose two/three" items, scored all or nothing like the exam |
| Derived discrimination | 82 generated from imported vocabulary: "which term is being described", with sibling terms as distractors |
| Recall vocabulary | 546 imported cards, capped at about 12% of a session |
| PBQs | 21 across four engines, graded per subtask with partial credit |
| Glossary | CompTIA's own acronym list, expanded inline wherever one appears in a question |

## The PBQ engines

**`acl-table`** executes your rule set: synthetic packets go through it top to
bottom, first match wins, implicit deny at the end. It catches the rule set
that works but is too broad, the rule shadowed by a broader one above it, and
the service port on the wrong side. The policy is also printed as plain text
under the grid, the way a device would show it.

**`wireless-config`** grades each field on its own, with dependency awareness:
choosing Personal mode makes the RADIUS fields unreachable rather than wrong.

**`network-diagram`** is a clickable topology with per-host evidence. Clicking
a host reads its evidence; marking it compromised is a separate act. Every one
mixes compromised hosts with hosts that merely show the effects, and a wrong
host costs half what a right one earns.

**`drag-order`** is click to place, not HTML5 drag: it works with a keyboard
and on touch, and positions fill in any order. Sequences score per position and
also report how many consecutive pairs held.

Twenty-one is deliberate and it stops there. A PBQ earns its place when it
trains an operation multiple choice cannot: building a rule set and reading it
back, ordering steps where the order is the answer, gathering evidence before
deciding. Where the discrimination is "which term is this", a PBQ is a slower
multiple choice question.

## Study modes

- **Drill** blends due corrections, items due for review, and new coverage
  weighted toward whichever domain is furthest under its exam weight.
- **Weak spots** serves only banked corrections that are due.
- **PBQ lab** runs the performance-based questions against an 8 minute target.
- **Mock exam** is format faithful: PBQs first, no feedback until you submit, a
  clock that does not stop, flag and review, and a scaled 100 to 900 estimate.
- **Mentor bank** is every correction you have collected, with its progress.
- **Readiness** projects a scaled score band against the 750 pass line, with a
  per-objective heatmap, confidence calibration, and domain balance.

## Where your progress lives

The misconception bank is the value of the tool, so it is kept in two tiers.
`localStorage` is the fast tier. `~/.doyoursecurityplus/state.json` is the
durable tier, written by the server a second or two behind, with the last 40
writes kept as timestamped snapshots. On start-up the newer copy wins; the
server refuses a write that would overwrite newer work and says so in the
sidebar. Settings shows the file path and what is on disk.

Open the app with `?scratch=1` to test it without touching your progress: a
separate key, no server writes, and a banner saying so.

`./scripts/service.sh install` runs the server under launchd so the port, and
therefore the browser origin, never changes. `--remind 18:30` adds a daily
notification that reads the state file and stays quiet once you have hit your
goal.

## Pacing

FSRS (stability, difficulty, retrievability) with short relearning steps on
top, so a correction you made 30 seconds ago does not wait a day. **Set your
exam date in Settings.** No review is ever scheduled past it; as the date
approaches every interval compresses to fit. Pace profiles: `bootcamp`
(default), `balanced`, `longhaul`.

## Your own materials

`content/index/` holds page indexes for study guides you own: section titles
and page numbers only, nothing copied. A mentor card points at the page in the
book already on your shelf. Build one with `scripts/build_reference_index.py`.

## Adding content

Items and misconceptions live in one file per objective (`content/items/4.1.json`,
`content/mentor/4.1.json`); PBQs are one file each under `content/pbq`. The
server lists the directory, so there is nothing to register. After an edit:

```bash
python3 scripts/format_content.py && python3 scripts/validate_content.py
```

and open http://localhost:8777/selftest.html. The validator checks structure:
every distractor names a misconception that exists, every PBQ's reference
answer satisfies its own requirements, every misconception has enough distinct
items to be retired, and blueprint coverage per objective. The self test runs
every PBQ's reference answer through the real graders and exercises the
misconception loop end to end. Run both. The schema is in
`docs/CONTENT-SCHEMA.md`.

```
scripts/
  build_objectives.py        regenerate the taxonomy from the official objectives
  build_glossary.py          regenerate the acronym glossary from the same document
  format_content.py          one canonical shape for every item and mentor file
  validate_content.py        structure, integrity, reference answers, coverage
  derive_mcq.py              recall cards -> discrimination questions
  import_anki.py             .apkg -> tagged recall items
  build_reference_index.py   study guide PDF -> page index (titles only)
  service.sh                 launchd install, status, logs, reminder
```

## Content integrity

Every item is original, written against the published objective. Nothing is
transcribed from a live exam or a commercial question bank; CompTIA treats
verbatim exam content as grounds for revoking a certification, and a bank built
that way would teach the questions rather than the material. `reference/` holds
CompTIA's own objectives document, free and public, kept for personal study and
not for redistribution.

## Known gaps

- Depth, not breadth. Every topic is touched; the thinnest objectives by item
  count are 2.2 (7 graded units over 28 topics) and 1.1 (8 over 10).
- The bank leans over on domain 4 and under on domain 2. Mocks draw by exam
  weight regardless, and the drill routes by what you have seen, so little of
  this reaches you.
- Scaled scores are an estimate. CompTIA's weighting model is confidential.
- The imported deck is third-party and its definitions have never been
  reviewed. Treat derived questions as drilling, your own notes as the authority.

The reasoning behind the less obvious choices, and the bugs that forced them,
is in `docs/DECISIONS.md`.
