# The engine, measured

The engine's one objective is a pass on SY0-701 in the fewest study hours by
the exam date. This file is the evidence for what it optimises and why. Every
number comes from `scripts/replay.py` on the real log, run on a copy.

## Evidence (2026-10-13)

| | |
|---|---|
| Log | 297 rows, 2026-09-12 to 2026-10-13 |
| Answers | 195 in 25 sessions on 15 days, 151 minutes |
| Recall answers | 62, 32% of all answers |
| Answers on items no longer in the bank | 15, not judged |
| Reviews with a prior review (FSRS evidence) | 62 |
| Mocks | 0 |
| Misconceptions | 24 banked, 17 retired |
| Exam date | 2026-12-01, 49 days out |

## 1. What the queue maximised, and what it should

`currentPriority` in `app/scheduler.js` writes down the old order: a
prerequisite repair, then a contrast pair, then a due correction (by
overdue x severity x objective weight x hits), then a due item (most overdue
first), then new coverage by `deficit * 10 + weight * 2`, inside fixed quotas
of 50% corrections, 20% reviews and the rest new, with recall between a floor
of one and a cap.

`expectedGain` is what it should maximise: expected scaled points at the
exam date per minute. An item stands for its objective's exam questions
divided by the objective's graded items. Its value is the rise in the chance
of getting that share right on exam day, where the chance is understanding
(the person's smoothed accuracy on the objective, lowered for difficulty) or
retained memory (FSRS retrievability at the exam date), weighted by the
chance of answering right now. A recall card is credited a quarter. An open
misconception adds the drag it removes per clean pass. Minutes come from the
log's median answer time.

Where the two disagree, with cost per session from the replay:

| Finding | Old behaviour | Cost per session |
|---|---|---|
| Domain allocation | Fills new slots from the domain with the largest share deficit, all of it: a fresh state's first session was 100% domain 4 with 14 of 25 slots in one objective; on the real state 64% domain 2 | most of 1.7 min |
| No interleaving | Nothing stops one objective taking a session | inside the above |
| Recall | 32% of answers were recall cards before the cap; every one was beaten by a graded item | 0.6 min |
| Due items | Ranked by how overdue, not by how much a review moves exam-day recall; 4 answers served above retrievability 0.95 | 0.1 min |
| Difficulty and accuracy | New items ignore difficulty and how this person does on the objective | inside 1.7 min |
| Fixed quotas | 20% of every session goes to due reviews whatever they are worth | inside 1.7 min |
| Prerequisite routing | Routes backward once per blocker per session; a second correction on the same open prerequisite is drilled anyway: 2 answers | 0.2 min |
| Correction re-served at once | A fresh correction tested again within two answers: 7 answers | 0.35 min |
