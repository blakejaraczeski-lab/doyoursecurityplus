# Decisions

The reasoning behind choices that are not obvious from the code, and the
failures that forced them. The code comments carry the rule; this carries the
story. Newest at the bottom.

## Progress lives in two tiers

`localStorage` is keyed to an origin. Change the port and the history is gone;
clear site data and it is gone; open a different browser and it never existed.
For a bank of misconceptions built over weeks that is a cache, not storage. So
the browser keeps the fast copy and `serve.py` keeps the durable one at
`~/.doyoursecurityplus/state.json`, with every write snapshotted and the last 40
kept. launchd (`scripts/service.sh`) keeps the port fixed, which keeps the
origin fixed, which is what makes the fast tier survive too.

## Saves happen on visibilitychange, not beforeunload

The mirror used to be a keepalive fetch on `beforeunload`. Keepalive bodies are
capped at 64 KB by the spec, the state passed that after a few weeks of
reviews, and the rejection was never awaited. The last writes of every session
were being dropped in silence with the status dot reading "saved". The save now
fires when the tab is hidden, while a normal request still works; the beacon
remains as a last resort and only when the body fits.

## Scratch mode exists because testing wrote real data

Driving the real app to verify a UI fix added eleven fabricated correct
answers to the real study record and retired four misconceptions that had never
been demonstrated. It was restored from a snapshot, and the first restore was
immediately overwritten by a second tab pushing its stale in-memory state on
`visibilitychange`, which is the previous decision working as designed. Close
every tab before restoring. `?scratch=1` keeps test sessions under a separate
key and never talks to the server.

## Coverage is measured against the bank, not a constant

`readiness()` scored how much of an objective you had covered as
`itemsSeen / 12`. Objectives hold anywhere from 2 to 40 items, so 18 of 28
could never reach full coverage and 11 could never read "strong" on a flawless
record; 1.3 read "shaky" with every question right. That is a measurement of
the bank reported as a measurement of you. The denominator is now what the
objective can offer, capped at twelve, and the bank's shortfall is reported on
its own as bank depth and a "thin" flag. `coverageDeficit()` had the same shape
one level down, plus two bugs: a revealed vocabulary card counted toward a
domain like a scenario question, and a domain with nothing unseen left kept
reporting a deficit the queue could not spend.

## A canonical topic id beats an alias

Where the same CompTIA bullet appears under two objectives, the generator
suffixes the later one (`segmentation-2`) and keeps the bare word as its alias.
Resolving tags through one flat map let that alias overwrite the canonical
entry of the objective that owns the bare id, so an item tagged `segmentation`
was credited to 3.3 and never to 2.5. Eighteen topics were misattributed, in the
validator and the app alike, and the cross-language pin between them did not
catch it because both sides had made the same mistake. Canonical ids are now
seeded before any alias in both implementations.

## Multi-select was outside the misconception loop

`itemsFor()` filtered on `type === "mcq"`, which excluded every `mcq-multi`
item: 35 items that could never be served as a retarget and never counted
toward retiring anything. The Python gate counted them, so the two sides
disagreed about which misconceptions were reachable, and the self test caught
it. Anything starting with `mcq` is in the loop.

## The ACL grid is also printed as text

Seven native selects per row truncate their own labels at the widths a
table-layout column gives them: PERMIT rendered in 50 px of a box that needed
80, and five of six controls in every row were cut. You could not read the rule
you had just written on a question whose whole task is reading a policy top to
bottom. Column widths are now measured from the widest option each holds, and
the policy is rendered again as plain text under the grid, the way a device
prints it. The requirements card is pinned while you build, because with eight
rules the span from the first requirement to the last rule is about 1300 px in
a 768 px viewport.

## Inspecting a host is not accusing it

One click on a diagram host both opened its evidence and marked it compromised,
and a second click cleared the mark. You could not investigate without
committing, which is the opposite of the skill the question trains. Clicking
now inspects; naming a host compromised is a separate control, in the evidence
panel and in the host list under the question.

## Acronyms are a glossary, not 315 questions

CompTIA's acronym list was generated into 315 recognition items with one shared
misconception. They made up 21% of the item bank and 36% of its entire
distractor surface, and the live study record showed none had ever been served:
the scheduler's acronym floor was `floor(n * 0.08)`, which is zero whenever a
session has fewer than 13 new slots, which is most sessions once anything is
due. The exam never asks you to expand an acronym; it uses one in a stem and
moves on. The list is now `content/glossary.json`, and every acronym is
expanded inline where it appears in a stem or an option, which is the moment
the expansion is needed.

## The server lists content; there is no manifest

`content/manifest.json` was a committed directory listing, regenerated by a
script, because the browser cannot list a directory. It changed in 16 of the
first 19 commits and every new content file carried the failure mode of
forgetting to rerun the script. The server can list a directory, so
`GET /api/content` does, and a new file is picked up on the next load.

## Twenty-one PBQs

Twenty-one is 3.5% of the graded bank against roughly 5% of the real exam, so
count is not the constraint. A PBQ earns its place when it trains an operation
multiple choice cannot: building a rule set and reading it back, ordering steps
where the order is the answer, gathering evidence across hosts before deciding.
Where the discrimination is "which term is this", a PBQ is a slower multiple
choice question with more authoring surface to get wrong. Eleven of 28
objectives have one; the seventeen without are the ones whose content is
definitional.

## Derived questions bank the authored correction, not a bucket

The 82 questions derived from imported vocabulary mapped every wrong answer to
one per-objective bucket ("confusing neighbouring terms in 3.4"), so a miss
on hot site vs cold site banked a generic card when a hand-written correction
for exactly that pair already existed. `derive_mcq.py` now carries the term
families behind the authored misconceptions: a distractor that is a known
sibling of the answer banks that misconception, and the derived question
feeds the same retirement count as the authored items. A third of the derived
distractors route that way; the rest stay in buckets, which the mentor card
redeems at read time by building its table from the pairs you actually
confused. The questions are also filed under the term (`d-hot-site`) rather
than an Anki note number, and the app moves any progress recorded under the
old id, so a regeneration never costs a review again.

## Recall stays

The term-and-definition cards are the wrong shape for this exam, and the
README says so, but they are the only place vocabulary enters at all, and the
live record showed they were being used: 64 of the first 290 reviews. The
decision is to keep the type at a small share rather than retire it. The share
is now a real floor as well as a cap: at least one card in any session with
room for new coverage, which the old `floor(n * 0.08)` only delivered in
sessions with thirteen or more new slots.

## One grader, one coverage calculation

`validate_content.py` carried a Python mirror of the ACL grader so the gate
could run from the command line, and a Python coverage calculation pinned to
the JavaScript one through `content/coverage.json`. The pin did not catch the
alias bug, because both sides shared it. Both mirrors are gone: grading and
coverage exist once, in JavaScript, and `scripts/selftest.py` runs
`selftest.html` headless in the Chrome on this machine, so the command line
still gets a non-zero exit. The validator checks structure and references.

## Reviews are a resource

The state document carried every review row, so it grew with every answer and
was shipped whole on every save; that is how it crossed the 64 KB keepalive
limit. Reviews, PBQ attempts and mock results are now rows in
`~/.doyoursecurityplus/reviews.jsonl`, behind `GET` and `POST /api/reviews`,
and the document holds only what is keyed by item or misconception. The app
reads back the recent window: today's count, a month of calibration, the mock
history. A pre-resource document is absorbed on first load, and the server
absorbs one too if an old client ever sends it.

## A conditional replace, not a force header

`PUT /api/state` used to mean two things depending on an `X-Dysp-Force`
header. It now means one: replace. A client that wants the server to refuse a
stale write sends `If-Match` with the version it built on and gets `412` with
the newer copy; a client resolving the conflict in its own favour sends no
precondition. That is standard HTTP, and a second client would already know it.

## The checks are the rules

`CONVENTIONS.md` is ten rules; `bin/check` is the ones a machine can hold,
and the hook makes it run before a commit exists. A rule nobody can lint is a
wish, and the two that stay manual (no hardcoded item in `app/`, the glyph
beside every colour) are listed as weaknesses rather than hidden.

## The scheduler is tested under a swapped Math.random

The queue builder shuffles with `Math.random` and takes no generator
argument. The self test swaps in a seeded generator for the duration of each
check and restores the real one after, rather than threading an `rng`
parameter through `buildQueue` and `shuffle` for the test's sake. The app's
signature stays what the app needs, the same seed builds the same queue, and
a failure prints as a seed number that reproduces it. Two defects fell out on
the first run: a shuffled pair could arrive as "2 of 2" before "1 of 2", and a
weak-spot session with one slot left pushed the pair past the end and served
half of it. A pair now needs two whole slots and is sorted back into order.
