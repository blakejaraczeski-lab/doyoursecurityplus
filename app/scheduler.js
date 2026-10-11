// Queue builder and readiness projection.
//
// Two ideas drive everything here:
//   1. Exam weight. Domain 4 is 28% of the exam and domain 1 is 12%. Study time
//      follows the weights, not the alphabet.
//   2. Retargeting. A due misconception does not re-show the item you failed. It
//      pulls a different item that tests the same discrimination.

import * as fsrs from "./fsrs.js";
import * as mentor from "./mentor.js";

// `maxRecallShare` caps plain vocabulary cards as a fraction of a session.
// The exam is multiple choice and PBQs, never free text, so a card you reveal
// and grade yourself trains an operation the exam never asks for. Vocabulary
// still has to get in the door, hence a small share rather than none.
export const PACE = {
  bootcamp:  { newPerSession: 40, retention: 0.92, mixMisconception: 0.5, mixNew: 0.3, mixReview: 0.2, maxRecallShare: 0.12, maxAcronymShare: 0.10 },
  balanced:  { newPerSession: 25, retention: 0.90, mixMisconception: 0.4, mixNew: 0.3, mixReview: 0.3, maxRecallShare: 0.15, maxAcronymShare: 0.12 },
  longhaul:  { newPerSession: 15, retention: 0.88, mixMisconception: 0.3, mixNew: 0.3, mixReview: 0.4, maxRecallShare: 0.20, maxAcronymShare: 0.15 },
};

/** Is this item worth putting in a drill queue at all? */
const eligible = (content, it) =>
  !(it.type === "recall" && content.supersededRecall?.has(it.id));

/**
 * Graded practice: an item that makes you choose between options and marks you
 * right or wrong. A revealed vocabulary card is not this, and an acronym carries
 * no objective, so neither can stand in for exam-shaped coverage of a domain.
 */
const isGraded = (it) =>
  typeof it.type === "string" && it.type.startsWith("mcq") && it.source !== "acronym-list";

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
    out.push(entry);
    taken.add(entry);
    if (entry.contrastDrill) {
      const partners = queue.filter(
        (e) => e !== entry && !taken.has(e) &&
               e.contrastDrill && e.targetMisconception === entry.targetMisconception
      );
      for (const p of partners) { out.push(p); taken.add(p); }
    }
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
 * Two things this deliberately does not do any more. It no longer counts a
 * revealed vocabulary card as coverage of a domain: the exam never asks you to
 * reveal anything, so only graded practice counts. And it no longer lets a
 * domain keep pulling new items once it has none left, which an unbounded
 * deficit used to do, sending the queue after material that does not exist.
 */
export function coverageDeficit(state, content) {
  const byDomain = {};
  for (const d of content.objectives.domains) {
    byDomain[d.id] = { weight: d.weight, available: 0, seen: 0, remaining: 0 };
  }
  for (const it of content.items) {
    const dom = content.domainOf[it.objective];
    if (!dom || !byDomain[dom] || !eligible(content, it) || !isGraded(it)) continue;
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

/** Pick the next unseen item, biased toward the most under-studied domains. */
const isAcronym = (it) => it.source === "acronym-list";

function pickNewItems(state, content, n, recallBudget = Infinity, acronymBudget = Infinity) {
  const deficit = coverageDeficit(state, content);

  // Acronyms are cross-cutting and carry no objective: the exam assumes them
  // everywhere rather than testing them under one. An earlier version required
  // an objective here, which silently made all 315 of them unservable.
  const unseen = content.items.filter(
    (it) => !seen(state, it.id) && eligible(content, it) && (it.objective || isAcronym(it))
  );

  const score = (it) => {
    const d = deficit[content.domainOf[it.objective]] || { deficit: 0, weight: 0.1 };
    return d.deficit * 10 + d.weight * 2 + Math.random() * 0.25;
  };

  const pools = {
    recall: unseen.filter((it) => it.type === "recall").sort((a, b) => score(b) - score(a)),
    acronym: unseen.filter(isAcronym).sort(() => Math.random() - 0.5),
    core: unseen.filter((it) => it.type !== "recall" && !isAcronym(it)).sort((a, b) => score(b) - score(a)),
  };

  // These are floors, not just caps. A cap alone means vocabulary and acronyms
  // never appear at all while any exam-shaped item is left unseen, which is most
  // of the programme, so the slices that were meant to be small became zero.
  const out = [];
  const take = (pool, k) => { for (let i = 0; i < k && pool.length && out.length < n; i++) out.push(pool.shift()); };
  take(pools.acronym, Math.min(acronymBudget, Math.floor(n * 0.08)));
  take(pools.recall, Math.min(recallBudget, Math.floor(n * 0.08)));
  take(pools.core, n - out.length);
  // Whatever is left over goes to the reserved pools, still inside their caps.
  take(pools.acronym, Math.max(0, acronymBudget - out.filter(isAcronym).length));
  take(pools.recall, Math.max(0, recallBudget - out.filter((it) => it.type === "recall").length));
  return out;
}

/** Previously seen items whose own FSRS card is due. */
function pickDueItems(state, content, n, now) {
  const due = content.items
    .filter((it) => {
      if (!eligible(content, it)) return false;
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
export function buildQueue(state, content, { mode = "drill", size = 25, now = Date.now() } = {}) {
  const pace = PACE[state.profile.pace] || PACE.bootcamp;
  const queue = [];

  if (mode === "pbq") {
    const attempted = (id) => state.pbq[id]?.attempts?.length || 0;
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
    if (mentor.tierFor(d.rec) >= 3) {
      const pair = mentor.contrastPair(d.id, content, state);
      if (pair && queue.length + 2 <= mcSlots + 1) {
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

  // 2. Items already seen whose own card is due.
  const reviewSlots = Math.round(size * pace.mixReview);
  for (const it of pickDueItems(state, content, reviewSlots, now)) {
    queue.push({ kind: "item", item: it, reason: "Due for review" });
  }

  // 3. New coverage, weighted toward the under-studied heavy domains, with
  //    plain vocabulary capped so it cannot crowd out exam-shaped practice.
  const newSlots = Math.max(0, size - queue.length);
  const recallBudget = Math.max(1, Math.round(size * (pace.maxRecallShare ?? 0.15)));
  const acronymBudget = Math.max(1, Math.round(size * (pace.maxAcronymShare ?? 0.12)));
  const alreadyRecall = queue.filter((e) => e.item?.type === "recall").length;
  const alreadyAcronym = queue.filter((e) => e.item && e.item.source === "acronym-list").length;
  for (const it of pickNewItems(state, content, newSlots,
                                Math.max(0, recallBudget - alreadyRecall),
                                Math.max(0, acronymBudget - alreadyAcronym))) {
    queue.push({
      kind: "item", item: it,
      reason: it.type === "recall" ? "Vocabulary"
            : it.source === "acronym-list" ? "Acronym recognition"
            : "New coverage",
    });
  }

  return keepPairsAdjacent(shuffle(queue)).slice(0, size);
}

/** Build a mock exam: PBQs front loaded, then multiple choice, up to 90 items. */
export function buildMock(content, { pbqCount = 5, total = 90 } = {}) {
  const pbqs = shuffle(content.pbqs).slice(0, Math.min(pbqCount, content.pbqs.length));
  // The real exam is single-select, multi-select and PBQs, so a mock that draws
  // only plain "mcq" is narrower than the thing it is imitating. Multi-select
  // and the derived discrimination items are exam-shaped and belong in the pool.
  const mcqs = content.items.filter(
    (i) => typeof i.type === "string" && i.type.startsWith("mcq")
  );
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

// --- readiness -------------------------------------------------------------

const laplace = (correct, seenCount) => (correct + 2) / (seenCount + 4);

/** Mastery 0..1 per objective, and the projected scaled score. */
export function readiness(state, content, now = Date.now()) {
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

  // Weighted the same way the mock scores: a difficulty-1 acronym and a
  // difficulty-5 scenario should not move the projection equally, or a run of
  // easy items reads as readiness.
  const weightOf = (it) => 0.6 + 0.2 * Math.max(1, Math.min(5, it.difficulty || 2));

  // How much graded material exists per objective, and how much of the
  // objective's blueprint it reaches. Both are properties of the bank, not of
  // the learner, and keeping them apart is the whole point: an objective with
  // two items is not an objective you are bad at.
  // Resolve topic tags the same way scripts/validate_content.py does, aliases
  // included, so the app and the gate cannot drift apart and report different
  // coverage for the same bank.
  // A canonical topic id always wins over another topic's alias. Building one
  // flat map in a single pass let an alias such as "segmentation" (declared on
  // 3.3's segmentation-2) overwrite the canonical entry owned by 2.5, so items
  // tagged with the bare word were credited to the wrong objective.
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
    const att = state.pbq[p.id]?.attempts || [];
    const rec = perObjective[p.objective];
    if (!rec || !att.length) continue;
    const best = Math.max(...att.map((a) => a.percent)) / 100;
    rec.pbqBest = best;
  }

  const totals = { itemsSeen: 0, weightedMastery: 0, sampled: 0 };
  for (const rec of Object.values(perObjective)) {
    const accuracy = rec.attempts ? laplace(rec.itemsCorrect, rec.attempts) : 0;

    // The denominator is what this objective can actually offer you, not a
    // constant. It used to be a flat 12 items, which meant an objective holding
    // 2 items was permanently capped at coverage 0.17 and read "shaky" however
    // well you did: 18 of 28 objectives could never reach 1, and 11 could never
    // read "strong". That is a measurement of the bank being reported as a
    // measurement of you. Twelve is still the sample size worth having; an
    // objective that cannot supply twelve is scored out of what it has, and the
    // shortfall is reported separately as bank depth.
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
    // Same thresholds as the validator's "thin objectives" report, counting the
    // same units, so the two agree on which objectives are underbuilt.
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
  // Anchored piecewise mapping onto CompTIA's 100-900 scale: 750 is the pass line
  // and sits at roughly 75% mastery. This is an estimate, not a predicted score.
  const scaled = p <= 0.75
    ? Math.round(100 + (650 / 0.75) * p)
    : Math.round(750 + (150 / 0.25) * (p - 0.75));

  const n = state.reviews.length;
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
