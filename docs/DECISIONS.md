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

## An empty state says which empty it is

The app boots straight into a session, so the drill home screen is only ever
reached when a session could not be built. It used to say "Ready when you
are" with a Start button that led straight back to itself. It now says which
of the two reasons applies, nothing is due and everything has been seen, or
nothing is loaded, and offers the one action that fits. The same rule shapes
the other three: a PBQ whose kind has no engine is listed in the lab with the
reason rather than hidden or served, because the person who dropped the file
in looks there; a mock block shows the count it can actually run and keeps
the exam's minute per question rather than giving ninety minutes to eleven
items; and the boot failure names the server and offers Reload rather than
printing the fetch error. `scripts/selftest.py` walks all twelve screens
under the four conditions on every run.

## Focus is restored by what a control is, not by identity

Every render replaces the DOM, which is the simplest possible view layer and
was costing every keyboard user their place: focus fell to the body after
each answer, and the next Tab started again from the nav. The fix keeps the
render model and remembers the focused control by tag, id and data
attributes, then focuses the same control after the render; if it is gone or
disabled, the verdict; failing that, main. Announcements go through one live
region in `index.html` that outlives every render, instead of a `role=status`
set on a node that was recreated each time and so said nothing. The pass was
run against Chrome's accessibility tree over DevTools with real key events,
and the keyboard scenario in `scripts/selftest.py` is the standing check.

## A restore is a new write

Restoring a backup by copying three files into place does not restore
anything while a browser tab is open: the tab's localStorage copy carries a
newer `updatedAt`, wins the reconcile on the next load, and pushes the data
you just replaced straight back. The persistence scenarios showed exactly
this losing path. So `scripts/backup.py restore` writes the restored document
back through the server's own writer with a fresh `updatedAt`. The restored
copy is then the newest anywhere: a reloaded tab takes it, and a tab that is
never reloaded is refused with 412 on its next save, which is the one path
the conditional replace already guards. A safety backup of what was on disk
is taken first and named so it can never land on the archive being read.

## The fonts are served from this origin

The page made exactly one request it did not serve itself: IBM Plex from
Google Fonts. The interface skill forbids a bare system stack, so the choice
was to vendor the files. Google now serves Plex Sans as one variable file,
which also makes the 450 weight the stylesheet uses a real weight rather than
a synthesised one. Four Latin-subset files and the SIL Open Font License sit
in `fonts/`, a hundred kilobytes, and `scripts/check_shape.py` keeps the
origin rule green. Nothing the app shows now depends on a network other than
the study server's own.

## The bank arrives in one response

`GET /api/content` used to be a directory listing, and the browser then
fetched every file it named: a boot was 111 requests, 87 of them for content,
1.92 MB on the wire, and a warm reload cost exactly the same because every
fetch said no-store. The resource is now the bank itself: every JSON file
under `content/`, read and gzipped once per change (the signature is each
file's mtime and size), tagged, and answered with 304 when the browser
already holds that version. A cold boot is 25 requests and 646 KB, 342 KB of
it the bundle; a warm reload asks for content with its ETag and gets 158
bytes back. Adding content is still adding a file, there is still no
manifest and no build step, and the validator stays the gate: a file that
does not parse is skipped with a line in the server log rather than taking
the bank down. `scripts/selftest.py` asserts the one request, the gzip and
the 304 on every run. What a warm reload still pays for is the app's own
files, which are served no-store; that is the next boot cost, if it ever
matters on localhost.

## The server owns its log, and a held port is a wait

launchd opens a job's output files before the program runs and never
reopens them, so a log it holds cannot be rotated by renaming. The real logs
showed the cost: 6.7 MB, and 5.5 MB of it one traceback repeated 6,513 times,
because a second copy of the server found port 8777 taken, exited, and
launchd's KeepAlive restarted it every ten seconds for weeks. Two changes.
The server writes its own log through the standard library's size-rotating
handler (1 MB, three old files kept) when `DYSP_LOG` is set, and launchd's
own file receives only what Python prints before that, kept under 256 KB by
`scripts/capped-log.sh`, which runs on every launch and cuts the file in place
so launchd's descriptor stays valid. And a port in use is no longer a crash:
the server logs one line and retries every five seconds, taking the port
over when it frees. newsyslog was the other option and needs root.

## The queue ranks by expected exam points per minute

The default queue policy is now `gain`. Corrections, prerequisite repairs
and contrast pairs keep their slots, because they are the product. The rest
of a session is one pool of due and unseen items ranked by `expectedGain`,
with a 30% diminishing return for each further pick from the same objective
and the recall floor and cap unchanged. The old policy filled new slots from
whichever domain had the largest share deficit, all of it: from a fresh state
its first session was entirely domain 4. The replay of the real log puts the
cost at 1.7 minutes of a typical session by the model's own measure. The
model is myopic, assuming no further review before the exam; that ranks the
item about to be forgotten first, which is the right order, and overstates
nothing it is compared on. Reversible with `policy: "current"`.

## FSRS keeps its default weights until a fit beats a constant

A fit to the 62 predictions in the log beat the default weights out of
sample, and a predictor that ignores memory and always guesses the person's
average recall rate beat the fit. A fit that cannot beat that constant has
learned how often this person is right, not how they forget, and adopting it
would have stretched the second interval from 6 days to 70 on noise. The
rule: `scripts/replay.py` reports all three every run, and fitted weights are
adopted only when, out of sample, they beat both the defaults and the
constant by 5% on two monthly runs in a row. At the current pace of about 60
predictions a month that is not before the exam on 2026-12-01, so for this
exam the defaults are the plan; there is deliberately no fitted-weights field
yet, because nothing would fill it.

## Items are not capped at the exam date; corrections are

Every item interval used to be capped at the day before the exam, which the
README called compression. Run forward on the real state, the cap put 618
answers on a single day and 751 into the last week, because every card with
a long interval landed on the same day. Those reviews bought nothing: FSRS
sets an interval as the time until recall falls to the target, so a card
whose natural due date is after the exam is still above 0.92 on exam day.
Item intervals are now uncapped, and the one function that records an item
review, `applyItemReview` in `state.js`, is shared by the app and the replay.
Corrections keep the cap, because an open misconception has to be retested
before the exam. `studyPlan` states the load from here to the date: 45
answers and 29 minutes a day on the real state, the busiest day of the last
week 112 answers instead of 618, new items introduced weakest objectives
first. The drill screen says so when the last four weeks' pace cannot carry
it, and estimates how much of the bank stays unseen.

## Readiness forecasts exam day, and a rule says when to book

The Readiness headline was coverage-weighted mastery: unseen material scored
nothing, so it measured how much of the bank had been answered, and read 405
on the real state. It is now a forecast of exam day, 590 with a band of 485 to
696: each graded item's chance of being right on the date, from accuracy on
its objective or memory decayed to the date, weighted by the exam's questions
per objective, dragged by open corrections. Mocks are the only measurement
that resembles the exam, so each recent mock pulls the forecast toward its
own raw score and narrows the model's share of the band. The stopping rule
needs all three of: the band's low end at 750, two recent full mocks at 750,
no high-severity correction open in a heavy domain. The mock's PBQs are now
drawn by domain weight, because a uniform draw gave domain 4 a third of a
mock's points. The per-objective heatmap still uses mastery; it describes
practice, not the exam.

## Hours to the booking rule is the one number

Everything the engine does is now judged by whether it lowers one number on
Readiness: study hours to the booking rule. Valuing each item by a single
review made every bank unreachable, because one review decays to about half
by an exam seven weeks away; an item is valued as studied properly instead,
reviewed on each due day until the exam. And the rule's first condition is
measured with the uncertainty the two required mocks will leave, because the
rule cannot pass without them; with today's uncertainty and no mock the bar
was 86% raw, which no amount of study reaches and which would only have said
"take a mock". Log rows carry a session mark and timing so the estimate can
later be checked against the hours that actually pass.

## Enter submits only an answered PBQ

Enter on a PBQ submits it, and Enter on a graded PBQ continues. Mashed
twenty times, the second press continued and the third submitted the next
PBQ blank, which scored zero and banked every misconception on it as a miss:
a key held a moment too long wrote false corrections into the bank. Enter now
submits only a sheet with something on it, and a held key's repeats are
ignored. The stress scenario also found that a key pressed with nothing
focused left focus on the page after the render, so the next Tab started from
the top; with nothing to restore, focus now goes to the verdict if one just
landed, else to the screen.

## A press is acknowledged with an outline, and motion is linted

The first 100 ms of a control should say the input landed before the result
does. A heavier border would say it, but it changes the box and nudges every
option below; an outline drawn inside the border says it and moves nothing.
The same outline marks the ACL rule a select just changed, in the readout
where the policy is read. Two animations broke the rule that nothing moves
but the thing acted on: the session bar's 320 ms width and the heatmap's
400 ms bars, both decoration. Both are gone, the shared duration is 120 ms,
and `check_materials.py` now fails on any transition or animation at or over
150 ms, so the next one is caught before it ships.

## A skip is not evidence

The fortieth-night person needed a way past an item they know cold. A skip
that counted as a correct answer would let "I know this" raise a number that
is supposed to predict a scored exam, the same reason a revealed recall card
covers no domain. So Skip, or S, records nothing: the item leaves this
session and returns on its own schedule, where the gain-ranked queue already
serves it rarely if it is genuinely held. The mentor bank shows the 12 most
urgent corrections and puts the rest behind Show all, because the 13th is
not what the next session needs.

## Linux gets a systemd user unit, tested short of systemd

`scripts/service.sh` now writes a systemd user unit on Linux with the same
shape as the launchd agent: started with the session, restarted on failure,
`DYSP_DATA` and `DYSP_LOG` set so the server writes and rotates its own log,
and a daily timer for the reminder, which notifies through notify-send. The
journal bounds anything printed before logging starts, so the launch-time cap
macOS needs is not needed. A user unit stops at logout; `loginctl
enable-linger` keeps it running, and changing how an account's services live
is left to the person. There is no Linux machine here and Docker was not
running, so the self test drives the Linux path everywhere short of systemd:
it writes the units to a temporary directory, records the systemctl calls
through a stub, parses the units, and runs the declared ExecStart with the
declared environment as a real server, with a space in the data path to prove
the quoting. What it cannot prove is systemd's own reading of the file; the
first install on a real Linux machine is that test.

## Recall loses its floor

"Recall stays" gave vocabulary cards a floor of one per session. The replay
of the real log then counted 62 recall answers, every one of them served
while a graded question would have gained more per minute, and the floor was
the rule that kept that happening under the gain policy. It is gone, at the
person's request. Recall cards stay in the pool and compete like any item, so
one is served only when it out-ranks the graded alternatives; the pace
profile's cap still bounds them. In practice no recall card is served while
graded questions are available, from a fresh state or the real one, and they
fill in only once the graded work is held. The old policy, kept for
comparison as `policy: "current"`, still has its floor.
