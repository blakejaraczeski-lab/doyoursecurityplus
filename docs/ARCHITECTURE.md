# Architecture

Working name: **doyoursecurityplus**. A Security+ SY0-701 drill portal that is
self-targeting: it does not just repeat cards you missed, it diagnoses *why* you
missed them and drills the misconception until it is gone.

## The core idea: schedule misconceptions, not cards

Anki schedules a card. A card you fail keeps coming back in the same shape, so
you eventually memorise the card rather than the concept. This build inverts it.

Every distractor in every item carries a `misconceptionId`. When you pick it, the
system does not record "missed item 412", it records "confused WPA3-SAE with
WPA3-Enterprise". That misconception becomes the scheduled object, and it can be
retired by any item that discriminates the same pair, not only the one you failed.

```
answer wrong
   -> distractor -> misconceptionId
      -> mentor card generated (bank it)
      -> misconception enters FSRS queue
         -> next review pulls a DIFFERENT item testing the same discrimination
            -> two clean passes on distinct items = misconception retired
```

That is the "self actualizing" property: the bank re-aims at your specific error
pattern instead of at the question you happened to see.

## Data model

```
Objective (28)  ->  Topic (682)  ->  Item (MCQ | PBQ)
                         ^                 |
                         |            Distractor -> Misconception -> MentorCard
                         +---------------------------------------------+
```

- **Item**: `{ id, type, objective, topics[], difficulty (1-5), stem, ... }`
- **MCQ options**: each wrong option is `{ text, misconceptionId, why }` where
  `why` is written as a correction of that exact error, not a restatement of the
  right answer.
- **Misconception**: `{ id, label, confusedPair, mentor: { diagnosis, contrast,
  ruleOfThumb, tell, relatedItems[] } }`. This is the training mentor guide.
- **MentorCard**: banked instance of a misconception for one user, with FSRS
  state, first-seen item, and the streak needed to retire it.

## PBQ engine

One shared harness, pluggable graders. Each PBQ declares subtasks; each subtask
scores independently so partial credit is real, and each subtask has its own
misconception mapping so a half-right PBQ still generates precise remediation.

Planned PBQ kinds for v1, matching what the exam actually uses:

| Kind | Interaction | Grader |
|---|---|---|
| `acl-table` | Add/order/edit firewall rules (src, dst, port, proto, action) | Simulates traffic against your rule set, checks each required flow permitted/denied, penalises overly broad rules and wrong ordering |
| `wireless-config` | AP settings panel: mode, SAE vs Enterprise, EAP type, RADIUS, band, SSID broadcast, PSK | Per-field, with dependency checks (Enterprise requires RADIUS + EAP) |
| `network-diagram` | Clickable topology, inspect host evidence, apply containment actions | Checks identification, correct action, correct order (contain before eradicate) |
| `log-analysis` | Scrollable log pane + dropdown answers | Per-dropdown, plus "what is the attack" and "what is the fix" |
| `drag-categorise` | Drag items into buckets or into ordered sequence | Per-placement |
| `cert-inspect` | Certificate viewer, identify the defect, pick the remediation | Per-field |
| `protocol-match` | Insecure protocol to secure replacement plus port | Per-pair |

## Study modes

1. **Drill** (default): adaptive queue blending due misconceptions, due items,
   and new coverage, biased by domain exam weight.
2. **Weak spot blitz**: top N weakest objectives only.
3. **PBQ lab**: PBQs only, timed to an 8 minute per-PBQ target.
4. **Mock exam**: up to 90 items, 90 minutes, 4 to 5 PBQs front loaded, flag and
   return, scaled 100 to 900 estimate at the end with a pass/fail line at 750.
5. **Mentor bank**: browse and review every banked correction.

## Readiness projection

Per-objective mastery from FSRS retrievability, rolled up with domain weights and
item difficulty into a projected scaled score with a confidence band. Shown as a
28 cell heatmap so it is obvious which objective is dragging the projection down.
The projection deliberately reports a band, not a single number, because a small
sample over a 100 to 900 scale cannot support false precision.

Two denominators matter here and they are kept apart on purpose:

- **Coverage** is `itemsSeen / min(itemsAvailable, 12)`. Twelve is the sample
  worth having; an objective that cannot supply twelve is scored out of what it
  has. This measures you.
- **Bank depth** is the share of an objective's blueprint topics that any graded
  item reaches. This measures the content, and it is reported separately as a
  "thin" flag rather than folded into mastery.

Mixing them is what the earlier flat `itemsSeen / 12` did, which reported a thin
bank as a weak learner. Mastery counts graded practice only: a recall card is
revealed and self-graded, so letting it in would mean "I knew that" could raise a
number meant to predict a scored exam.

## Stack

No build step, no dependencies. Plain ES modules and JSON served by a single
Python file. Node is not installed on this machine and was not worth adding: the
same shape also drops into an Artifact later without porting, since Artifacts
want exactly this.

```
index.html          app shell
selftest.html       regression harness, runs the real graders
styles.css          design system (tokens, measure, non-colour state)
serve.py            static server + durable state API
app/
  main.js           shell, routing, event wiring, recording
  state.js          fast tier (localStorage), streaks, migration
  sync.js           durable tier mirror, conflict handling
  fsrs.js           FSRS v5 scheduler
  mentor.js         misconception engine, relearning steps
  scheduler.js      queue building, coverage bias, readiness
  grade/            one grader per PBQ kind
  ui/               views, PBQ renderers, shared render helpers
```

## Persistence: two tiers

The misconception bank is the whole value of the tool, so losing it is the
failure mode that matters.

- **Fast tier**: `localStorage`. Synchronous, survives the server being down.
  Keyed to an origin, which is exactly why it cannot be the only tier: change
  the port and it is gone.
- **Durable tier**: `~/.doyoursecurityplus/state.json`, written by `serve.py` a
  second or two behind, every write also snapshotted (last 40 kept).

Reconciliation happens once, at start-up: newer `updatedAt` wins. During a
session the browser is authoritative because it is the only writer. The server
returns 409 rather than accepting a write that would discard something newer,
and the UI surfaces that instead of silently picking a side.

`scripts/service.sh install` puts the server under launchd so it starts at login
and restarts if it exits. That keeps the port fixed, which keeps the browser
origin stable, which is what makes the fast tier survive too.

## Content pipeline

`content/` is the source of truth and is stack independent.

```
content/
  objectives.json        # taxonomy: 5 domains, 28 objectives, 682 topics  [DONE]
  items/<domain>.json    # MCQ bank, tagged to objective + topics
  pbq/<id>.json          # PBQ definitions with subtasks and graders
  mentor/<id>.json       # misconception -> mentor guide
schemas/                 # JSON Schema for all three, validated in CI
scripts/
  build_objectives.py    # regenerates the taxonomy                        [DONE]
  validate_content.py    # schema + coverage + orphan misconception check
  coverage_report.py     # topics with zero items, weighted by domain
```

Coverage gate: no objective ships with zero items, and domain item counts track
the exam weights within a tolerance.
