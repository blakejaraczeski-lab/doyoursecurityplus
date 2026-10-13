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

## 2. The real log, replayed

`python3 scripts/replay.py` steps through every row, rebuilds the state as it
was before each answer, and asks the real scheduler, in headless Chrome, what
it would have served. It reads the data directory and writes nothing there.

| Minutes that did not move the score | Answers | Minutes |
|---|---|---|
| Served with retrievability already above 0.95 | 4 | 2.6 |
| A recall card while a graded item would have gained more | 62 | 15.5 |
| A correction drilled on top of an open prerequisite | 2 | 5.7 |
| A fresh correction tested again within two answers | 7 | 8.8 |

Outside the correction slots, which both policies fill the same way, the
answers took 74 minutes; the gain policy buys the same expected points in 30.
That is 1.7 minutes a session, 59% of those answers, measured by the gain
model's own yardstick, so it says the old policy disagreed with the model,
not that the model is right. The domain-mix check is the independent part:
the old policy concentrates a session in one domain, the exam does not.

## 3. FSRS parameters: the defaults stay

62 reviews have a prior review, so 62 predictions to judge FSRS on, 79% of
them recalled. Scored out of sample over five folds by item:

| Predictor | Log-loss |
|---|---|
| Default weights | 0.638 |
| Weights fitted to this log | 0.575 |
| Always predict the person's average recall rate | 0.524 |

The fit beats the defaults, and the constant beats them both. Neither model
knows more about this person's forgetting than how often they are right, so
the fit's gain is base-rate calibration and its intervals (4 then 70 days on
two GOOD answers, against 2 then 6) are noise it learned. The defaults also
under-predict recall here, because most of these reviews are multiple choice
recognition, which is easier than the free recall FSRS was trained on; the
gain model's understanding term absorbs part of that.
