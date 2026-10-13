// Queue builder and readiness projection.
//
// Two ideas drive everything here:
//   1. Exam weight. Domain 4 is 28% of the exam and domain 1 is 12%. Study time
//      follows the weights, not the alphabet.
//   2. Retargeting. A due misconception does not re-show the item you failed. It
//      pulls a different item that tests the same discrimination.

import * as fsrs from "./fsrs.js";
import * as mentor from "./mentor.js";
import { isGraded } from "./content.js";

// The exam's shape: 90 questions in 90 minutes with PBQs front loaded, scored
// 100-900 with 750 to pass. The blocks are fractions of it.
export const FORMATS = {
  full:  { label: "Full exam",   total: 90, pbqCount: 5, minutes: 90 },
  half:  { label: "Half block",  total: 45, pbqCount: 3, minutes: 45 },
  short: { label: "Short block", total: 20, pbqCount: 1, minutes: 20 },
};
export const PBQ_WEIGHT = 3; // a PBQ is worth roughly three multiple choice items

/** Questions in a session. The weak-spot session is shorter: corrections only. */
export const SESSION_SIZE = { drill: 25, weak: 15 };

/**
 * What a block can run against this bank. A bank smaller than the block is
 * honest about it: the count is what exists and the clock keeps the exam's
 * minute per question rather than giving ninety minutes to eleven items.
 */
export function blockFit(content, format) {
  const pbqs = Math.min(format.pbqCount, content.pbqs.length);
  const total = Math.min(format.total, content.items.filter(isGraded).length + pbqs);
  const minutes = total < format.total ? Math.max(5, Math.round(format.minutes * total / format.total)) : format.minutes;
  return { pbqs, total, minutes, short: total < format.total };
}

/**
 * Item weight for scoring. CompTIA says items carry different weights by
 * difficulty and keeps the model confidential, so this is an approximation: a
 * hard item is worth about twice an easy one. A flat count would reward
 * farming easy items, and a run of difficulty-1 recognition would read as
 * readiness.
 */
export const weightOf = (it) => 0.6 + 0.2 * Math.max(1, Math.min(5, it.difficulty || 2));

/**
 * A 0..1 fraction onto CompTIA's 100-900 scale, anchored so that 750, the pass
 * line, sits at 0.75. An estimate, not a predicted score.
 */
export const toScaled = (p) =>
  p <= 0.75 ? Math.round(100 + (650 / 0.75) * p) : Math.round(750 + (150 / 0.25) * (p - 0.75));

// `maxRecallShare` caps plain vocabulary cards as a fraction of a session.
// The exam is multiple choice and PBQs, never free text, so a card you reveal
// and grade yourself trains an operation the exam never asks for. Vocabulary
// still has to get in the door, hence a small share rather than none. New
// coverage takes whatever the misconception and review slots leave.
const PACE = {
  bootcamp:  { mixMisconception: 0.5, mixReview: 0.2, maxRecallShare: 0.12 },
  balanced:  { mixMisconception: 0.4, mixReview: 0.3, maxRecallShare: 0.15 },
  longhaul:  { mixMisconception: 0.3, mixReview: 0.4, maxRecallShare: 0.20 },
};

const itemState = (state, id) => state.items[id] || null;
const seen = (state, id) => !!state.items[id]?.seen;

/**
 * A contrast drill only works if the two halves arrive together. Shuffling is
 * good for everything else, so shuffle first and then pull each pair back into
 * adjacency, anchored on whichever half landed earlier.
 */
function keepPairsAdjacent(queue) {
  const out = [];
  const taken = new Set();
  for (const entry of queue) {
    if (taken.has(entry)) continue;
    const group = entry.contrastDrill
      ? queue.filter((e) => !taken.has(e) && e.contrastDrill && e.targetMisconception === entry.targetMisconception)
             .sort((a, b) => a.contrastDrill.index - b.contrastDrill.index)
      : [entry];
    for (const e of group) { out.push(e); taken.add(e); }
  }
  return out;
}

function shuffle(arr, rnd = Math.random) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/**
 * How far each domain's study is behind where the exam weights say it should be.
 *
 * Only graded practice counts: the exam never asks you to reveal anything, so a
 * revealed vocabulary card covers nothing. And a domain with nothing unseen
 * left reports no deficit, because a deficit the queue cannot spend would send
 * it after material that does not exist.
 */
export function coverageDeficit(state, content) {
  const byDomain = {};
  for (const d of content.objectives.domains) {
    byDomain[d.id] = { weight: d.weight, available: 0, seen: 0, remaining: 0 };
  }
  for (const it of content.items) {
    const dom = content.domainOf[it.objective];
    if (!dom || !byDomain[dom] || !isGraded(it)) continue;
    byDomain[dom].available += 1;
    if (seen(state, it.id)) byDomain[dom].seen += 1;
    else byDomain[dom].remaining += 1;
  }
  const totalSeen = Object.values(byDomain).reduce((a, b) => a + b.seen, 0) || 1;
  for (const d of Object.values(byDomain)) {
    d.share = d.seen / totalSeen;
    // A deficit you cannot spend is not a deficit. With nothing left unseen in
    // the domain, the honest reading is that the bank is exhausted here, which
    // is a content gap to report rather than a routing instruction.
    d.deficit = d.remaining ? d.weight - d.share : 0;
    d.exhausted = d.remaining === 0 && d.available > 0;
  }
  return byDomain;
}

/** Pick the next unseen items, biased toward the most under-studied domains. */
function pickNewItems(state, content, n, recallBudget = Infinity) {
  const deficit = coverageDeficit(state, content);
  const unseen = content.items.filter((it) => !seen(state, it.id) && it.objective);

  const score = (it) => {
    const d = deficit[content.domainOf[it.objective]] || { deficit: 0, weight: 0.1 };
    return d.deficit * 10 + d.weight * 2 + Math.random() * 0.25;
  };
  const recall = unseen.filter((it) => it.type === "recall").sort((a, b) => score(b) - score(a));
  const core = unseen.filter((it) => it.type !== "recall").sort((a, b) => score(b) - score(a));

  // A floor as well as a cap, or vocabulary never appears while any exam-shaped
  // item is left unseen. 8% of the new slots, and at least one card in any
  // session with room for new coverage at all: vocabulary gets in the door
  // once a session, and never more than the pace profile's share.
  const out = [];
  const take = (pool, k) => { for (let i = 0; i < k && pool.length && out.length < n; i++) out.push(pool.shift()); };
  take(recall, Math.min(recallBudget, Math.max(n >= 4 ? 1 : 0, Math.floor(n * 0.08))));
  take(core, n - out.length);
  take(recall, Math.max(0, recallBudget - out.filter((it) => it.type === "recall").length));
  return out;
}

/** Previously seen items whose own FSRS card is due. */
function pickDueItems(state, content, n, now) {
  const due = content.items
    .filter((it) => {
      const s = itemState(state, it.id);
      return s?.fsrs && s.fsrs.due <= now;
    })
    .map((it) => ({ it, overdue: now - state.items[it.id].fsrs.due }));
  due.sort((a, b) => b.overdue - a.overdue);
  return due.slice(0, n).map((d) => d.it);
}

/**
 * Build a study queue.
 * @param {string} mode drill | weak | pbq | mock
 */
export function buildQueue(state, content, { mode = "drill", size = 25, now = Date.now(), policy = "gain" } = {}) {
  const pace = PACE[state.profile.pace] || PACE.bootcamp;
  const queue = [];

  if (mode === "pbq") {
    const attempted = (id) => state.pbq[id]?.attempts || 0;
    return shuffle(content.pbqs)
      .sort((a, b) => attempted(a.id) - attempted(b.id))
      .slice(0, size)
      .map((p) => ({ kind: "pbq", pbq: p, reason: "PBQ lab" }));
  }

  // 1. Due misconceptions, each retargeted onto a DIFFERENT item.
  const dueMc = mentor.due(state, content, now);
  const mcSlots = mode === "weak" ? size : Math.round(size * pace.mixMisconception);
  const routedBackward = new Set();
  for (const d of dueMc) {
    if (queue.length >= mcSlots) break;

    // Repair backward. If this correction sits on top of a dependency that is
    // itself still open, drilling the symptom is wasted: fix the thing holding
    // it up first, and say so.
    const blockers = mentor.blockedBy(d.id, state, content);
    if (blockers.length && !routedBackward.has(blockers[0].id)) {
      const b = blockers[0];
      routedBackward.add(b.id);
      // Exclude the item that exposed the dependency, same rule as every other
      // path: being re-served the question you just failed teaches the question.
      const pool = mentor.itemsFor(b.id, content, state, b.rec?.lastItem);
      const pick = [...pool.mcqs, ...pool.pbqs][0];
      if (pick) {
        queue.push({
          kind: pick.subtasks ? "pbq" : "item",
          item: pick.subtasks ? undefined : pick,
          pbq: pick.subtasks ? pick : undefined,
          targetMisconception: b.id,
          prereqRepair: { blocked: d.def.label, blocker: b.def.label, why: b.why },
          reason: `Dependency first: ${b.def.label}`,
        });
        continue;
      }
    }

    // Third strike: stop re-serving the explanation and force the distinction.
    // A pair needs two whole slots: pushed past the end, the final slice would
    // serve half of it, which teaches the answer rather than the difference.
    if (mentor.tierFor(d.rec) >= 3) {
      const pair = mentor.contrastPair(d.id, content, state);
      if (pair && queue.length + 2 <= mcSlots) {
        pair.items.forEach((item, i) => {
          queue.push({
            kind: "item",
            item,
            targetMisconception: d.id,
            contrastDrill: { index: i, of: pair.items.length, label: d.def.label },
            reason: `Contrast drill: ${d.def.label}`,
          });
        });
        continue;
      }
    }

    const { mcqs, pbqs } = mentor.itemsFor(d.id, content, state, d.rec.lastItem);
    const pool = [...mcqs, ...pbqs];
    if (pool.length) {
      const pick = pool[Math.floor(Math.random() * pool.length)];
      queue.push({
        kind: pick.subtasks ? "pbq" : "item",
        item: pick.subtasks ? undefined : pick,
        pbq: pick.subtasks ? pick : undefined,
        targetMisconception: d.id,
        reason: `Retargeting: ${d.def.label}`,
      });
    } else {
      // No other item covers this discrimination yet. Teach it directly.
      queue.push({
        kind: "mentor",
        targetMisconception: d.id,
        reason: `Review the correction: ${d.def.label}`,
      });
    }
  }

  if (mode === "weak") return queue.slice(0, size);

  // 2 and 3 under the gain policy: one pool of due and unseen items, ranked by
  // expected exam points per minute, recall held to the same floor and cap.
  if (policy === "gain") {
    const taken = new Set(queue.map((e) => e.item?.id).filter(Boolean));
    const ctx = gainContext(state, content, now);
    const pool = content.items
      .filter((it) => it.objective && !taken.has(it.id) &&
        (!seen(state, it.id) || (itemState(state, it.id)?.fsrs?.due ?? Infinity) <= now))
      .map((it) => ({ it, g: expectedGain({ item: it }, state, content, ctx).perMinute + Math.random() * 1e-6 }));
    const slots = Math.max(0, size - queue.length);
    const cap = Math.max(0, Math.max(1, Math.round(size * pace.maxRecallShare)) - queue.filter((e) => e.item?.type === "recall").length);
    const floor = Math.min(cap, slots >= 4 ? 1 : 0);
    // Greedy, with a diminishing return per objective: each item already
    // picked from an objective discounts the next by 30%. Items in one
    // objective share what they teach, so the fourth is worth less than the
    // first, and the session interleaves instead of drilling one drawer.
    const fromObjective = {};
    for (const q of queue) { const o = (q.item || q.pbq)?.objective; if (o) fromObjective[o] = (fromObjective[o] || 0) + 1; }
    const worth = (x) => x.g * Math.pow(0.7, fromObjective[x.it.objective] || 0);
    const take = (x) => { picked.push(x.it); fromObjective[x.it.objective] = (fromObjective[x.it.objective] || 0) + 1; };
    const picked = [];
    const recall = pool.filter((x) => x.it.type === "recall").sort((a, b) => b.g - a.g);
    recall.slice(0, floor).forEach(take);
    let left = pool.filter((x) => !picked.includes(x.it));
    while (picked.length < slots && left.length) {
      const recallFull = picked.filter((x) => x.type === "recall").length >= cap;
      let best = null;
      for (const x of left) if (!(recallFull && x.it.type === "recall") && (!best || worth(x) > worth(best))) best = x;
      if (!best) break;
      take(best);
      left = left.filter((x) => x !== best);
    }
    for (const it of picked) {
      queue.push({ kind: "item", item: it, reason: seen(state, it.id) ? "Due for review" : it.type === "recall" ? "Vocabulary" : "New coverage" });
    }
    return keepPairsAdjacent(shuffle(queue)).slice(0, size);
  }

  // 2. Items already seen whose own card is due.
  const reviewSlots = Math.round(size * pace.mixReview);
  for (const it of pickDueItems(state, content, reviewSlots, now)) {
    queue.push({ kind: "item", item: it, reason: "Due for review" });
  }

  // 3. New coverage, weighted toward the under-studied heavy domains, with
  //    plain vocabulary capped so it cannot crowd out exam-shaped practice.
  const newSlots = Math.max(0, size - queue.length);
  const recallBudget = Math.max(1, Math.round(size * pace.maxRecallShare));
  const alreadyRecall = queue.filter((e) => e.item?.type === "recall").length;
  for (const it of pickNewItems(state, content, newSlots, Math.max(0, recallBudget - alreadyRecall))) {
    queue.push({ kind: "item", item: it, reason: it.type === "recall" ? "Vocabulary" : "New coverage" });
  }

  return keepPairsAdjacent(shuffle(queue)).slice(0, size);
}

/**
 * Build a mock exam: PBQs front loaded, then multiple choice, up to 90 items.
 *
 * The blueprint holds in points, not just in item count. PBQs are drawn by
 * domain weight, not uniformly: the bank holds 14 of its 21 in domain 4, and a
 * uniform draw gave that domain 34% of a mock's points against an exam weight
 * of 28%. Each domain's multiple choice is then sized so its items plus its
 * PBQs, at PBQ_WEIGHT each, come to its share of the whole.
 */
export function buildMock(content, { pbqCount = 5, total = 90 } = {}) {
  const domains = content.objectives.domains;
  const pbqPool = {};
  for (const p of shuffle(content.pbqs)) (pbqPool[content.domainOf[p.objective]] ||= []).push(p);
  const pbqs = [];
  const pbqIn = {};
  while (pbqs.length < Math.min(pbqCount, content.pbqs.length)) {
    // the domain furthest below its weight in PBQ points so far, among those with one left
    const open = domains.filter((d) => pbqPool[d.id]?.length);
    if (!open.length) break;
    const d = open.sort((a, b) => ((pbqIn[a.id] || 0) - a.weight * (pbqs.length + 1)) - ((pbqIn[b.id] || 0) - b.weight * (pbqs.length + 1))
      || Math.random() - 0.5)[0];
    pbqs.push(pbqPool[d.id].shift());
    pbqIn[d.id] = (pbqIn[d.id] || 0) + 1;
  }

  // The real exam is single-select, multi-select and PBQs, so a mock that draws
  // only plain "mcq" is narrower than the thing it is imitating. Multi-select
  // and the derived discrimination items are exam-shaped and belong in the pool.
  const mcqs = content.items.filter(isGraded);
  const byDomain = {};
  for (const m of mcqs) (byDomain[content.domainOf[m.objective]] ||= []).push(m);

  const want = total - pbqs.length;
  const points = want + PBQ_WEIGHT * pbqs.length;
  const picked = [];
  for (const d of domains) {
    const n = Math.max(0, Math.round(points * d.weight - PBQ_WEIGHT * (pbqIn[d.id] || 0)));
    picked.push(...shuffle(byDomain[d.id] || []).slice(0, n));
  }
  const filler = shuffle(mcqs.filter((m) => !picked.includes(m)));
  while (picked.length < want && filler.length) picked.push(filler.pop());
  while (picked.length > want) picked.pop();

  return [
    ...pbqs.map((p) => ({ kind: "pbq", pbq: p })),
    ...shuffle(picked).map((i) => ({ kind: "item", item: i })),
  ];
}

// --- what the queue optimises ------------------------------------------------
//
// Two functions, kept side by side so the difference is a diff and not a
// paragraph. `currentPriority` is what the queue builder has always done,
// written down as one score. `expectedGain` is what it should maximise:
// expected scaled-score points at the exam date, per minute of study.

/** Scaled points one exam question is worth below the pass line: 650 points over 75% of 90. */
export const POINTS_PER_QUESTION = 650 / 0.75 / 90;
const EXAM_QUESTIONS = 90;
const PBQS_ON_EXAM = 4;
// A revealed vocabulary card never appears on the exam. It is credited with a
// quarter of a graded item's transfer: it helps you read a stem, it is not one.
const RECALL_TRANSFER = 0.25;
// Seconds per answer by kind. The real log's median for a graded answer is 39 s
// (62 timed rows, 2026-10-13); recall and PBQ are not timed yet.
export const SECONDS = { mcq: 40, "mcq-multi": 60, recall: 15, pbq: 480, mentor: 60 };
const SEVERITY = { high: 1, medium: 0.7, low: 0.4 };

/**
 * What the queue builder maximises today, as one number per candidate. It is
 * lexicographic: a tier, then a score inside the tier. Quotas sit outside it:
 * the pace profile gives misconceptions 50% of a session, due items 20%, and
 * new coverage the rest, with recall held between a floor of one and a cap.
 */
export function currentPriority(entry, state, content, now = Date.now()) {
  const tier = entry.prereqRepair ? 5 : entry.contrastDrill ? 4 : entry.targetMisconception ? 3
    : entry.item && state.items[entry.item.id]?.fsrs?.due <= now ? 2 : 1;
  let score = 0;
  if (tier >= 3) {
    const d = mentor.due(state, content, now).find((x) => x.id === entry.targetMisconception);
    score = d ? d.urgency : 0;                                   // overdue x severity x objective weight x hits
  } else if (tier === 2) {
    score = (now - state.items[entry.item.id].fsrs.due) / fsrs.DAY_MS;   // most overdue first
  } else if (entry.item) {
    const d = coverageDeficit(state, content)[content.domainOf[entry.item.objective]] || { deficit: 0, weight: 0.1 };
    score = d.deficit * 10 + d.weight * 2;                         // under-studied heavy domain first
  }
  return tier * 1e6 + score;
}

/** Everything expectedGain needs that does not change between candidates. */
export function gainContext(state, content, now = Date.now()) {
  const days = state.profile.examDate ? Math.max(1, mentor.daysUntilExam(state, now)) : 30;
  const examAt = now + days * fsrs.DAY_MS;
  const perObjective = {};
  for (const d of content.objectives.domains) {
    for (const o of d.objectives) {
      perObjective[o.id] = { questions: EXAM_QUESTIONS * d.weight / d.objectives.length, graded: 0, recall: 0, seen: 0, correct: 0 };
    }
  }
  for (const it of content.items) {
    const o = perObjective[it.objective];
    if (!o) continue;
    if (isGraded(it)) o.graded += 1; else o.recall += 1;
    const s = state.items[it.id];
    if (s?.seen && isGraded(it)) { o.seen += s.seen; o.correct += s.correct || 0; }
  }
  return { now, examAt, days, perObjective, pbqs: content.pbqs.length };
}

/**
 * What this person would get right on this item's slice of the exam without
 * remembering this item: their smoothed accuracy on the objective, lowered for
 * a harder item. Memory of the item adds to it, it does not replace it.
 */
function baseRate(it, ctx) {
  const o = ctx.perObjective[it.objective];
  const prior = (o.correct + 2) / (o.seen + 4);
  return Math.max(0.05, Math.min(0.9, prior * (1.15 - 0.075 * (it.difficulty || 3))));
}

/** Right on exam day either from understanding or from retained memory of the item. */
const examProb = (base, memory) => 1 - (1 - base) * (1 - memory);

/**
 * Expected scaled-score points gained at the exam date by serving this
 * candidate now, and the minutes it costs. An item stands for its share of
 * its objective's exam questions; serving it moves the chance of getting that
 * share right on exam day from where it would decay to, to where one more
 * review leaves it, weighted by the chance of answering right now. Myopic on
 * purpose: it assumes no further review, which is what ranks the item you are
 * about to forget above the one you already hold.
 */
export function expectedGain(entry, state, content, ctx = gainContext(state, content)) {
  const { now, examAt } = ctx;
  let points = 0;
  let seconds = SECONDS.mcq;
  const it = entry.item;
  if (it) {
    const o = ctx.perObjective[it.objective];
    if (o) {
      const graded = isGraded(it);
      // A graded item stands for its share of the objective's exam questions.
      // A recall card is measured against all the objective's material and
      // credited a quarter of that, so a lone card cannot stand for a whole objective.
      const share = graded ? o.questions / Math.max(1, o.graded)
        : (o.questions / Math.max(1, o.graded + o.recall)) * RECALL_TRANSFER;
      const s = state.items[it.id];
      const base = baseRate(it, ctx);
      const studied = !!s?.fsrs?.stability;
      const card = studied ? s.fsrs : fsrs.newCard();
      const memNow = studied ? fsrs.currentRetrievability(card, now) : 0;
      const memExam = studied ? fsrs.currentRetrievability(card, examAt) : 0;
      const pNow = examProb(base, memNow);                         // the chance of answering right now
      const opts = { now, desiredRetention: state.profile.desiredRetention };
      const memAfter = pNow * fsrs.currentRetrievability(fsrs.review(card, fsrs.RATING.GOOD, opts), examAt)
        + (1 - pNow) * fsrs.currentRetrievability(fsrs.review(card, fsrs.RATING.AGAIN, opts), examAt);
      points += share * Math.max(0, examProb(base, memAfter) - examProb(base, memExam)) * POINTS_PER_QUESTION;
      seconds = SECONDS[it.type] || SECONDS.mcq;
    }
  }
  if (entry.pbq) {
    const best = (state.pbq[entry.pbq.id]?.best || 0) / 100;
    points += (PBQS_ON_EXAM / Math.max(1, ctx.pbqs)) * PBQ_WEIGHT * (1 - best) * 0.3 * POINTS_PER_QUESTION;
    seconds = entry.pbq.targetSeconds || SECONDS.pbq;
  }
  if (entry.kind === "mentor") seconds = SECONDS.mentor;
  const mc = entry.targetMisconception && state.misconceptions[entry.targetMisconception];
  if (mc && !mc.retired) {
    // An open misconception drags its objective by up to 12% per unit of
    // severity until it retires; one clean pass is one step of `needed`.
    const def = content.misconceptions[entry.targetMisconception];
    const o = def && ctx.perObjective[def.objective];
    if (o) points += o.questions * POINTS_PER_QUESTION * 0.12 * (SEVERITY[def.severity] ?? 0.7) / (def.retireAfter ?? 2);
  }
  const minutes = seconds / 60;
  return { points, minutes, perMinute: points / minutes };
}

// --- the plan to the exam date ----------------------------------------------------

const REVIEW_WEEK = 7;   // the last week before the exam is for review and mocks, not new material

/**
 * Every day from now to the exam: how many answers it takes, and how many
 * minutes. Seen cards are reviewed on their due day and advanced as if
 * recalled; a card due after the exam is above target on exam day and costs
 * nothing. Unseen graded items are introduced at an even
 * rate over the days before the review week, highest expected gain first,
 * which is what front-loads the weakest heavily weighted objectives. A
 * projection, not a promise: misses add reviews the plan does not foresee.
 */
export function studyPlan(state, content, now = Date.now()) {
  if (!state.profile.examDate) return null;
  const days = Math.max(1, mentor.daysUntilExam(state, now));
  const examAt = now + days * fsrs.DAY_MS;
  const opts = (t) => ({ now: t, desiredRetention: state.profile.desiredRetention });
  const ctx = gainContext(state, content, now);
  const unseen = content.items.filter((it) => isGraded(it) && it.objective && !seen(state, it.id))
    .map((it) => ({ it, g: expectedGain({ item: it }, state, content, ctx).perMinute }))
    .sort((a, b) => b.g - a.g).map((x) => x.it);
  const learnDays = Math.max(1, days - REVIEW_WEEK);
  const newPerDay = Math.ceil(unseen.length / learnDays);

  const cards = Object.values(state.items).filter((s) => s.fsrs?.stability).map((s) => ({ ...s.fsrs }));
  const plan = [];
  let next = 0;
  for (let d = 0; d < days; d++) {
    const dayEnd = now + (d + 1) * fsrs.DAY_MS;
    let reviews = 0;
    for (let i = 0; i < cards.length; i++) {
      if (cards[i].due < dayEnd && cards[i].due < examAt) { cards[i] = fsrs.review(cards[i], fsrs.RATING.GOOD, opts(Math.max(cards[i].due, dayEnd - fsrs.DAY_MS))); reviews += 1; }
    }
    const fresh = d < learnDays ? unseen.slice(next, next + newPerDay) : [];
    next += fresh.length;
    for (let k = 0; k < fresh.length; k++) cards.push(fsrs.review(fsrs.newCard(), fsrs.RATING.GOOD, opts(dayEnd - fsrs.DAY_MS)));
    const answers = reviews + fresh.length;
    plan.push({ day: d, reviews, fresh: fresh.length, answers, minutes: Math.round(answers * SECONDS.mcq / 60),
                objectives: fresh.map((it) => it.objective) });
  }
  const peak = Math.max(...plan.map((p) => p.answers));
  const total = plan.reduce((a, p) => a + p.answers, 0);
  const reviews = plan.reduce((a, p) => a + p.reviews, 0);
  return { days, unseen: unseen.length, newPerDay, peak, reviews, perDay: Math.ceil(total / days),
           minutesPerDay: Math.round(total / days * SECONDS.mcq / 60), totalMinutes: Math.round(total * SECONDS.mcq / 60), plan };
}

// --- the forecast and the stopping rule ---------------------------------------------

const MOCK_WEIGHT = { full: 1, half: 0.5, short: 0.25 };
const MODEL_SD = 0.08;      // raw-score error of the model before any mock calibrates it
const Z = 1.28;             // one-sided 10%

/**
 * The scaled score expected on exam day, and its band. Built from what the
 * person is likely to remember then, not from how much of the bank they have
 * seen: every graded item's chance of being right on the day (understanding,
 * or memory decayed to the date), averaged per objective, dragged by open
 * corrections, weighted by the exam's questions per objective. Mocks are the
 * only thing that resembles the exam, so as they arrive they pull the
 * estimate toward their own result and narrow the model's share of the band.
 */
export function examForecast(state, content, now = Date.now(), mocks = []) {
  const ctx = gainContext(state, content, now);
  const per = {};
  for (const it of content.items) {
    if (!isGraded(it) || !ctx.perObjective[it.objective]) continue;
    const s = state.items[it.id];
    const mem = s?.fsrs?.stability ? fsrs.currentRetrievability(s.fsrs, ctx.examAt) : 0;
    (per[it.objective] ||= []).push(examProb(baseRate(it, ctx), mem));
  }
  const drag = {};
  for (const [id, r] of Object.entries(state.misconceptions || {})) {
    const def = content.misconceptions[id];
    if (r.retired || !def) continue;
    drag[def.objective] = (drag[def.objective] || 0) +
      0.12 * (SEVERITY[def.severity] ?? 0.7) * (1 - fsrs.currentRetrievability(r.fsrs, ctx.examAt));
  }
  let model = 0, variance = 0;
  for (const [o, v] of Object.entries(ctx.perObjective)) {
    const ps = per[o] || [];
    const p = (ps.length ? ps.reduce((a, b) => a + b, 0) / ps.length : 0.5) * (1 - Math.min(0.4, drag[o] || 0));
    model += v.questions * p / EXAM_QUESTIONS;
    variance += v.questions * p * (1 - p);
  }
  const recent = mocks.filter((m) => m.at >= now - 30 * fsrs.DAY_MS && typeof m.raw === "number");
  const w = recent.reduce((a, m) => a + (MOCK_WEIGHT[m.format] ?? 0.25), 0);
  const mockRaw = w ? recent.reduce((a, m) => a + m.raw * (MOCK_WEIGHT[m.format] ?? 0.25), 0) / w : null;
  const k = w / (w + 2);
  const raw = mockRaw == null ? model : k * mockRaw + (1 - k) * model;
  const sd = Math.sqrt(variance / EXAM_QUESTIONS ** 2 + (MODEL_SD ** 2) / (1 + w));
  const clamp = (x) => Math.max(0, Math.min(1, x));

  // The stopping rule: book the exam when all three hold.
  const fulls = mocks.filter((m) => m.format === "full" && m.at >= now - 14 * fsrs.DAY_MS);
  const heavyOpen = Object.entries(state.misconceptions || {}).filter(([id, r]) => {
    const def = content.misconceptions[id];
    return def && !r.retired && def.severity === "high" && (content.objectiveById[def.objective]?.weight ?? 0) >= 0.2;
  }).map(([id]) => id);
  const rules = [
    { met: toScaled(clamp(raw - Z * sd)) >= 750, text: `the low end of the band is at or above 750 (it is ${toScaled(clamp(raw - Z * sd))})` },
    { met: fulls.length >= 2 && fulls.slice(-2).every((m) => m.scaled >= 750),
      text: `two full mocks in the last 14 days, both at or above 750 (${fulls.length ? fulls.slice(-2).map((m) => m.scaled).join(" and ") : "none taken"})` },
    { met: heavyOpen.length === 0, text: `no high-severity correction open in a domain worth 20% or more (${heavyOpen.length} open)` },
  ];
  return {
    raw, model, mockRaw, mocks: recent.length, sd,
    scaled: toScaled(clamp(raw)), low: toScaled(clamp(raw - Z * sd)), high: toScaled(clamp(raw + Z * sd)),
    stop: { ready: rules.every((r) => r.met), rules },
  };
}

/**
 * Study hours from here to the stopping rule, its two full mocks included.
 *
 * Each item is valued as studied properly, not once: reviewed on every due
 * day until the exam, and costed per review. That is its rise in the chance
 * of being right on exam day, against the minutes all those reviews take.
 * The bank is walked in order of points per minute until the forecast's low
 * end would clear 750, measured with the uncertainty the two required mocks
 * will leave rather than today's, because the rule cannot pass without them.
 * The high end of the range allows 2.5 times as long, the ratio the replay of
 * the real log measured between what was served and the gain order. When the
 * whole bank cannot close the gap, the gap is content, not hours.
 */
export function hoursToReady(state, content, now = Date.now(), mocks = []) {
  const f = examForecast(state, content, now, mocks);
  const fullMocks = mocks.filter((m) => m.format === "full" && m.at >= now - 30 * fsrs.DAY_MS).length;
  const sdAfter = Math.sqrt(f.sd ** 2 - (MODEL_SD ** 2) / (1 + fullMocks) + (MODEL_SD ** 2) / (1 + Math.max(2, fullMocks)));
  const gap = Math.max(0, 0.75 + Z * sdAfter - f.raw) * (650 / 0.75);
  const mockMinutes = Math.max(0, 2 - fullMocks) * FORMATS.full.minutes;
  const ctx = gainContext(state, content, now);
  const ranked = [];
  for (const it of content.items) {
    const o = ctx.perObjective[it.objective];
    if (!isGraded(it) || !o) continue;
    const base = baseRate(it, ctx);
    const s = state.items[it.id];
    let card = s?.fsrs?.stability ? { ...s.fsrs } : fsrs.newCard();
    const before = examProb(base, card.stability ? fsrs.currentRetrievability(card, ctx.examAt) : 0);
    let at = card.stability ? Math.max(now, card.due) : now, reviews = 0;
    while (at < ctx.examAt && reviews < 12) {
      card = fsrs.review(card, fsrs.RATING.GOOD, { now: at, desiredRetention: state.profile.desiredRetention });
      reviews += 1;
      at = card.due;
    }
    if (!reviews) continue;
    const points = (o.questions / Math.max(1, o.graded)) * (examProb(base, fsrs.currentRetrievability(card, ctx.examAt)) - before) * POINTS_PER_QUESTION;
    const minutes = reviews * (SECONDS[it.type] || SECONDS.mcq) / 60;
    if (points > 0) ranked.push({ points, minutes });
  }
  ranked.sort((a, b) => b.points / b.minutes - a.points / a.minutes);
  let points = 0, minutes = 0;
  for (const g of ranked) {
    if (points >= gap) break;
    points += g.points;
    minutes += g.minutes;
  }
  if (points < gap) return { reachable: false, gap: Math.round(gap), available: Math.round(points) };
  return { reachable: true, low: (minutes + mockMinutes) / 60, high: (minutes * 2.5 + mockMinutes) / 60, gap: Math.round(gap) };
}

// --- readiness -------------------------------------------------------------

const laplace = (correct, seenCount) => (correct + 2) / (seenCount + 4);

/**
 * Mastery 0..1 per objective for the per-objective picture, and the exam-day
 * forecast for the headline (examForecast). `mocks` are the mock rows from the
 * review log; `reviewCount` only qualifies how much evidence there is.
 */
export function readiness(state, content, now = Date.now(), reviewCount = 0, mocks = []) {
  const perObjective = {};
  for (const d of content.objectives.domains) {
    for (const o of d.objectives) {
      perObjective[o.id] = {
        objective: o.id, title: o.title, domain: d.id, weight: d.weight,
        topics: o.topics.length, topicsCovered: 0,
        itemsAvailable: 0, pbqAvailable: 0, itemsSeen: 0, itemsCorrect: 0, attempts: 0,
        openMisconceptions: 0, retiredMisconceptions: 0, severityDrag: 0,
      };
    }
  }

  // How much graded material exists per objective, and how much of the
  // objective's blueprint it reaches. Both are properties of the bank, not of
  // the learner, and keeping them apart is the whole point: an objective with
  // two items is not an objective you are bad at.
  // Topic tags resolve through aliases; this is the one place that does it.
  // A canonical topic id always wins over another topic's alias: "segmentation"
  // is 2.5's own topic and only an alias of 3.3's segmentation-2, so the bare
  // word must credit 2.5. Canonical ids are seeded first for that reason.
  const canonical = {};
  const ownTopics = {};
  for (const d of content.objectives.domains) {
    for (const o of d.objectives) {
      ownTopics[o.id] = new Set(o.topics.map((t) => t.id));
      for (const t of o.topics) canonical[t.id] = t.id;
    }
  }
  for (const d of content.objectives.domains) {
    for (const o of d.objectives) {
      for (const t of o.topics) {
        for (const a of t.aliases || []) if (!(a in canonical)) canonical[a] = t.id;
      }
    }
  }
  // A topic is covered when some graded item tests it, wherever that item is
  // filed. Items legitimately reach across objective boundaries, and the
  // question this answers is whether the blueprint topic gets examined at all,
  // not whose drawer it was filed in.
  const touched = new Set();
  const credit = (topics) => {
    for (const raw of topics || []) {
      const t = canonical[raw];
      if (t) touched.add(t);
    }
  };
  for (const it of content.items) {
    const rec = perObjective[it.objective];
    if (!isGraded(it)) continue;
    if (rec) rec.itemsAvailable += 1;
    credit(it.topics);
  }
  // A PBQ is graded material too. It is scored separately from the item queue,
  // so it covers blueprint ground without entering the itemsSeen denominator.
  for (const pq of content.pbqs) {
    const rec = perObjective[pq.objective];
    if (rec) rec.pbqAvailable += 1;
    credit(pq.topics);
  }
  for (const rec of Object.values(perObjective)) {
    rec.topicsCovered = [...ownTopics[rec.objective]].filter((t) => touched.has(t)).length;
  }

  // Mastery is built from graded practice only. A recall card is revealed and
  // self-graded, so folding it in here would let "I knew that" raise a number
  // that is supposed to predict a scored exam.
  for (const it of content.items) {
    const s = itemState(state, it.id);
    const rec = perObjective[it.objective];
    if (!rec || !s?.seen || !isGraded(it)) continue;
    const w = weightOf(it);
    rec.itemsSeen += 1;
    rec.attempts += s.seen * w;
    rec.itemsCorrect += (s.correct || 0) * w;
  }

  const sev = { high: 1, medium: 0.7, low: 0.4 };
  for (const [id, r] of Object.entries(state.misconceptions)) {
    const def = content.misconceptions[id];
    const rec = def && perObjective[def.objective];
    if (!rec) continue;
    if (r.retired) rec.retiredMisconceptions += 1;
    else {
      rec.openMisconceptions += 1;
      const decay = fsrs.currentRetrievability(r.fsrs, now);
      rec.severityDrag += (sev[def.severity] ?? 0.7) * (1 - decay);
    }
  }

  // PBQ performance folds into the objective the PBQ belongs to.
  for (const p of content.pbqs) {
    const done = state.pbq[p.id];
    const rec = perObjective[p.objective];
    if (!rec || !done?.attempts) continue;
    rec.pbqBest = done.best / 100;
  }

  const totals = { itemsSeen: 0, weightedMastery: 0, sampled: 0 };
  for (const rec of Object.values(perObjective)) {
    const accuracy = rec.attempts ? laplace(rec.itemsCorrect, rec.attempts) : 0;

    // The denominator is what this objective can actually offer you, not a
    // constant: with a flat one, an objective holding two items could never
    // reach full coverage, and the size of the bank read as a weakness in you.
    // Twelve is the sample size worth having; an objective that cannot supply
    // twelve is scored out of what it has, and the shortfall is reported
    // separately as bank depth.
    const sample = Math.min(rec.itemsAvailable, 12);
    const coverage = sample ? Math.min(1, rec.itemsSeen / sample) : 0;
    const drag = Math.min(0.4, rec.severityDrag * 0.12);
    let mastery = accuracy * (0.5 + 0.5 * coverage) - drag;
    if (rec.pbqBest != null) mastery = mastery * 0.7 + rec.pbqBest * 0.3;
    rec.accuracy = accuracy;
    rec.coverage = coverage;

    // Bank depth is the blueprint question: of this objective's topics, how many
    // does any graded item touch? A high mastery over a shallow bank is a real
    // result on an unrepresentative sample, so it is labelled rather than
    // silently discounted.
    rec.bankDepth = rec.topics ? rec.topicsCovered / rec.topics : 0;
    // Thin: under 35% of the blueprint reached, or fewer than four graded units.
    const units = rec.itemsAvailable + rec.pbqAvailable;
    rec.thin = units > 0 && (rec.bankDepth < 0.35 || units < 4);

    rec.mastery = Math.max(0, Math.min(1, mastery));
    rec.status = units === 0 ? "no-items"
      : rec.itemsSeen === 0 ? "untouched"
      : rec.mastery >= 0.85 ? "strong"
      : rec.mastery >= 0.7 ? "ok"
      : rec.mastery >= 0.5 ? "shaky"
      : "weak";
    totals.itemsSeen += rec.itemsSeen;
    totals.weightedMastery += rec.mastery * (rec.weight / 
      content.objectives.domains.find((d) => d.id === rec.domain).objectives.length);
    if (rec.itemsSeen) totals.sampled += 1;
  }

  const p = Math.max(0, Math.min(1, totals.weightedMastery));
  const n = reviewCount;
  // Blueprint depth, aggregated rather than averaged per objective. Averaging the ratios
  // weights a 10-topic objective the same as a 41-topic one and reads several
  // points higher than the truth, which is the identical mistake one level up.
  const recs = Object.values(perObjective);
  const topicsTotal = recs.reduce((a, r) => a + r.topics, 0);
  const topicsHitTotal = recs.reduce((a, r) => a + r.topicsCovered, 0);
  const meanDepth = topicsTotal ? topicsHitTotal / topicsTotal : 0;

  // The headline is the exam-day forecast. The coverage-weighted mastery above
  // still paints the per-objective picture; it no longer sets the score.
  const forecast = examForecast(state, content, now, mocks);
  return {
    perObjective,
    mastery: p,
    forecast,
    scaled: forecast.scaled,
    band: Math.round((forecast.high - forecast.low) / 2),
    low: forecast.low,
    high: forecast.high,
    passLine: 750,
    confident: n >= 150 && totals.sampled >= 20 && meanDepth >= 0.8,
    reviewCount: n,
    objectivesSampled: totals.sampled,
    bankDepth: meanDepth,
    topicsCovered: topicsHitTotal,
    topicsTotal,
    thinObjectives: recs.filter((r) => r.thin).length,
    emptyObjectives: recs.filter((r) => r.itemsAvailable === 0).length,
    daysLeft: state.profile.examDate ? mentor.daysUntilExam(state, now) : null,
  };
}
