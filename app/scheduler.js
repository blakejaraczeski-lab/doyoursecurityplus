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
export function buildQueue(state, content, { mode = "drill", size = 25, now = Date.now(), policy = "current" } = {}) {
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

/** Build a mock exam: PBQs front loaded, then multiple choice, up to 90 items. */
export function buildMock(content, { pbqCount = 5, total = 90 } = {}) {
  const pbqs = shuffle(content.pbqs).slice(0, Math.min(pbqCount, content.pbqs.length));
  // The real exam is single-select, multi-select and PBQs, so a mock that draws
  // only plain "mcq" is narrower than the thing it is imitating. Multi-select
  // and the derived discrimination items are exam-shaped and belong in the pool.
  const mcqs = content.items.filter(isGraded);
  const byDomain = {};
  for (const m of mcqs) (byDomain[content.domainOf[m.objective]] ||= []).push(m);

  const want = total - pbqs.length;
  const picked = [];
  for (const d of content.objectives.domains) {
    const pool = shuffle(byDomain[d.id] || []);
    picked.push(...pool.slice(0, Math.round(want * d.weight)));
  }
  const filler = shuffle(mcqs.filter((m) => !picked.includes(m)));
  while (picked.length < want && filler.length) picked.push(filler.pop());

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
const SECONDS = { mcq: 40, "mcq-multi": 60, recall: 15, pbq: 480, mentor: 60 };
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

// --- readiness -------------------------------------------------------------

const laplace = (correct, seenCount) => (correct + 2) / (seenCount + 4);

/**
 * Mastery 0..1 per objective, and the projected scaled score. `reviewCount` is
 * how many answers the review log holds for the recent window; it sets the
 * width of the band, not the estimate.
 */
export function readiness(state, content, now = Date.now(), reviewCount = 0) {
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
  const scaled = toScaled(p);

  const n = reviewCount;
  // Uncertainty, not the estimate, carries the cost of a shallow bank. The
  // point estimate is an honest read of how you did on what exists; how far it
  // might be from your real exam score depends on how much of the blueprint
  // that material actually reached.
  // Aggregate, not an average of per-objective ratios. Averaging the ratios
  // weights a 10-topic objective the same as a 41-topic one and reads several
  // points higher than the truth, which is the identical mistake one level up.
  const recs = Object.values(perObjective);
  const topicsTotal = recs.reduce((a, r) => a + r.topics, 0);
  const topicsHitTotal = recs.reduce((a, r) => a + r.topicsCovered, 0);
  const meanDepth = topicsTotal ? topicsHitTotal / topicsTotal : 0;
  const bankPenalty = 1 + (1 - meanDepth) * 0.6;
  const band = Math.round(Math.min(220, (200 / Math.sqrt(Math.max(n, 1) + 4)) * bankPenalty));

  return {
    perObjective,
    mastery: p,
    scaled,
    band,
    low: Math.max(100, scaled - band),
    high: Math.min(900, scaled + band),
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
