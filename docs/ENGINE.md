# The engine, measured

## In two minutes (updated 2026-10-13, after the queue fixes)

**The objective.** A pass on SY0-701 in the fewest study hours by
2026-12-01. Every number below is from `scripts/replay.py` on the real log,
run on a copy: 195 answers in 25 sessions, 3.3 hours, no mocks yet.

**What it optimised.** A fixed order (prerequisite, contrast pair, due
correction, most overdue item, new coverage) inside fixed quotas, with new
coverage taken from whichever domain was most under its share. From a fresh
state its first session was entirely domain 4. Readiness counted unseen
material as worth nothing and headlined 405.

**What it optimises now.** Expected scaled points on exam day per minute of
study: each item's share of its objective's questions, the person's accuracy
on that objective, item difficulty, FSRS memory decayed to the exam date,
and the drag an open correction removes. Sessions interleave across
objectives and follow the exam weights. Items are no longer forced into a
review the day before the exam. Readiness forecasts exam day: **589, band 484
to 695**.

**Waste before, and what closed it.** Outside correction slots the old queue
spent 74 minutes on what the new order buys in 27: about 1.9 minutes of a
typical five-minute session. Over the whole log, and what now prevents each:

| Waste in the log | Answers | Minutes | Closed by |
|---|---|---|---|
| A recall card while a graded item would have gained more | 62 | 15.5 | Recall lost its floor of one per session and competes on its merits |
| A fresh correction tested again within two answers | 7 | 8.8 | `spaceAfterMiss`: the next three answers after a miss are on other beliefs |
| A correction drilled over an open prerequisite | 2 | 5.7 | Every open prerequisite is repaired first; the dependent correction waits |
| An item served above retrievability 0.95 | 4 | 2.6 | The gain policy values such an item at almost nothing |

These counts describe sessions already played, so the replay will keep
reporting them; new waste would show up as growth.

**Content gaps: authored 2026-10-13.** The 29 misconceptions that could not
retire after a single miss each have a third item now, and domains 1 and 5
have a second PBQ (choosing the cryptographic tool, objective 1.4; choosing
the risk treatment, objective 5.2). The retirement audit reports zero gaps.

**Hours to the booking rule: 16 to 35.** The rule: the forecast's low end at
750, two full mocks in the last 14 days at 750, no high-severity correction
open in a heavy domain. Today none hold. 16 to 35 hours over the 48 days
left is 20 to 44 minutes a day. The last month averaged about 6. The hours
rose by one at the low end because the 29 authored items are unseen material.

**What the log cannot decide yet.** FSRS weights: 62 predictions, and a
constant beats both the defaults and a fit, so the defaults stay. The
forecast's calibration: no mock has been taken, so the band carries the
model's own error. One full mock this week is the most informative hour
available.

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

## 4. Retirement, audited

18 retirements in the log; one, `vendor-assessment-methods`, was missed
again two days later. 6% is too few retirements to justify raising
`retireAfter`; the rule is to raise it for a severity whose false-retirement
rate passes 15% over at least 30 retirements.

Every open misconception can still retire on items the bank holds:

| Open | Objective | Clean | Items left | Days since last miss |
|---|---|---|---|---|
| `compromised-vs-affected` | 4.9 | 1/2 | 4 | 3 |
| `acl-implicit-deny` | 4.5 | 1/2 | 7 | 2 |
| `audit-vs-assessment` | 5.5 | 0/2 | 11 | 2 |
| `risk-appetite-vs-tolerance` | 5.2 | 0/2 | 5 | 7 |
| `bia-vs-risk-assessment` | 5.2 | 0/2 | 7 | 2 |
| `screened-subnet-direction` | 3.2 | 1/2 | 2 | 3 |

A seventh open record, `terminology-3-3`, had no definition: its bucket was
emptied in an earlier pass, so it could never be served or retired and was
counted as open forever. Orphan pruning now drops misconception records too.

Authored 2026-10-13: each misconception below has a third item, and the audit
reports zero gaps. The list is kept as the record of what was missing.

The systemic gap was elsewhere. 29 misconceptions hold exactly
`retireAfter` items, so a miss on any one of them leaves too few distinct
items to retire on. One more item each closes it. Author in this order,
heaviest domain first, then severity:

| # | Objective | Severity | Misconception | Items now |
|---|---|---|---|---|
| 1 | 4.5 | high | `ids-ips-detection-methods` | 2 |
| 2 | 4.5 | medium | `host-hardening-enforcement` | 2 |
| 3 | 4.5 | medium | `terminology-4-5` | 2 |
| 4 | 4.6 | medium | `terminology-4-6` | 2 |
| 5 | 2.5 | high | `allow-list-vs-deny-list` | 2 |
| 6 | 2.2 | medium | `supply-chain-roles` | 2 |
| 7 | 2.2 | medium | `misinformation-vs-disinformation` | 2 |
| 8 | 2.2 | medium | `unsecure-network-vectors` | 2 |
| 9 | 2.4 | medium | `ddos-amplified-vs-reflected` | 2 |
| 10 | 2.5 | medium | `least-privilege-vs-permissions` | 2 |
| 11 | 2.3 | low | `jailbreak-vs-sideload` | 2 |
| 12 | 5.1 | medium | `terminology-5-1` | 2 |
| 13 | 5.2 | medium | `risk-appetite-postures` | 2 |
| 14 | 5.2 | medium | `exception-vs-exemption` | 2 |
| 15 | 3.1 | medium | `centralized-vs-decentralized` | 2 |
| 16 | 3.2 | medium | `sdwan-vs-sase` | 2 |
| 17 | 3.4 | medium | `capacity-planning-dimensions` | 2 |
| 18 | 3.2 | low | `nat-as-security-control` | 2 |
| 19 | 3.4 | low | `ups-vs-generator` | 2 |
| 20 | 1.1 | medium | `directive-vs-deterrent` | 2 |
| 21 | 1.1 | medium | `managerial-vs-operational` | 2 |
| 22 | 1.2 | medium | `zero-trust-planes` | 2 |
| 23 | 1.2 | medium | `authenticating-people-vs-systems` | 2 |
| 24 | 1.2 | medium | `deception-technologies` | 2 |
| 25 | 1.2 | medium | `gap-analysis-vs-assessment` | 2 |
| 26 | 1.3 | medium | `change-management-elements` | 2 |
| 27 | 1.4 | medium | `salting-purpose` | 2 |
| 28 | 1.4 | medium | `crl-vs-ocsp` | 2 |
| 29 | 1.4 | low | `blockchain-ledger-properties` | 2 |

## 5. The plan to the exam date

On a copy of the real state, 48 days out, 498 graded items unseen:

| Week | Answers | Minutes | New | Accuracy so far on the new items' objectives |
|---|---|---|---|---|
| 1 | 299 | 199 | 91 | 0.56 |
| 2 | 303 | 202 | 91 | 0.59 |
| 3 | 314 | 208 | 91 | 0.61 |
| 4 | 349 | 234 | 91 | 0.60 |
| 5 | 404 | 269 | 91 | 0.64 |
| 6 | 302 | 202 | 43 | 0.73 |
| 7 | 149 | 99 | 0 | review week |

45 answers and 29 minutes a day; 24 hours in all. The weakest objectives come
first, and the last week is review. The capped intervals this replaced put 751
answers in week 7, 618 of them on one day. The last 30 days averaged 5.7
answers a day, so the plan does not fit the pace and the drill screen says
so: at that pace most of the unseen bank stays unseen, and the queue spends
the time on the most valuable part.

## 6. The mock, and when to stop

**Blueprint.** Multiple choice was already drawn by domain weight, within half
a point. PBQs were not: the bank holds 14 of its 21 in domain 4, the draw was
uniform, and domain 4 carried 34.5% of a full mock's points against 28%. PBQs
are now drawn by domain weight and each domain's multiple choice is sized so
its points, PBQs at three items each, match the weight: 12, 22, 18, 28, 20
exactly. A content gap falls out: domains 1 and 5 hold one PBQ each, so every
full mock repeated them. A second PBQ in each was authored 2026-10-13.

**Scaled score.** CompTIA does not publish its scaling. The estimate maps raw
to 100 to 900 linearly with 75% raw at 750, and difficulty-weights items; both
are stated on the result screen as estimates. It is honest about being a
guess; it is not a measurement until a real score is compared with it.

**Readiness.** The headline was coverage-weighted mastery, which counted
every unseen item as worth nothing: on the real state it said 405. It is now
`examForecast`: every graded item's chance of being right on exam day
(accuracy on its objective, or memory decayed to the date), weighted by the
exam's questions per objective, dragged by open corrections, pulled toward
recent mocks as they arrive. On the real state: **590, band 485 to 696, 57%
expected right.** The band is a binomial 90-question spread plus a model
error of 8 raw points that shrinks with each mock.

**Stopping rule.** Book the exam when all three hold: the low end of the 80%
band is at or above 750; two full mocks in the last 14 days are both at or
above 750; no high-severity correction is open in a domain worth 20% or more.
Under the model the first rule alone would book a failing exam about one time
in ten; the mocks are what test the model, and the rule waits for them. Today:
none met.

## 7. Time, accounted

Every log row now carries its session (`s`), and recall grades and
corrections read on their own carry their timing (`ms`), alongside the
timing graded answers already had. `minutesOf` in `app/reviews.js` counts
study time from the log: an answer's own timing capped at five minutes,
PBQs and mocks by their clocks. On the real log: 3.3 hours in 25 sessions,
median session 5 minutes.

Readiness gains one number, study hours to the booking rule: each item
valued as studied properly to the exam (reviewed on every due day, costed per
review), walked in order of points per minute until the forecast's low end
clears 750 with the uncertainty the two required mocks will leave, plus those
two mocks. The high end allows 2.5 times as long, the replay's measured ratio
between what was served and the gain order. On the real state: **15 to 33
hours.**
