# doyoursecurityplus

A CompTIA Security+ SY0-701 drill portal that retargets itself at your specific
errors. Not a flashcard deck with a Security+ skin.

```bash
./serve.sh                      # run it now
./scripts/service.sh install    # or run it always, from login onward
```

Then open http://localhost:8777. No build step, no npm, no dependencies. Plain
ES modules and JSON, served by Python.

## The idea

Anki schedules a card. Fail it and the same card returns, so you eventually
memorise the card rather than the concept.

This schedules the **misconception**.

Every wrong answer option in the bank is labelled with the specific wrong belief
that leads to it. Pick it, and the app does not record "missed question 412", it
records "confused WPA3-SAE with WPA3-Enterprise". That belief is banked with a
targeted correction, and when it comes due the queue serves **a different
question** that tests the same distinction. Two clean passes on two different
questions retires it.

You cannot retire a misconception by memorising the question that exposed it.

```
wrong answer -> distractor names the misconception
             -> mentor correction shown immediately, and banked
             -> comes back in ~8 minutes, on a DIFFERENT question
             -> 2 clean passes on distinct questions = retired
```

## What the mentor does when you keep missing it

A correction you have already read twice is not going to work on the third
reading. So the response escalates rather than repeating:

| Miss | What happens |
|---|---|
| 1st | The full correction: diagnosis, contrast table, rule of thumb |
| 2nd | Same card, flagged as a repeat, leading with the rule. The prose is demoted because it already failed once |
| 3rd+ | **It stops explaining.** The queue serves a *contrast drill*: two questions testing the same distinction whose correct answers are opposite |

The contrast drill is the part that matters. If every WPA3 question you have seen
had "Enterprise" as the answer, you have learned to pick Enterprise, not to tell
the modes apart. Serving a pair back to back where the right answer flips makes
that impossible. The pair is found automatically by grouping the items for a
misconception by their correct answer and taking one from each group, and the
queue shuffles everything else around them while keeping the pair adjacent.

It also watches **how fast** you answer. A wrong answer in under six seconds on a
question of real difficulty is flagged as rushed, because at that speed you
pattern matched the options instead of reading the stem, and that is a different
problem from not knowing the material. The end of session debrief names the
pattern: which objective your misses clustered in, how many were rushed, and
whether you are closing gaps faster than you are finding them.

**What it is not.** The mentor is a lookup table keyed to the specific wrong
belief, plus a scheduler that decides what to show and when. It does not write
new explanations and you cannot ask it a follow up question. Every word in a
correction was written in advance and reviewed, which is deliberate: an exam prep
tool that invents security explanations on the fly would be confidently wrong
some of the time, and you would have no way to tell which time.

## What is in here

| | |
|---|---|
| Objectives | All 5 domains, 28 objectives, 684 tagged sub-topics, from CompTIA's official objectives document |
| Misconceptions | 108, each with a full mentor guide: diagnosis, side by side contrast table, rule of thumb, what to look for in the stem, and why the wrong answer looked right |
| Multiple choice | 211 original items, every distractor mapped to a misconception |
| Multiple select | 12 "choose two/three" items, scored all or nothing like the exam |
| Acronym recognition | 315, generated from CompTIA's own acronym list |
| Derived discrimination | 82, generated from the imported vocabulary (see below) |
| Recall vocabulary | 546 remaining after 82 were superseded, capped at ~12% of any session |
| PBQs | 15, across four engines, graded per subtask with real partial credit |

## The PBQ engines

Three interactive engines, matching the formats that actually appear on SY0-701.

**`acl-table`** is not marked against a model answer. Your rule set is
**executed**: synthetic packets are pushed through it top to bottom, first match
wins, implicit deny at the end. So it catches the rule set that works but is far
too broad, the rule shadowed by a broader rule above it, and the service port
written on the wrong side. Ten traffic tests plus four structural checks.

**`wireless-config`** grades each field independently, with dependency awareness:
choosing Personal mode makes the RADIUS fields unreachable rather than silently
wrong, so one bad decision does not cascade into losing everything.

**`drag-order`** covers the two formats the exam uses after configuration tasks:
putting steps in order, and sorting items into buckets. It is **click to place**,
not HTML5 drag: click the item, then click the position it belongs in. Same
cognitive task, and it works with a keyboard, on a touch screen, and for anyone
who cannot hold a drag steady. Positions fill in **any order**, so you can
commit the step you are sure is last before working out the middle. Sequences
score per position and also report how many consecutive pairs held, because
getting the whole chain one slot out is a different mistake from shuffling it.

**Domains 2 and 3 carry 40% of the exam** and used to have no PBQ at all, while
domain 4 carried thirteen. They now have five between them: threat vector
families and authentication indicators in domain 2, shared responsibility, a
jump server rule set and data protection methods in domain 3.

**`network-diagram`** gives you a clickable topology with per host evidence, then
asks you to identify what is actually compromised, what to do first, and how to
handle it. Every one of these deliberately mixes compromised hosts with hosts
that merely show the effects: the file server whose data was encrypted over SMB
by a valid account was never compromised, and rebuilding it is wasted work. Host
selection gets partial credit; a wrong host costs half what a right one earns.

**Inspecting a host is not accusing it.** Clicking a host opens its evidence and
nothing else; naming it compromised is a separate control, either in the
evidence panel or from the host list under the question. These used to be the
same click, which meant you could not read a machine's logs without marking it,
and reading them twice cleared the mark. Gather first, decide after, which is
the whole point of the question.

### Reading your own work

The ACL grid is seven controls per row across eight rows, and native selects
truncate their own labels: at the widths those columns were getting, PERMIT
rendered in 50px of a box that needed 80, and five of the six controls in every
row were cut. You could not read the rule you had just written, let alone scan
eight of them for order, on a question whose entire task is evaluating a policy
top to bottom. Column widths are now measured from the widest option each one
can hold, and the policy is **also rendered as plain text** underneath, the way
it would print on a real device.

The requirements list stays pinned while you work. With a full rule set the span
from the first requirement to the last rule is around 1300px in a 768px
viewport, so the rules you are trying to satisfy were never on screen with the
grid you satisfy them in. It collapses to one line when you want the room.

### The twelve

| Engine | PBQs |
|---|---|
| `acl-table` | screened subnet, clinical segmentation with a quarantine ordering trap, perimeter egress filtering, and a **stateless** ICS filter where you must write both directions |
| `wireless-config` | corporate branch, guest site with no servers, a retail store running three SSIDs at once, and a site where legacy devices cannot be upgraded |
| `network-diagram` | worm outbreak, quiet intrusion and exfiltration, ransomware with a backup that was not one, and compromise arriving through a managed service provider |
| `drag-order` | incident response phases in order, order of volatility, and classifying ten controls by type |

Two pairs are deliberately built to invert each other. The retail PBQ asks for
the EAP method twice and the correct answers differ, because the constraints
differ. The ICS PBQ is stateless, so the return traffic rules that are an
unwanted opening on every other PBQ are mandatory on that one.

## Why there are almost no flashcards left

The SY0-701 exam is **multiple choice, single and multiple select, plus PBQs.
There is no free-text question. You never type a definition.** CompTIA's own
objectives document lists exactly two question types.

That makes a term/definition flashcard the wrong shape twice over:

1. It trains **recognition**, not **discrimination**. The exam never asks "what
   is a warm site". It offers you hot, warm and cold and makes you separate them.
2. **Self-grading invites the fluency illusion.** You reveal the answer, it feels
   familiar, you press Good, and you have measured nothing. Recognising a
   definition is far easier than producing the term against three plausible
   neighbours, so a deck of flashcards systematically overstates readiness.

So `scripts/derive_mcq.py` keeps the vocabulary and changes the operation. Each
imported card becomes a four-option question whose distractors are the **sibling
terms most likely to be confused with it**, drawn from the same objective and
ranked by how similar their definitions are:

> Which term is being described?
> "A fully configured alternate processing site that can be brought online either
> instantly or very quickly after a disaster"
> &nbsp;&nbsp;a) Continuity of Operations  b) **Hot Site**  c) Replication  d) Cold Site

Pick wrong and you are told precisely what you did pick: *"That is Cold Site: a
predetermined alternate location where a network can be rebuilt..."*. That is the
correction that matters, and it is the discrimination the exam actually tests.

**The objective is taken from the blueprint, never inferred.** The auto-tagger
scores word overlap, and it was wrong often enough to matter: it filed "Race
Condition" under security awareness and "Governance Committee" under change
management. A fuzzy lookup against the official list is no better, because
matching a single shared word sends "Public Key" to data classification (3.3
contains the word "Public"). So derivation now requires an **exact match against
a term CompTIA's own objectives document names** — whole label or whole acronym,
plural-insensitive, nothing fuzzier. A term the blueprint does not name is not on
this exam and does not become a question: 332 cards were rejected on that rule
and 44 were re-tagged to the objective the blueprint actually places them under.

Two further quality rules keep these honest. A distractor's definition must not be
nearly identical to the answer's, or the question would have two defensible
answers. And **at least one distractor must be a genuine near-neighbour**: the
imported deck was auto-tagged, so an objective's pool can hold unrelated terms,
and offering "Custodian" against "Perfect Forward Secrecy" is a free mark rather
than a discrimination. 164 candidates were rejected outright for having no
plausible neighbour to offer. That is the right trade: fewer questions, none of
them free.

When you miss one, the mentor card builds its contrast table **from the pairs you
actually confused**, with definitions in full. An earlier version showed a fixed
table of every term in the objective, truncated to fit. It was noise under a
heading that promised to separate things, so it is gone.

A recall card whose term has been derived is **superseded** and never served
again. What is left is capped at roughly 12% of a session by the pace profile,
because vocabulary still has to get in the door once, it just should not be the
bulk of your practice. Rerun the derivation any time:

```bash
python3 scripts/derive_mcq.py && python3 scripts/build_manifest.py
```

## Interface

The screens are built around a few deliberate choices, not decoration.

The standards are written down in `.claude/skills/study-ui/SKILL.md`, so the bar
holds across sessions rather than depending on whoever last touched a stylesheet.

- **IBM Plex Sans and IBM Plex Mono**, not a system stack and not Inter. Mono
  carries everything that is data: addresses, ports, log lines, scores. The app
  is full of those and they should not be set in the prose face.
- **Warm paper, not dashboard grey.** Light mode is a warm off-white with near
  black ink; dark is a warm near-black. The accent is plum. Every body-text pair
  in both themes is gated at 4.5:1 and the check is in the skill.
- **Focus mode.** While a question is in front of you the sidebar dims to 45%
  and returns on hover or focus, the column narrows to reading width, and the
  stem steps up a size. Nothing competes with the question.
- **Reading measure is capped near 68 characters.** Mentor cards are the one
  thing here you have to read rather than scan, and past roughly 75 characters
  the eye starts losing the line on the return sweep.
- **The rule of thumb is visually isolated** in its own block, separate from the
  explanation around it. It is the single sentence you need to retrieve under
  exam pressure, and isolated items are recalled far better than the same words
  inside a paragraph.
- **Nothing is signalled by colour alone.** Correct and incorrect carry a glyph
  and a border weight change as well as a colour, so the page still works with
  colour vision deficiency.
- **Answer options are full width and at least 56px tall.** It is the control
  you hit hundreds of times a session, so it is the one worth making large.
- **A, B, C, D answer, Enter continues, 1-4 grade a recall card, Space reveals.**
  The shortcuts are shown on screen rather than left to be discovered.
- **The sidebar is a daily dashboard**: reviews against your goal, streak, days
  to the exam, corrections due now, and whether your progress is saved to disk.
- **PBQs carry a pacing timer** against their target, because the real constraint
  on exam day is eight minutes each, not whether you could eventually get there.

## Prerequisite repair

Three misses that look unrelated often share one broken thing underneath. The
bank carries **43 authored prerequisite edges** between misconceptions, and the
rule for adding one is strict: a real dependency is where the downstream
reasoning is *impossible* without the upstream fact, not merely where the topics
sit near each other.

> `acl-rule-order` requires `acl-implicit-deny` — ordering only matters once you
> know evaluation stops at the first match. Without that, "specific before
> general" is an arbitrary rule to memorise.

When a correction comes due and a dependency beneath it is still open, the queue
**routes backward**: it serves the dependency instead and says why. The mentor
card for a blocked concept names what is holding it up, so you are not left
wondering why that one keeps slipping. The validator rejects unknown ids,
self-edges, edges with no stated rationale, and any cycle.

## Confidence calibration

Before answering you can mark a question as a guess (`G`). It costs one keystroke
and it splits right-and-wrong into four states that mean very different things:

| | Right | Wrong |
|---|---|---|
| **Sure** | Secure | **Dangerous.** You will not look this up, because you do not know you are wrong. Escalates faster and comes back sooner |
| **Guess** | **Fragile.** Scored correct, and it does not count toward clearing anything | Honest gap, the cheapest kind to fix |

A guessed right answer gets a shorter interval than a confident one and never
counts as a clean pass toward retiring a misconception. Two confident misses
escalate to a contrast drill as fast as three hesitant ones. Readiness shows the
four quadrants and your overconfidence rate, which is the number that should
fall fastest as you get ready.

## Study modes

- **Drill** blends due misconceptions, due items and new coverage, biased toward
  whichever domain is furthest below its exam weight.
- **Weak spots** serves only banked misconceptions that are due.
- **PBQ lab** runs the performance-based questions against an 8 minute target.
- **Mentor bank** is every correction you have collected, with its retirement
  progress.
- **Readiness** projects a scaled score band against the 750 pass line, with a
  28 cell per objective heatmap.

## Where your progress actually lives

This matters more than it sounds, because the misconception bank **is** the
value of the tool, and eleven weeks of it is not something you want to lose.

`localStorage` alone would not have been storage, it would have been a cache. It
is keyed to an origin, so changing the port loses everything; clearing site data
loses everything; a different browser never had it.

So there are two tiers:

| Tier | What it is | Why |
|---|---|---|
| Fast | `localStorage` in the browser | Synchronous reads and writes, works with the server down |
| Durable | `~/.doyoursecurityplus/state.json` | A real file, written by the study server a second or two behind |

Every durable write also lands in a timestamped snapshot, and the last 40 are
kept. A bad import, or a reset you regret, is recoverable from that directory.

On start-up the app compares the two copies by timestamp and takes the newer
one. The server refuses a write that would overwrite something newer, which only
happens if two browsers were both studying, and says so in the sidebar rather
than silently picking a winner. Settings shows you the file path, the snapshot
count and what is on disk right now.

Verified behaviour: clear site data completely, reload, and your reviews,
banked corrections and streak all come back.

## Testing the app without writing to your progress

Open it with `?scratch=1` and the session keeps its progress under a separate
browser key and never talks to the server. A banner says so.

This exists because driving the real app to test it writes real reviews into
real study data. One round of UI testing added **eleven fabricated correct
answers** and retired **four misconceptions that had never been demonstrated**,
which the scheduler then believed. It was recovered from a snapshot, which is
the other reason the server keeps forty of them.

If it happens again: stop the app in **every** tab first, because a tab holding
stale state in memory will push it back the moment it is hidden, then restore
the newest snapshot from before the damage with a forced `PUT /api/state`.

## Running it as a background service

```bash
./scripts/service.sh install                  # start at login, restart if it exits
./scripts/service.sh install --remind 18:30   # and nudge you daily at 18:30
./scripts/service.sh status
./scripts/service.sh logs
./scripts/service.sh uninstall                # leaves your study data alone
```

This installs a macOS LaunchAgent. launchd rather than a container, deliberately:
it is native, needs nothing installed, starts at login without a daemon of its
own, and restarts the server if it dies. A container would add a dependency for
what is one Python file serving one directory.

The point is not convenience. It is that the port stays fixed, so the browser
origin stays stable, and the durable file is always being written. The reminder
reads the state file directly, so it knows how many corrections are due and how
many reviews you have done today, and stays quiet once you have hit your goal.

## Pacing

The scheduler is FSRS (stability, difficulty, retrievability) with short
relearning steps layered on top, because a correction you made 30 seconds ago
should not wait a day.

Set your exam date in Settings. **No review is ever scheduled past it.** As the
date approaches every interval compresses to fit inside the time you have left.

Pace profiles: `bootcamp` (default, 92% target retention, 8 minute first step),
`balanced`, `longhaul`.

## Your own materials

`content/index/` holds page indexes for study guides you own, built by
`scripts/build_reference_index.py`. **Section titles and page numbers only, no
content copied.** When a mentor card appears, it tells you where to read more in
the books already on your shelf:

> In your own materials: Professor Messer's SY0-701 Course Notes: Securing
> Wireless and Mobile, p.60

## Adding content

```bash
python3 scripts/validate_content.py      # after ANY content edit
python3 scripts/build_manifest.py        # after adding a content file
```

Then open **http://localhost:8777/selftest.html**, which runs every PBQ's own
reference answer through the real graders and checks it scores full marks, plus
the misconception loop end to end. The Python validator checks structure; the
self test checks the code path you actually study through. Run both.

The validator enforces the rules in `docs/CONTENT-SCHEMA.md`. Two checks matter
most:

1. **Every distractor must name a misconception that exists.** A distractor
   without one is wasted teaching surface, and a dangling reference means the
   mentor engine silently drops the correction.
2. **Every PBQ's own reference answer must score full marks.** This catches
   requirements that cannot all be satisfied at once, which is easy to write and
   very hard to spot by reading.

It also reports which misconceptions cannot yet be retired because fewer than two
distinct items test them. That number should stay at zero.

```
scripts/
  build_objectives.py        regenerate the taxonomy from the official objectives
  build_manifest.py          tell the app which content files exist
  validate_content.py        schema, integrity, reference answers, coverage
  import_anki.py             .apkg -> tagged recall items
  build_reference_index.py   study guide PDF -> page index (titles only)
  build_messer_index.py      same, for Messer's course notes layout
```

## Content integrity

Every item is original, written against the published objective. Nothing is
transcribed from a live exam or from a commercial question bank. CompTIA treats
verbatim exam content as grounds for revoking a certification, and a bank built
that way would teach you the questions rather than the material.

`reference/` holds CompTIA's own objectives document, which is free and public.
It is a personal study reference and is not for redistribution.

## Coverage, which is not the same as balance

Domain percentage is a **ratio**, and ratios are blind to size. For a long time
this bank reported all five domains "within tolerance" while three objectives
had **no items at all**: 4.7 automation, 4.4 alerting and monitoring, 4.2 asset
management. Domain 4 read 25.3% against a 28% weight and looked healthy.

So the validator now reports coverage in absolute terms as well:

```
blueprint coverage: 383/684 topics touched (56%); 301 with none
  thin objectives (5): topics covered / total, items
    1.3    5/ 18   28%   2 items
    ...
```

**An objective with zero graded items is an error, not a warning.** Thin
objectives (under 35% of their topics, or fewer than 4 items) are listed every
run so the holes stay visible rather than averaging away.

### The same mistake was inside the readiness score

Finding it in the validator was not the end of it. `readiness()` measured how
much of an objective you had covered as `itemsSeen / 12`, a constant denominator
over objectives that hold anywhere from 2 to 32 items. An objective with 2 items
was capped at coverage 0.17 however well you answered them, so **18 of 28
objectives could never reach full coverage and 11 could never read "strong" on a
flawless record**. Objective 1.3 read "shaky" at 0.58 with every question right.

The grid was telling you to go study objectives that had nothing in them.

The denominator is now what the objective can actually offer, so a perfect record
reads as a perfect record. The shortfall did not disappear, it moved to where it
belongs: each objective reports **bank depth**, the share of its blueprint topics
any graded item reaches, and is marked **thin** when that falls under 35%. A thin
objective can read "strong" and say so plainly, meaning you answered its items
correctly, not that the topic is covered. The uncertainty band widens with the
shortfall instead of the point estimate absorbing it.

`coverageDeficit()` had the same shape one level down, and two bugs of its own:
a revealed vocabulary card counted toward a domain exactly like a scenario
question, and a domain with nothing unseen left kept reporting a deficit the
queue could not spend. Only graded practice counts now, and an exhausted domain
says so.

`content/coverage.json` is written by the Python validator and checked against
the JavaScript implementation by `selftest.html`. The two are written
independently, so if either drifts the self test fails. That pin exists because
a flat denominator survived in plain sight for weeks.

## Domain balance

`validate_content.py` also reports balance against the real exam weights,
and it counts **graded practice separately from imported recall vocabulary**.
That distinction matters: the 628 tagged Anki items build recognition, they do
not test discrimination, and letting them into the balance figure hides what the
MCQ and PBQ bank actually covers. All five domains currently sit within tolerance
of their exam weight on graded practice.

## Known gaps

- **Coverage is 69% of the blueprint.** 213 topics still have no graded item, so
  breadth remains the limiting factor. **No objective is thin any more**: every
  one reaches at least 35% of its topics and holds at least four graded units.
  Readiness marks a thin objective as thin rather than quietly scoring it as a
  weakness in you, and `content/coverage.json` pins the figure so the app and
  the validator cannot drift apart about it. Weakest remaining by topic
  coverage: 1.4 cryptographic solutions, 4.5 enterprise capabilities,
  4.9 investigation data sources, 4.1 secure baselines, 1.2 fundamental concepts.
- **Domain 4 sits over its exam weight in the bank**, at 33% against 28%, which
  is the direct cost of filling 4.3 and 4.6. It does not change what you are
  served: mock exams draw per domain by exam weight regardless of how the bank
  is composed, and the drill queue routes new items by how much of each domain
  you have actually seen. Adding filler elsewhere to move the ratio would be the
  exact mistake this project already made once.
- **Mock exams draw only from plain `mcq` items.** Multiple select and the
  derived discrimination questions are excluded, so a mock is narrower than the
  real thing. The drill queue serves all of them.
- Scaled scores here are an estimate. CompTIA's weighting model is confidential,
  so difficulty weighting is an approximation, not a reconstruction of it.
- The imported deck is third-party and its definitions have never been reviewed
  by anyone. Gating on the official vocabulary removes the off-syllabus material
  and fixes placement; it does **not** verify that a definition is correct. Treat
  derived questions as drilling, and your own notes as the authority.
- 15 PBQs across four engines. Enough to drill every format without
  memorising them. More drop straight in as JSON, and both the validator and the
  self test check each one's reference answer scores full marks.
- The imported recall bank is skewed toward domain 3 and thin on domain 5. It is
  vocabulary, so this matters much less than the graded balance, but a domain 5
  recall pass would help.
- Progress lives in this browser's localStorage. Export it from Settings before
  clearing site data.
